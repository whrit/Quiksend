import { randomBytes } from "node:crypto";
import { env } from "@quiksend/config";
import { db, tables } from "@quiksend/db";
import type { WebhookEventType } from "@quiksend/db/schema";
import { enqueue } from "@quiksend/queue";
import { and, eq, sql } from "drizzle-orm";

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

export function isAllowedWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && env.NODE_ENV === "production") return false;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
      return env.NODE_ENV !== "production";
    }
    if (
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return env.NODE_ENV !== "production";
    }
    return true;
  } catch {
    return false;
  }
}

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
  payload: Record<string, unknown>;
}): Promise<{ eventId: string; deliveryIds: string[] }> {
  const [event] = await db
    .insert(tables.domainEvent)
    .values({
      organizationId: input.organizationId,
      eventType: input.eventType,
      payload: input.payload,
    })
    .returning({ id: tables.domainEvent.id });

  const deliveryIds = await fanoutWebhookEvent(input);
  return { eventId: event?.id ?? "", deliveryIds };
}

export async function countRecentApiKeyUsage(apiKeyId: string, windowMs: number): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tables.apiKeyUsage)
    .where(
      and(
        eq(tables.apiKeyUsage.apiKeyId, apiKeyId),
        sql`${tables.apiKeyUsage.timestamp} >= ${since}`,
      ),
    );
  return rows[0]?.count ?? 0;
}

export async function recordApiKeyUsage(input: {
  organizationId: string;
  apiKeyId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  ipAddress: string | null;
}): Promise<void> {
  await db.insert(tables.apiKeyUsage).values({
    organizationId: input.organizationId,
    apiKeyId: input.apiKeyId,
    endpoint: input.endpoint,
    method: input.method,
    statusCode: input.statusCode,
    ipAddress: input.ipAddress,
  });
}
