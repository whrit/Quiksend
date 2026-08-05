import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema/index.ts";
import { eventOutbox } from "./schema/api.ts";

type DbTx = PostgresJsDatabase<typeof schema>;

export interface OutboxIntent {
  organizationId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  idempotencyKey: string;
}

/**
 * Insert a dispatch intent into the transactional outbox.
 * MUST be called inside the caller's source transaction so the intent
 * is atomic with the domain mutation. `(event_type, idempotency_key)` is
 * unique — duplicate intents are silently ignored.
 *
 * Returns the outbox row id (empty string on duplicate).
 */
export async function insertOutbox(tx: DbTx, intent: OutboxIntent): Promise<string> {
  const [row] = await tx
    .insert(eventOutbox)
    .values({
      organizationId: intent.organizationId,
      eventType: intent.eventType,
      aggregateType: intent.aggregateType,
      aggregateId: intent.aggregateId,
      payload: intent.payload,
      idempotencyKey: intent.idempotencyKey,
    })
    .onConflictDoNothing()
    .returning({ id: eventOutbox.id });
  return row?.id ?? "";
}
