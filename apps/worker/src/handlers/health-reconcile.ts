import { db, message, enrollment } from '@quiksend/db'
import { registerHandler, getBoss } from '@quiksend/queue'
import { logger } from '@quiksend/config'
import { eq, and, lt, ne, isNull } from 'drizzle-orm'

/**
 * Health reconciliation: idempotent scan for stale ambiguous states.
 * Finds stale messages/enrollments and logs reconciliation-required markers.
 * Never resends or mutates tenant data — a dashboard or operator acts on the logs.
 *
 * Scheduling: pg-boss cron with a singleton key guarantees one scan per interval.
 * Bounded: each query limited to 100 records.
 */
export async function handleHealthReconcile(): Promise<void> {
  const scanStart = Date.now()
  const oneHourAgo = new Date(scanStart - 60 * 60 * 1000)

  // Stale messages: pending/queued for >1 hour with no error (likely lost to queue)
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
    logger.warn(
      { count: staleMessages.length, states: staleMessages.map(m => m.status) },
      'reconciliation-required: stale messages detected'
    )
  }

  // Stale enrollments: active but no recent activity (stuck waiting for tick)
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
    logger.warn(
      { count: staleEnrollments.length },
      'reconciliation-required: stale active enrollments detected'
    )
  }

  logger.info(
    {
      elapsedMs: Date.now() - scanStart,
      staleMessagesCount: staleMessages.length,
      staleEnrollmentsCount: staleEnrollments.length,
    },
    'Health reconciliation scan complete'
  )
}

/**
 * Register health reconciliation handler and schedule it.
 * Runs every 5 minutes; pg-boss cron key ensures single scheduling.
 */
export async function registerHealthReconcileHandler(): Promise<void> {
  await registerHandler('health.reconcile', handleHealthReconcile)
  const boss = await getBoss()
  await boss.schedule('health.reconcile', '*/5 * * * *', {}, { key: 'health-reconcile', tz: 'UTC' })
  logger.info('Health reconciliation handler registered and scheduled')
}
