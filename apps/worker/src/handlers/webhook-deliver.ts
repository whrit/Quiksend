import { createHmac, timingSafeEqual } from "node:crypto";
import { env, logger } from "@quiksend/config";
import { db, tables } from "@quiksend/db";
import { enqueue, registerHandler } from "@quiksend/queue";
import { and, eq, lte } from "drizzle-orm";

export const WEBHOOK_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  3 * 60 * 60_000,
  12 * 60 * 60_000,
] as const;

export const MAX_WEBHOOK_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length;

export function signWebhookPayload(payload: unknown, secret: string, timestamp: number): string {
  const body = `${timestamp}.${JSON.stringify(payload)}`;
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyWebhookSignature(input: {
  payload: unknown;
  secret: string;
  timestamp: number;
  signature: string;
  maxSkewSeconds?: number;
}): boolean {
  const maxSkew = input.maxSkewSeconds ?? 300;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.timestamp) > maxSkew) return false;

  const expected = signWebhookPayload(input.payload, input.secret, input.timestamp);
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

export async function registerWebhookSweep(): Promise<void> {
  const { intervalMs, batchSize } = getWebhookSweepConfig();
  const interval = setInterval(() => {
    void sweepPendingWebhookDeliveries(batchSize).catch((err) => {
      logger.error({ err }, "webhook delivery sweep failed");
    });
  }, intervalMs);
  interval.unref();
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
    const signature = signWebhookPayload(payload, endpoint.secret, timestamp);
    const attempt = delivery.attempts + 1;

    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let succeeded = false;

    try {
      const res = await fetch(endpoint.url, {
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
