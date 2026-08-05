import { logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { getBoss, registerHandler } from "@quiksend/queue";
import { sql } from "drizzle-orm";

/**
 * Operational snapshot: periodic bounded-aggregate metrics emitted via logger.
 *
 * Each metric is a single scalar (count or age-in-minutes) derived from a
 * bounded SQL aggregate (COUNT/MAX with hard LIMIT). Values are sanitized to
 * finite non-negative numbers; nulls become 0.
 *
 * No sensitive data (IDs, emails, org names) ever appears in the snapshot.
 *
 * Alert state: one alert fires per metric on threshold breach. No repeat
 * alerts until recovery (metric returns below threshold), after which a
 * recovery notice fires and the next breach will alert again.
 */

// ── Snapshot shape ──────────────────────────────────────────────────────────

export interface OperationalSnapshot {
  /** Oldest pending/queued message age in minutes */
  queueAgeMinutes: number;
  /** Messages stuck in 'sending' status for >30 min */
  stuckSendingCount: number;
  /** Active enrollments with no update in >2 hours */
  staleEnrollmentCount: number;
  /** Minutes since newest mailbox poll completion */
  mailboxPollLagMinutes: number;
  /** Pending webhook deliveries older than 10 min */
  webhookBacklogCount: number;
  /** Inbound messages in quarantine or failed status */
  inboundFailureCount: number;
  /** Failed health reconciliation jobs in last hour */
  reconciliationFailureCount: number;
}

export const SNAPSHOT_KEYS: readonly (keyof OperationalSnapshot)[] = [
  "queueAgeMinutes",
  "stuckSendingCount",
  "staleEnrollmentCount",
  "mailboxPollLagMinutes",
  "webhookBacklogCount",
  "inboundFailureCount",
  "reconciliationFailureCount",
] as const;

// ── Beta thresholds ─────────────────────────────────────────────────────────

export const THRESHOLDS: Readonly<Record<keyof OperationalSnapshot, number>> = {
  queueAgeMinutes: 60,
  stuckSendingCount: 5,
  staleEnrollmentCount: 20,
  mailboxPollLagMinutes: 30,
  webhookBacklogCount: 50,
  inboundFailureCount: 10,
  reconciliationFailureCount: 3,
};

// ── Alert state (in-memory, resets on restart) ──────────────────────────────

/** true = alert already fired, waiting for recovery before next alert */
const alertFired = new Map<keyof OperationalSnapshot, boolean>();

// ── Sanitize ────────────────────────────────────────────────────────────────

/** Clamp to finite non-negative integer; null/NaN/Infinity/negative → 0 */
export function sanitize(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function collectSnapshot(): Promise<OperationalSnapshot> {
  // Run all queries concurrently — each is a bounded aggregate
  const [
    queueAge,
    stuckSending,
    staleEnrollment,
    pollLag,
    webhookBacklog,
    inboundFailure,
    reconFailure,
  ] = await Promise.all([
    // Oldest pending/queued message age (minutes)
    db.execute<{ v: string | null }>(sql`
      SELECT EXTRACT(EPOCH FROM (now() - MIN(created_at))) / 60 AS v
      FROM message
      WHERE status IN ('pending', 'queued')
      LIMIT 1
    `),

    // Messages stuck in 'sending' for >30 min
    db.execute<{ v: string | null }>(sql`
      SELECT COUNT(*)::int AS v
      FROM (
        SELECT 1 FROM message
        WHERE status = 'sending'
          AND updated_at < now() - interval '30 minutes'
        LIMIT 1000
      ) bounded
    `),

    // Active enrollments with no update in >2 hours
    db.execute<{ v: string | null }>(sql`
      SELECT COUNT(*)::int AS v
      FROM (
        SELECT 1 FROM enrollment
        WHERE state = 'active'
          AND updated_at < now() - interval '2 hours'
        LIMIT 1000
      ) bounded
    `),

    // Minutes since newest mailbox poll (poll_cursor updated_at proxy via mailbox.updated_at)
    db.execute<{ v: string | null }>(sql`
      SELECT EXTRACT(EPOCH FROM (now() - MAX(updated_at))) / 60 AS v
      FROM mailbox
      WHERE status = 'active'
        AND poll_cursor IS NOT NULL
      LIMIT 1
    `),

    // Pending webhook deliveries older than 10 min
    db.execute<{ v: string | null }>(sql`
      SELECT COUNT(*)::int AS v
      FROM (
        SELECT 1 FROM webhook_delivery
        WHERE status = 'pending'
          AND created_at < now() - interval '10 minutes'
        LIMIT 1000
      ) bounded
    `),

    // Inbound messages failed or quarantine-like
    db.execute<{ v: string | null }>(sql`
      SELECT COUNT(*)::int AS v
      FROM (
        SELECT 1 FROM message
        WHERE direction = 'inbound'
          AND status IN ('failed', 'bounced')
          AND created_at > now() - interval '1 hour'
        LIMIT 1000
      ) bounded
    `),

    // Failed reconciliation jobs in last hour (job_log with status='failed')
    db.execute<{ v: string | null }>(sql`
      SELECT COUNT(*)::int AS v
      FROM (
        SELECT 1 FROM job_log
        WHERE job_name = 'health.reconcile'
          AND status = 'failed'
          AND created_at > now() - interval '1 hour'
        LIMIT 1000
      ) bounded
    `),
  ]);

  return {
    queueAgeMinutes: sanitize(queueAge.rows?.[0]?.v ?? queueAge[0]?.v),
    stuckSendingCount: sanitize(stuckSending.rows?.[0]?.v ?? stuckSending[0]?.v),
    staleEnrollmentCount: sanitize(staleEnrollment.rows?.[0]?.v ?? staleEnrollment[0]?.v),
    mailboxPollLagMinutes: sanitize(pollLag.rows?.[0]?.v ?? pollLag[0]?.v),
    webhookBacklogCount: sanitize(webhookBacklog.rows?.[0]?.v ?? webhookBacklog[0]?.v),
    inboundFailureCount: sanitize(inboundFailure.rows?.[0]?.v ?? inboundFailure[0]?.v),
    reconciliationFailureCount: sanitize(reconFailure.rows?.[0]?.v ?? reconFailure[0]?.v),
  };
}

// ── Alert logic ─────────────────────────────────────────────────────────────

export function evaluateAlerts(snapshot: OperationalSnapshot): void {
  for (const key of SNAPSHOT_KEYS) {
    const value = snapshot[key];
    const threshold = THRESHOLDS[key];
    const breached = value > threshold;
    const wasFired = alertFired.get(key) ?? false;

    if (breached && !wasFired) {
      // First breach — fire alert, suppress repeats
      logger.warn(
        { metric: key, value, threshold, event: "ops.alert.breach" },
        `Operational alert: ${key} = ${value} exceeds threshold ${threshold}`,
      );
      alertFired.set(key, true);
    } else if (!breached && wasFired) {
      // Recovery — notify and reset so next breach can alert
      logger.info(
        { metric: key, value, threshold, event: "ops.alert.recovery" },
        `Operational recovery: ${key} = ${value} below threshold ${threshold}`,
      );
      alertFired.set(key, false);
    }
    // breached && wasFired → suppress (already alerted)
    // !breached && !wasFired → normal, nothing to do
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handleOperationalSnapshot(): Promise<void> {
  const snapshot = await collectSnapshot();

  // Emit fixed-key structured log — no sensitive fields
  logger.info(
    { ...snapshot, event: "ops.snapshot" },
    "Operational snapshot collected",
  );

  evaluateAlerts(snapshot);
}

// ── Registration + cleanup ──────────────────────────────────────────────────

let registered = false;

export async function registerOperationalSnapshotHandler(): Promise<void> {
  await registerHandler("ops.snapshot", handleOperationalSnapshot);

  const boss = await getBoss();
  await boss.schedule("ops.snapshot", "*/2 * * * *", {}, { tz: "UTC" });

  registered = true;
  logger.info({ job: "ops.snapshot" }, "Operational snapshot handler registered");
}

export function shutdownOperationalSnapshot(): void {
  alertFired.clear();
  registered = false;
}

/** Visible for tests */
export function _getAlertState(): ReadonlyMap<keyof OperationalSnapshot, boolean> {
  return alertFired;
}

export function _resetAlertState(): void {
  alertFired.clear();
}
