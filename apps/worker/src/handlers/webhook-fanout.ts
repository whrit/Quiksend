import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import type { WebhookEventType } from "@quiksend/db/schema";
import { enqueue } from "@quiksend/queue";
import { and, eq } from "drizzle-orm";
import {
  computeNextAttemptAt,
  registerWebhookDeliverHandler,
  registerWebhookSweep,
  sweepPendingWebhookDeliveries,
} from "./webhook-deliver.ts";

export async function fanoutWebhookEvent(input: {
  organizationId: string;
  eventType: WebhookEventType | string;
  payload: Record<string, unknown>;
}): Promise<string[]> {
  const endpoints = await db.query.webhookEndpoint.findMany({
    where: and(
      eq(tables.webhookEndpoint.organizationId, input.organizationId),
      eq(tables.webhookEndpoint.status, "active"),
    ),
  });

  const matching = endpoints.filter((ep) => ep.events.includes(input.eventType));
  const deliveryIds: string[] = [];

  for (const endpoint of matching) {
    const [delivery] = await db
      .insert(tables.webhookDelivery)
      .values({
        organizationId: input.organizationId,
        endpointId: endpoint.id,
        eventType: input.eventType,
        payload: input.payload,
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
      })
      .returning({ id: tables.webhookDelivery.id });

    if (delivery) {
      deliveryIds.push(delivery.id);
      await enqueue("webhook.deliver", { deliveryId: delivery.id });
    }
  }

  return deliveryIds;
}

export async function insertDomainEventAndFanout(input: {
  organizationId: string;
  eventType: WebhookEventType | string;
  entityType?: string;
  entityId?: string;
  payload: Record<string, unknown>;
}): Promise<{ eventId: string; deliveryIds: string[] }> {
  const [row] = await db
    .insert(tables.event)
    .values({
      organizationId: input.organizationId,
      type: input.eventType,
      entityType: input.entityType ?? "webhook",
      entityId: input.entityId ?? "00000000-0000-0000-0000-000000000000",
      payload: input.payload,
    })
    .returning({ id: tables.event.id });

  const deliveryIds = await fanoutWebhookEvent(input);
  return { eventId: row?.id ?? "", deliveryIds };
}

export async function registerWebhookFanoutHandler(): Promise<void> {
  await registerWebhookDeliverHandler();
  await registerWebhookSweep();
}

export { computeNextAttemptAt, sweepPendingWebhookDeliveries };
