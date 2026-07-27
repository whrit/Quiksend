import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { env, logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { enqueue, registerHandler } from "@quiksend/queue";
import { and, eq, lte } from "drizzle-orm";

export const WEBHOOK_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  3 * 60 * 60_000,
  12 * 60 * 60_000,
] as const;

export const MAX_WEBHOOK_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length + 1;

export function signWebhookPayload(
  payload: unknown,
  secret: string,
  timestamp: number,
  deliveryId: string,
): string {
  const body = `${timestamp}.${deliveryId}.${JSON.stringify(payload)}`;
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyWebhookSignature(input: {
  payload: unknown;
  secret: string;
  timestamp: number;
  signature: string;
  deliveryId: string;
  maxSkewSeconds?: number;
}): boolean {
  const maxSkew = input.maxSkewSeconds ?? 300;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.timestamp) > maxSkew) return false;

  const expected = signWebhookPayload(
    input.payload,
    input.secret,
    input.timestamp,
    input.deliveryId,
  );
  const sig = input.signature.trim().toLowerCase();
  const exp = expected.toLowerCase();
  if (sig.length !== exp.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(exp));
}

export function computeNextAttemptAt(attempts: number): Date | null {
  const delay = WEBHOOK_RETRY_DELAYS_MS[attempts - 1];
  if (delay === undefined) return null;
  return new Date(Date.now() + delay);
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

function isBlockedWebhookIpv6(address: string): boolean {
  const normalized = normalizeWebhookHost(address);
  if (normalized === "::1") return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  return false;
}

function isBlockedWebhookLiteralHost(host: string): boolean {
  const lower = normalizeWebhookHost(host);
  if (BLOCKED_WEBHOOK_HOSTNAMES.has(lower)) return true;
  if (BLOCKED_WEBHOOK_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true;
  if (isBlockedWebhookIpv4(lower)) return true;
  if (isBlockedWebhookIpv6(lower)) return true;
  return false;
}

function isBlockedWebhookResolvedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedWebhookIpv4(address);
  if (version === 6) return isBlockedWebhookIpv6(address);
  return true;
}

export async function validateWebhookDeliveryUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid webhook URL");
  }

  if (parsed.protocol !== "https:" && env.NODE_ENV === "production") {
    throw new Error("Webhook URL must use HTTPS in production");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Webhook URL must use HTTP or HTTPS");
  }

  const host = normalizeWebhookHost(parsed.hostname);
  if (isBlockedWebhookLiteralHost(host)) {
    throw new Error("Webhook URL resolves to a blocked host");
  }

  if (isIP(host)) return;

  const results = await lookup(host, { all: true, verbatim: true });
  if (results.length === 0) {
    throw new Error("Webhook URL hostname did not resolve");
  }

  for (const { address } of results) {
    if (isBlockedWebhookResolvedAddress(address)) {
      throw new Error("Webhook URL resolves to a private or metadata address");
    }
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function fetchWebhookWithSsrfProtection(
  url: string,
  init: RequestInit,
  maxRedirects = 5,
): Promise<Response> {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    await validateWebhookDeliveryUrl(currentUrl);
    const res = await fetch(currentUrl, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(res.status)) return res;

    const location = res.headers.get("location");
    if (!location) return res;

    currentUrl = new URL(location, currentUrl).href;
  }

  throw new Error("Webhook delivery exceeded redirect limit");
}

export function getWebhookSweepConfig(): { intervalMs: number; batchSize: number } {
  return {
    intervalMs: env.WEBHOOK_SWEEP_INTERVAL_MS,
    batchSize: env.WEBHOOK_SWEEP_BATCH_SIZE,
  };
}

export async function sweepPendingWebhookDeliveries(
  limit = env.WEBHOOK_SWEEP_BATCH_SIZE,
): Promise<number> {
  const now = new Date();
  const pending = await db.query.webhookDelivery.findMany({
    where: and(
      eq(tables.webhookDelivery.status, "pending"),
      lte(tables.webhookDelivery.nextAttemptAt, now),
    ),
    limit,
  });

  for (const row of pending) {
    await enqueue("webhook.deliver", { deliveryId: row.id });
  }
  return pending.length;
}

let webhookSweepInterval: ReturnType<typeof setInterval> | null = null;
let webhookDeliverShutdownHooksRegistered = false;

export function shutdownWebhookDeliver(): void {
  if (webhookSweepInterval !== null) {
    clearInterval(webhookSweepInterval);
    webhookSweepInterval = null;
  }
}

function registerWebhookDeliverShutdownHooks(): void {
  if (webhookDeliverShutdownHooksRegistered) return;
  webhookDeliverShutdownHooksRegistered = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, shutdownWebhookDeliver);
  }
}

export async function registerWebhookSweep(): Promise<void> {
  registerWebhookDeliverShutdownHooks();
  shutdownWebhookDeliver();

  const { intervalMs, batchSize } = getWebhookSweepConfig();
  webhookSweepInterval = setInterval(() => {
    void sweepPendingWebhookDeliveries(batchSize).catch((err) => {
      logger.error({ err }, "webhook delivery sweep failed");
    });
  }, intervalMs);
  webhookSweepInterval.unref();
}

export async function registerWebhookDeliverHandler(): Promise<void> {
  await registerHandler("webhook.deliver", async ({ deliveryId }) => {
    const delivery = await db.query.webhookDelivery.findFirst({
      where: eq(tables.webhookDelivery.id, deliveryId),
      with: { endpoint: true },
    });

    if (!delivery?.endpoint) {
      logger.warn({ deliveryId }, "webhook.deliver: delivery or endpoint not found");
      return;
    }

    if (delivery.status === "succeeded" || delivery.status === "dead") return;

    const endpoint = delivery.endpoint;
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = delivery.payload as Record<string, unknown>;
    const signature = signWebhookPayload(payload, endpoint.secret, timestamp, deliveryId);
    const attempt = delivery.attempts + 1;

    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let succeeded = false;

    try {
      const res = await fetchWebhookWithSsrfProtection(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Quiksend-Signature": signature,
          "X-Quiksend-Delivery-Id": deliveryId,
          "X-Quiksend-Timestamp": String(timestamp),
          "X-Quiksend-Event": delivery.eventType,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });

      responseStatus = res.status;
      responseBody = (await res.text()).slice(0, 4000);
      succeeded = res.ok;
    } catch (err) {
      responseBody = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err, deliveryId, organizationId: delivery.organizationId },
        "webhook delivery failed",
      );
    }

    if (succeeded) {
      await db
        .update(tables.webhookDelivery)
        .set({
          status: "succeeded",
          attempts: attempt,
          responseStatus,
          responseBody,
          nextAttemptAt: null,
        })
        .where(
          and(
            eq(tables.webhookDelivery.id, deliveryId),
            eq(tables.webhookDelivery.organizationId, delivery.organizationId),
          ),
        );
      return;
    }

    const nextAttemptAt = computeNextAttemptAt(attempt);
    const dead = attempt >= MAX_WEBHOOK_ATTEMPTS || nextAttemptAt === null;

    await db
      .update(tables.webhookDelivery)
      .set({
        status: dead ? "dead" : "pending",
        attempts: attempt,
        responseStatus,
        responseBody,
        nextAttemptAt: dead ? null : nextAttemptAt,
      })
      .where(
        and(
          eq(tables.webhookDelivery.id, deliveryId),
          eq(tables.webhookDelivery.organizationId, delivery.organizationId),
        ),
      );

    if (dead) {
      await db
        .update(tables.webhookEndpoint)
        .set({ status: "error" })
        .where(
          and(
            eq(tables.webhookEndpoint.id, endpoint.id),
            eq(tables.webhookEndpoint.organizationId, delivery.organizationId),
          ),
        );
    }
  });
}
