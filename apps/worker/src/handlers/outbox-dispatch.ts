import { logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { enqueue, getBoss, registerHandler } from "@quiksend/queue";
import { and, eq, sql } from "drizzle-orm";

export const MAX_OUTBOX_ATTEMPTS = 10;
const DISPATCH_BATCH_SIZE = 50;

/** Lease duration in seconds. Stale processing rows are re-claimable after this. */
export const OUTBOX_LEASE_SECONDS = 300;

/**
 * Exponential backoff: 30 * 2^(attempts-1) seconds, capped at 1 hour.
 * First retry (attempts=1) waits 30s; attempts=0 has no delay.
 */
export function computeOutboxBackoff(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(30 * Math.pow(2, attempts - 1), 3600);
}

/**
 * Claim a batch of outbox rows by atomically transitioning them to 'processing'.
 *
 * Claimable rows:
 *   1. status='pending', attempts < MAX, backoff elapsed (from updated_at)
 *   2. status='processing', lease expired (claimed_at + LEASE_SECONDS < now())
 *      — crash recovery for dispatchers that died mid-flight
 *
 * FOR UPDATE SKIP LOCKED prevents two concurrent dispatchers from touching
 * the same row in the same sweep. The 'processing' status prevents sequential
 * sweeps from re-claiming a row that is still being dispatched.
 *
 * Returns the number of rows successfully dispatched.
 */
export async function claimAndDispatchBatch(): Promise<number> {
  const claimed = await db.execute<{
    id: string;
    organization_id: string;
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    payload: unknown;
    idempotency_key: string;
    attempts: number;
  }>(sql`
    WITH claimable AS (
      SELECT id, organization_id
      FROM event_outbox
      WHERE (
        -- Fresh or retried pending rows with backoff elapsed
        (status = 'pending'
         AND attempts < ${MAX_OUTBOX_ATTEMPTS}
         AND (
           attempts = 0
           OR updated_at <= now() - make_interval(secs => LEAST(30 * POWER(2, attempts - 1), 3600))
         ))
        OR
        -- Stale processing rows whose lease expired (crashed dispatcher)
        (status = 'processing'
         AND claimed_at <= now() - make_interval(secs => ${OUTBOX_LEASE_SECONDS}))
      )
      ORDER BY created_at ASC
      LIMIT ${DISPATCH_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE event_outbox
    SET status = 'processing',
        attempts = event_outbox.attempts + 1,
        claimed_at = now(),
        updated_at = now()
    FROM claimable
    WHERE event_outbox.id = claimable.id AND event_outbox.organization_id = claimable.organization_id
    RETURNING event_outbox.id,
              event_outbox.organization_id,
              event_outbox.event_type,
              event_outbox.aggregate_type,
              event_outbox.aggregate_id,
              event_outbox.payload,
              event_outbox.idempotency_key,
              event_outbox.attempts
  `);

  let dispatched = 0;

  for (const row of claimed) {
    try {
      await dispatchRow(row);

      await db
        .update(tables.eventOutbox)
        .set({
          status: "dispatched",
          dispatchedAt: new Date(),
        })
        .where(
          and(
            eq(tables.eventOutbox.id, row.id),
            eq(tables.eventOutbox.organizationId, row.organization_id),
          ),
        );

      dispatched++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Return to pending (or failed if exhausted) so sweep retries with backoff.
      // attempts was already incremented during claim.
      await db
        .update(tables.eventOutbox)
        .set({
          lastError: errorMessage,
          status: row.attempts >= MAX_OUTBOX_ATTEMPTS ? "failed" : "pending",
        })
        .where(
          and(
            eq(tables.eventOutbox.id, row.id),
            eq(tables.eventOutbox.organizationId, row.organization_id),
          ),
        );

      logger.warn(
        { outboxId: row.id, eventType: row.event_type, attempt: row.attempts, err: errorMessage },
        "outbox dispatch failed",
      );
    }
  }

  return dispatched;
}

/**
 * Dispatch a single outbox row based on its event type.
 * Creates webhook deliveries for webhook-eligible events.
 *
 * Idempotent: the (outbox_id, endpoint_id) unique constraint prevents
 * duplicate deliveries on retry after partial loop failure or crash.
 * Singleton enqueue keys prevent duplicate pg-boss jobs.
 */
async function dispatchRow(row: {
  id: string;
  organization_id: string;
  event_type: string;
  payload: unknown;
}): Promise<void> {
  const endpoints = await db.query.webhookEndpoint.findMany({
    where: and(
      eq(tables.webhookEndpoint.organizationId, row.organization_id),
      eq(tables.webhookEndpoint.status, "active"),
    ),
  });

  const matching = endpoints.filter((ep) => ep.events.includes(row.event_type));
  const payload = (row.payload ?? {}) as Record<string, unknown>;

  for (const endpoint of matching) {
    // Conflict-safe: (outbox_id, endpoint_id) partial unique prevents duplicates
    const [inserted] = await db
      .insert(tables.webhookDelivery)
      .values({
        organizationId: row.organization_id,
        endpointId: endpoint.id,
        outboxId: row.id,
        eventType: row.event_type,
        payload,
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: tables.webhookDelivery.id });

    // If conflict, fetch the existing delivery row for enqueue
    const deliveryId =
      inserted?.id ??
      (
        await db.query.webhookDelivery.findFirst({
          columns: { id: true },
          where: and(
            eq(tables.webhookDelivery.outboxId, row.id),
            eq(tables.webhookDelivery.endpointId, endpoint.id),
          ),
        })
      )?.id;

    if (deliveryId) {
      // Stable singleton key: at most one pending/active job per delivery row
      await enqueue("webhook.deliver", { deliveryId }, { singletonKey: deliveryId });
    }
  }

  // For crm.sync intents, re-enqueue with stable key
  if (row.event_type === "crm.sync") {
    const p = payload as { connectionId?: string; model?: string };
    if (p.connectionId && p.model) {
      await enqueue(
        "crm.sync",
        { connectionId: p.connectionId, model: p.model as "Contact" | "Company" | "Account" },
        { singletonKey: `outbox:${row.id}` },
      );
    }
  }
}

export async function registerOutboxDispatchHandler(): Promise<void> {
  await registerHandler("outbox.dispatch", async () => {
    const dispatched = await claimAndDispatchBatch();
    if (dispatched > 0) {
      logger.info({ dispatched }, "outbox batch dispatched");
    }
  });

  const boss = await getBoss();
  await boss.schedule("outbox.dispatch", "* * * * *", {}, { tz: "UTC" });
  logger.info({ job: "outbox.dispatch" }, "outbox dispatch sweep scheduled");
}
