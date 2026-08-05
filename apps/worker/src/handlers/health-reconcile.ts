import { db, jobLog, message, enrollment } from '@quiksend/db'
import { enqueue, registerHandler, getBoss } from '@quiksend/queue'
import { logger } from '@quiksend/config'
import { eq, and, lt, ne, isNull } from 'drizzle-orm'

/**
 * Health reconciliation: idempotent scan for stale ambiguous states.
 * Never resends stale sending; marks for reconciliation-required and enqueues
 * repair job once per scan cycle (idempotent by job log entry).
 *
 * Ambiguous states:
 * - Message: status='pending' or 'queued' but created >1 hour ago (likely lost to queue)
 * - Enrollment: status='active' but no recent activity (stuck waiting for tick)
 *
 * Reconciliation is bounded: one scan-local repair job enqueue per state type.
 */
export async function handleHealthReconcile(): Promise<void> {
  const scanStart = Date.now()
  const oneHourAgo = new Date(scanStart - 60 * 60 * 1000)
  const reconcileJobName = 'health.reconcile'

  try {
    // Check if this scan cycle has already enqueued a reconcile job (idempotency)
    const lastReconcileLog = await db
      .select()
      .from(jobLog)
      .where(eq(jobLog.jobName, reconcileJobName))
      .orderBy(jobLog.createdAt)
      .limit(1)

    const lastScanTime = lastReconcileLog[0]?.createdAt?.getTime() || 0
    const now = Date.now()
    const scanIntervalMs = 5 * 60 * 1000 // 5-minute scan interval

    // Skip if we just ran a scan within interval
    if (now - lastScanTime < scanIntervalMs) {
      logger.info({ lastScanTime, now }, 'Skipping reconcile scan, already recent')
      return
    }

    // Find potentially stale messages (pending/queued for >1 hour)
    const staleMessages = await db
      .select({
        id: message.id,
        enrollmentId: message.enrollmentId,
        status: message.status,
        createdAt: message.createdAt,
      })
      .from(message)
      .where(
        and(
          ne(message.status, 'sent'),
          ne(message.status, 'delivered'),
          ne(message.status, 'failed'),
          ne(message.status, 'bounced'),
          lt(message.createdAt, oneHourAgo),
          isNull(message.error)
        )
      )
      .limit(100)

    if (staleMessages.length > 0) {
      logger.info(
        { count: staleMessages.length, states: staleMessages.map(m => m.status) },
        'Found potentially stale messages'
      )

      // Log reconciliation-required marker (one per scan)
      await db.insert(jobLog).values({
        jobName: reconcileJobName,
        payloadRef: `stale_messages_${scanStart}`,
        status: 'started',
        attempt: 1,
        durationMs: null,
      })

      // Enqueue single repair job if we found stale messages
      const jobId = await enqueue('health.reconcile', {}, {
        singletonKey: 'health-reconcile-stale-messages',
        singletonMinutes: 30,
      })

      if (jobId) {
        logger.info({ jobId, count: staleMessages.length }, 'Enqueued message reconciliation')
      }
    }

    // Find stale enrollments (active but no recent activity)
    const staleEnrollments = await db
      .select({
        id: enrollment.id,
        status: enrollment.status,
        updatedAt: enrollment.updatedAt,
      })
      .from(enrollment)
      .where(
        and(
          eq(enrollment.status, 'active'),
          lt(enrollment.updatedAt, oneHourAgo)
        )
      )
      .limit(100)

    if (staleEnrollments.length > 0) {
      logger.info(
        { count: staleEnrollments.length },
        'Found potentially stale active enrollments'
      )

      // Log reconciliation-required marker
      await db.insert(jobLog).values({
        jobName: reconcileJobName,
        payloadRef: `stale_enrollments_${scanStart}`,
        status: 'started',
        attempt: 1,
        durationMs: null,
      })

      // Enqueue single repair job (idempotent singleton)
      const jobId = await enqueue('health.reconcile', {}, {
        singletonKey: 'health-reconcile-stale-enrollments',
        singletonMinutes: 30,
      })

      if (jobId) {
        logger.info({ jobId, count: staleEnrollments.length }, 'Enqueued enrollment reconciliation')
      }
    }

    const elapsedMs = Date.now() - scanStart
    logger.info(
      {
        elapsedMs,
        staleMessagesCount: staleMessages.length,
        staleEnrollmentsCount: staleEnrollments.length,
      },
      'Health reconciliation scan complete'
    )
  } catch (err) {
    logger.error({ err }, 'Health reconciliation failed')
    throw err
  }
}

/**
 * Register health reconciliation handler and schedule it.
 * Runs every 5 minutes to scan for stale message/enrollment states.
 */
export async function registerHealthReconcileHandler(): Promise<void> {
  await registerHandler('health.reconcile', handleHealthReconcile)

  const boss = await getBoss()
  await boss.schedule('health.reconcile', '*/5 * * * *', {}, { key: 'health-reconcile' })

  logger.info('Health reconciliation handler registered and scheduled')
}
