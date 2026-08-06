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

export const SNAPSHOT_KEYS: readonly (keyof OperationalSnapshot)[] = Object.keys(
  THRESHOLDS,
) as (keyof OperationalSnapshot)[];

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
  // Single bounded-aggregate query — scalar subqueries share one now() snapshot
  const r = await db.execute(sql`
    SELECT
      EXTRACT(EPOCH FROM (now() - (
        SELECT MIN(created_at) FROM message
        WHERE status IN ('pending', 'queued')
      ))) / 60 AS queue_age_minutes,
      (SELECT COUNT(*)::int FROM (
        SELECT 1 FROM message
        WHERE status = 'sending'
          AND updated_at < now() - interval '30 minutes'
        LIMIT 1000
      ) b) AS stuck_sending_count,
      (SELECT COUNT(*)::int FROM (
        SELECT 1 FROM enrollment
        WHERE state = 'active'
          AND updated_at < now() - interval '2 hours'
        LIMIT 1000
      ) b) AS stale_enrollment_count,
      EXTRACT(EPOCH FROM (now() - (
        SELECT MAX(updated_at) FROM mailbox
        WHERE status = 'active' AND poll_cursor IS NOT NULL
      ))) / 60 AS mailbox_poll_lag_minutes,
      (SELECT COUNT(*)::int FROM (
        SELECT 1 FROM webhook_delivery
        WHERE status = 'pending'
          AND created_at < now() - interval '10 minutes'
        LIMIT 1000
      ) b) AS webhook_backlog_count,
      (SELECT COUNT(*)::int FROM (
        SELECT 1 FROM message
        WHERE direction = 'inbound'
          AND status IN ('failed', 'bounced')
          AND created_at > now() - interval '1 hour'
        LIMIT 1000
      ) b) AS inbound_failure_count,
      (SELECT COUNT(*)::int FROM (
        SELECT 1 FROM job_log
        WHERE job_name = 'health.reconcile'
          AND status = 'failed'
          AND created_at > now() - interval '1 hour'
        LIMIT 1000
      ) b) AS reconciliation_failure_count
  `);

  const rows = r as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  return {
    queueAgeMinutes: sanitize(row?.queue_age_minutes),
    stuckSendingCount: sanitize(row?.stuck_sending_count),
    staleEnrollmentCount: sanitize(row?.stale_enrollment_count),
    mailboxPollLagMinutes: sanitize(row?.mailbox_poll_lag_minutes),
    webhookBacklogCount: sanitize(row?.webhook_backlog_count),
    inboundFailureCount: sanitize(row?.inbound_failure_count),
    reconciliationFailureCount: sanitize(row?.reconciliation_failure_count),
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
  logger.info({ ...snapshot, event: "ops.snapshot" }, "Operational snapshot collected");

  evaluateAlerts(snapshot);
}

// ── Registration + cleanup ──────────────────────────────────────────────────

export async function registerOperationalSnapshotHandler(): Promise<void> {
  await registerHandler("ops.snapshot", handleOperationalSnapshot);

  const boss = await getBoss();
  await boss.schedule("ops.snapshot", "*/2 * * * *", {}, { tz: "UTC" });

  logger.info({ job: "ops.snapshot" }, "Operational snapshot handler registered");
}

export function shutdownOperationalSnapshot(): void {
  alertFired.clear();
}

/** Visible for tests */
export function getAlertState(): ReadonlyMap<keyof OperationalSnapshot, boolean> {
  return alertFired;
}

export function resetAlertState(): void {
  alertFired.clear();
}
