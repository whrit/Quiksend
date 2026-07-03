import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { SUPPORTED_WEBHOOK_EVENTS } from "@quiksend/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  generateWebhookSecret,
  insertDomainEventAndFanout,
  isAllowedWebhookUrl,
} from "./api/v1/helpers.ts";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./org-fn.ts";

const webhookEventSchema = z.enum(SUPPORTED_WEBHOOK_EVENTS);

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(webhookEventSchema).min(1),
});

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(webhookEventSchema).min(1).optional(),
  status: z.enum(["active", "paused", "error"]).optional(),
});

function serializeEndpoint(row: typeof tables.webhookEndpoint.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    url: row.url,
    events: row.events,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeDelivery(row: typeof tables.webhookDelivery.$inferSelect) {
  return {
    id: row.id,
    endpointId: row.endpointId,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const listWebhookEndpoints = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({}))
  .handler(async ({ context }) => {
    const { organizationId } = context.orgContext;
    const rows = await db.query.webhookEndpoint.findMany({
      where: eq(tables.webhookEndpoint.organizationId, organizationId),
      orderBy: desc(tables.webhookEndpoint.createdAt),
    });
    return rows.map(serializeEndpoint);
  });

export const createWebhookEndpoint = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(createWebhookSchema)
  .handler(async ({ data, context }) => {
    const { organizationId, userId } = context.orgContext;
    if (!isAllowedWebhookUrl(data.url)) {
      throw new Error("Webhook URL is not allowed");
    }

    const [created] = await db
      .insert(tables.webhookEndpoint)
      .values({
        organizationId,
        url: data.url,
        secret: generateWebhookSecret(),
        events: data.events,
        status: "active",
        createdByUserId: userId,
      })
      .returning();

    return serializeEndpoint(created!);
  });

export const updateWebhookEndpoint = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.string().uuid(),
      patch: updateWebhookSchema,
    }),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    if (data.patch.url && !isAllowedWebhookUrl(data.patch.url)) {
      throw new Error("Webhook URL is not allowed");
    }

    const [updated] = await db
      .update(tables.webhookEndpoint)
      .set(data.patch)
      .where(
        and(
          eq(tables.webhookEndpoint.id, data.id),
          eq(tables.webhookEndpoint.organizationId, organizationId),
        ),
      )
      .returning();

    if (!updated) throw new Error("Webhook endpoint not found");
    return serializeEndpoint(updated);
  });

export const deleteWebhookEndpoint = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const [deleted] = await db
      .delete(tables.webhookEndpoint)
      .where(
        and(
          eq(tables.webhookEndpoint.id, data.id),
          eq(tables.webhookEndpoint.organizationId, organizationId),
        ),
      )
      .returning({ id: tables.webhookEndpoint.id });

    if (!deleted) throw new Error("Webhook endpoint not found");
    return { ok: true as const };
  });

export const listWebhookDeliveries = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      endpointId: z.string().uuid(),
      limit: z.number().int().min(1).max(100).default(25),
    }),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const endpoint = await db.query.webhookEndpoint.findFirst({
      where: and(
        eq(tables.webhookEndpoint.id, data.endpointId),
        eq(tables.webhookEndpoint.organizationId, organizationId),
      ),
    });
    if (!endpoint) throw new Error("Webhook endpoint not found");

    const rows = await db.query.webhookDelivery.findMany({
      where: and(
        eq(tables.webhookDelivery.endpointId, data.endpointId),
        eq(tables.webhookDelivery.organizationId, organizationId),
      ),
      orderBy: desc(tables.webhookDelivery.createdAt),
      limit: data.limit,
    });

    return rows.map(serializeDelivery);
  });

export const triggerTestWebhookEvent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      eventType: webhookEventSchema,
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const payload = {
      test: true,
      organizationId,
      ...data.payload,
    };
    const result = await insertDomainEventAndFanout({
      organizationId,
      eventType: data.eventType,
      payload,
    });
    return result;
  });

// Note: `fanoutWebhookEvent` + `insertDomainEventAndFanout` live in
// `./api/v1/helpers.ts` (server-only). Consumers on the server import them
// directly from there; re-exporting them here would drag the server-only
// module into any client route that imports this file.
