import "@tanstack/react-start/server-only";

import { randomBytes } from "node:crypto";
import { env } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import type { WebhookEventType } from "@quiksend/db/schema";
import { enqueue } from "@quiksend/queue";
import { and, eq, sql } from "drizzle-orm";

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

const BLOCKED_WEBHOOK_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

const BLOCKED_WEBHOOK_SUFFIXES = [".local", ".internal", ".test", ".localhost"] as const;

const BLOCKED_WEBHOOK_IPV4_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
] as const;

const CLOUD_METADATA_WEBHOOK_HOSTS = new Set(["169.254.169.254", "metadata.google.internal"]);

function isBlockedWebhookIpv4(host: string): boolean {
  if (CLOUD_METADATA_WEBHOOK_HOSTS.has(host)) return true;
  return BLOCKED_WEBHOOK_IPV4_PATTERNS.some((pattern) => pattern.test(host));
}

function normalizeWebhookHost(host: string): string {
  const lower = host.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]")) {
    return lower.slice(1, -1);
  }
  return lower;
}

function isBlockedWebhookIpv6(host: string): boolean {
  const normalized = normalizeWebhookHost(host);
  if (normalized === "::1") return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  return false;
}

function isBlockedWebhookHostname(host: string): boolean {
  const lower = normalizeWebhookHost(host);
  if (BLOCKED_WEBHOOK_HOSTNAMES.has(lower)) return true;
  if (BLOCKED_WEBHOOK_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true;
  if (isBlockedWebhookIpv4(lower)) return true;
  if (isBlockedWebhookIpv6(lower)) return true;
  return false;
}

export function isAllowedWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && env.NODE_ENV === "production") return false;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (isBlockedWebhookHostname(parsed.hostname)) {
      return false;
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
