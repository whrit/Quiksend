import { logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { enqueue, getBoss, registerHandler } from "@quiksend/queue";
import { and, eq, sql } from "drizzle-orm";

export const MAX_OUTBOX_ATTEMPTS = 10;
const DISPATCH_BATCH_SIZE = 50;

/**
 * Exponential backoff: 30 * 2^(attempts-1) seconds, capped at 1 hour.
 * First attempt (attempts=0) has no delay.
 */
export function computeOutboxBackoff(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(30 * Math.pow(2, attempts - 1), 3600);
}

/**
 * Claim a batch of pending outbox rows using FOR UPDATE SKIP LOCKED,
 * dispatch each one, and mark the result. Safe with multiple concurrent workers.
 *
 * Returns the number of rows successfully dispatched.
 */
export async function claimAndDispatchBatch(): Promise<number> {
  // Claim rows: pending, under max attempts, backoff elapsed
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
      SELECT id
      FROM event_outbox
      WHERE status = 'pending'
        AND attempts < ${MAX_OUTBOX_ATTEMPTS}
        AND (
          attempts = 0
          OR updated_at <= now() - make_interval(secs => LEAST(30 * POWER(2, attempts - 1), 3600))
        )
      ORDER BY created_at ASC
      LIMIT ${DISPATCH_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE event_outbox
    SET updated_at = now()
    FROM claimable
    WHERE event_outbox.id = claimable.id
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
        .where(eq(tables.eventOutbox.id, row.id));

      dispatched++;
    } catch (err) {
      const nextAttempts = row.attempts + 1;
      const errorMessage = err instanceof Error ? err.message : String(err);

      await db
        .update(tables.eventOutbox)
        .set({
          attempts: nextAttempts,
          lastError: errorMessage,
          status: nextAttempts >= MAX_OUTBOX_ATTEMPTS ? "failed" : "pending",
        })
        .where(eq(tables.eventOutbox.id, row.id));

      logger.warn(
        { outboxId: row.id, eventType: row.event_type, attempt: nextAttempts, err: errorMessage },
        "outbox dispatch failed",
      );
    }
  }

  return dispatched;
}

/**
 * Dispatch a single outbox row based on its event type.
 * Creates webhook deliveries for webhook-eligible events.
 */
async function dispatchRow(row: {
  id: string;
  organization_id: string;
  event_type: string;
  payload: unknown;
}): Promise<void> {
  // Create webhook deliveries for events that webhook endpoints subscribe to
  const endpoints = await db.query.webhookEndpoint.findMany({
    where: and(
      eq(tables.webhookEndpoint.organizationId, row.organization_id),
      eq(tables.webhookEndpoint.status, "active"),
    ),
  });

  const matching = endpoints.filter((ep) => ep.events.includes(row.event_type));
  const payload = (row.payload ?? {}) as Record<string, unknown>;

  for (const endpoint of matching) {
    const [delivery] = await db
      .insert(tables.webhookDelivery)
      .values({
        organizationId: row.organization_id,
        endpointId: endpoint.id,
        eventType: row.event_type,
        payload,
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
      })
      .returning({ id: tables.webhookDelivery.id });

    if (delivery) {
      await enqueue("webhook.deliver", { deliveryId: delivery.id });
    }
  }

  // For crm.sync intents, re-enqueue the crm job
  if (row.event_type === "crm.sync") {
    const p = payload as { connectionId?: string; model?: string };
    if (p.connectionId && p.model) {
      await enqueue("crm.sync", {
        connectionId: p.connectionId,
        model: p.model as "Contact" | "Company" | "Account",
      });
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
