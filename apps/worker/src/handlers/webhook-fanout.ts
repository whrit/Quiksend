import { randomUUID } from "node:crypto";
import { db, insertOutbox } from "@quiksend/db";
import type { WebhookEventType } from "@quiksend/db/schema";
import { enqueue } from "@quiksend/queue";
import {
  computeNextAttemptAt,
  registerWebhookDeliverHandler,
  registerWebhookSweep,
  sweepPendingWebhookDeliveries,
} from "./webhook-deliver.ts";

/**
 * Routes webhook events through the transactional outbox.
 * Backward-compat wrapper for callers that don't have their own tx
 * (canary-check, gateway-detect, etc.). The outbox dispatcher
 * creates webhook deliveries after commit.
 */
export async function fanoutWebhookEvent(input: {
  organizationId: string;
  eventType: WebhookEventType | string;
  payload: Record<string, unknown>;
}): Promise<string[]> {
  await db.transaction(async (tx) => {
    await insertOutbox(tx, {
      organizationId: input.organizationId,
      eventType: input.eventType,
      aggregateType: "webhook",
      aggregateId: "00000000-0000-0000-0000-000000000000",
      payload: input.payload,
      idempotencyKey: `${input.eventType}:${randomUUID()}`,
    });
  });
  try {
    await enqueue("outbox.dispatch", {});
  } catch {
    // ponytail: sweep recovers
  }
  return [];
}

export async function registerWebhookFanoutHandler(): Promise<void> {
  await registerWebhookDeliverHandler();
  await registerWebhookSweep();
}

export { computeNextAttemptAt, sweepPendingWebhookDeliveries };
