import { env, logger } from "@quiksend/config";
import { db, recordAudit } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { getBoss, registerHandler } from "@quiksend/queue";
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";

/**
 * Nightly bounded, resumable retention purge (Task 5).
 *
 * Two independent purge lanes, both running as repeated small `DELETE ...
 * LIMIT n RETURNING id` batches rather than one unbounded statement:
 *
 *   1. General retention — `event` and `webhook_delivery` rows older than
 *      their documented window are trimmed for every organization,
 *      deletion-requested or not.
 *   2. Deletion-triggered purge — once an organization's deletion request is
 *      older than `RETENTION_DELETED_MESSAGE_DAYS`, its `message` rows are
 *      deleted in batches. `suppression`, `audit_log`, `organization`, and
 *      `member` rows are never touched here — that's the compliance
 *      evidence the purge is required to preserve.
 *
 * Each batch commits independently, so a worker restart mid-purge loses no
 * progress: the next scheduled run resumes purely by re-matching the same
 * predicate (`created_at < cutoff` / `organization_id = X`) against whatever
 * rows are still left. `batchSize`/`maxBatchesPerOrg` are parameters (not
 * hardcoded) so tests can exercise multi-run resumption deterministically.
 */

export interface RetentionPurgeOptions {
  now?: Date;
  batchSize?: number;
  /** Caps per-org work in a single invocation so one large org can't starve the rest. */
  maxBatchesPerOrg?: number;
  eventRetentionDays?: number;
  webhookAttemptRetentionDays?: number;
  deletedMessageRetentionDays?: number;
}

export interface RetentionPurgeSummary {
  eventsDeleted: number;
  webhookAttemptsDeleted: number;
  messagesDeleted: number;
  organizationsPurgeCompleted: number;
}

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_BATCHES_PER_ORG = 20;

async function deleteBatchById(table: "event" | "webhook_delivery", cutoff: Date, batchSize: number) {
  const rows = await db.execute(sql`
    DELETE FROM ${sql.identifier(table)}
    WHERE id IN (SELECT id FROM ${sql.identifier(table)} WHERE created_at < ${cutoff} LIMIT ${batchSize})
    RETURNING id
  `);
  return rows.length;
}

/** Repeatedly batch-deletes rows older than `cutoff` from `table` until none remain. */
async function purgeOldRows(
  table: "event" | "webhook_delivery",
  cutoff: Date,
  batchSize: number,
): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await deleteBatchById(table, cutoff, batchSize);
    total += deleted;
    if (deleted < batchSize) break;
  }
  return total;
}

interface OrgPurgeResult {
  messagesDeleted: number;
  completed: boolean;
}

async function purgeOrganizationMessages(
  organizationId: string,
  batchSize: number,
  maxBatches: number,
): Promise<OrgPurgeResult> {
  let messagesDeleted = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const rows = await db.execute(sql`
      DELETE FROM message
      WHERE id IN (SELECT id FROM message WHERE organization_id = ${organizationId} LIMIT ${batchSize})
      RETURNING id
    `);
    messagesDeleted += rows.length;
    if (rows.length < batchSize) return { messagesDeleted, completed: true };
  }
  return { messagesDeleted, completed: false };
}

/** Orgs whose deletion request is old enough to purge, and haven't finished purging yet. */
async function findPurgeablePendingOrganizations(cutoff: Date): Promise<string[]> {
  const rows = await db
    .select({ organizationId: tables.organizationLifecycle.organizationId })
    .from(tables.organizationLifecycle)
    .where(
      and(
        isNotNull(tables.organizationLifecycle.deletionRequestedAt),
        lt(tables.organizationLifecycle.deletionRequestedAt, cutoff),
        isNull(tables.organizationLifecycle.purgeCompletedAt),
      ),
    );
  return rows.map((r) => r.organizationId);
}

async function purgeDeletedOrganizations(
  now: Date,
  retentionDays: number,
  batchSize: number,
  maxBatchesPerOrg: number,
): Promise<{ messagesDeleted: number; organizationsPurgeCompleted: number }> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const organizationIds = await findPurgeablePendingOrganizations(cutoff);

  let messagesDeleted = 0;
  let organizationsPurgeCompleted = 0;
  for (const organizationId of organizationIds) {
    const result = await purgeOrganizationMessages(organizationId, batchSize, maxBatchesPerOrg);
    messagesDeleted += result.messagesDeleted;
    if (!result.completed) continue;

    await db
      .update(tables.organizationLifecycle)
      .set({ purgeCompletedAt: now })
      .where(eq(tables.organizationLifecycle.organizationId, organizationId));
    organizationsPurgeCompleted++;
    await recordAudit({
      organizationId,
      actorType: "system",
      action: "organization.purge_completed",
      entityType: "organization",
      entityId: organizationId,
      metadata: { retentionDays },
    });
  }

  return { messagesDeleted, organizationsPurgeCompleted };
}

export async function runRetentionPurge(
  options: RetentionPurgeOptions = {},
): Promise<RetentionPurgeSummary> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatchesPerOrg = options.maxBatchesPerOrg ?? DEFAULT_MAX_BATCHES_PER_ORG;
  const eventRetentionDays = options.eventRetentionDays ?? env.RETENTION_EVENT_DAYS;
  const webhookAttemptRetentionDays =
    options.webhookAttemptRetentionDays ?? env.RETENTION_WEBHOOK_ATTEMPT_DAYS;
  const deletedMessageRetentionDays =
    options.deletedMessageRetentionDays ?? env.RETENTION_DELETED_MESSAGE_DAYS;

  const eventsDeleted = await purgeOldRows(
    "event",
    new Date(now.getTime() - eventRetentionDays * 24 * 60 * 60 * 1000),
    batchSize,
  );
  const webhookAttemptsDeleted = await purgeOldRows(
    "webhook_delivery",
    new Date(now.getTime() - webhookAttemptRetentionDays * 24 * 60 * 60 * 1000),
    batchSize,
  );
  const { messagesDeleted, organizationsPurgeCompleted } = await purgeDeletedOrganizations(
    now,
    deletedMessageRetentionDays,
    batchSize,
    maxBatchesPerOrg,
  );

  const summary: RetentionPurgeSummary = {
    eventsDeleted,
    webhookAttemptsDeleted,
    messagesDeleted,
    organizationsPurgeCompleted,
  };
  logger.info(summary, "retention.purge summary");
  return summary;
}

export async function registerRetentionPurgeHandler(): Promise<void> {
  await registerHandler("retention.purge", async () => {
    await runRetentionPurge();
  });
  const boss = await getBoss();
  await boss.schedule("retention.purge", "30 2 * * *", {}, { key: "retention-purge", tz: "UTC" });
  logger.info({ job: "retention.purge" }, "retention purge scheduled");
}
