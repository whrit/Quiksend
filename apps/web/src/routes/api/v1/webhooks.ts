import { db, tables } from "@quiksend/db";
import { SUPPORTED_WEBHOOK_EVENTS } from "@quiksend/db/schema";
import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { generateWebhookSecret, isAllowedWebhookUrl } from "@/lib/api/v1/helpers.ts";
import { jsonData, jsonError, parseJsonBody, withApiAuth } from "@/lib/api/v1/middleware.ts";

const webhookEventSchema = z.enum(SUPPORTED_WEBHOOK_EVENTS);

function serializeEndpoint(row: typeof tables.webhookEndpoint.$inferSelect) {
  return {
    id: row.id,
    url: row.url,
    events: row.events,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const Route = createFileRoute("/api/v1/webhooks")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        withApiAuth(request, async (ctx) => {
          const rows = await db.query.webhookEndpoint.findMany({
            where: eq(tables.webhookEndpoint.organizationId, ctx.orgId),
            orderBy: desc(tables.webhookEndpoint.createdAt),
          });
          return jsonData({ items: rows.map(serializeEndpoint) });
        }),

      POST: ({ request }: { request: Request }) =>
        withApiAuth(request, async (ctx) => {
          const body = await parseJsonBody<Record<string, unknown>>(request);
          if (!body) return jsonError("INVALID_JSON", "Request body must be valid JSON", 400);

          const parsed = z
            .object({
              url: z.string().url(),
              events: z.array(webhookEventSchema).min(1),
            })
            .safeParse(body);

          if (!parsed.success) return jsonError("VALIDATION", parsed.error.message, 400);
          if (!isAllowedWebhookUrl(parsed.data.url)) {
            return jsonError("VALIDATION", "Webhook URL is not allowed", 400);
          }

          const [created] = await db
            .insert(tables.webhookEndpoint)
            .values({
              organizationId: ctx.orgId,
              url: parsed.data.url,
              secret: generateWebhookSecret(),
              events: parsed.data.events,
              status: "active",
              createdByUserId: ctx.userId,
            })
            .returning();

          return jsonData(serializeEndpoint(created!), 201);
        }),

      PATCH: ({ request }: { request: Request }) =>
        withApiAuth(request, async (ctx) => {
          const body = await parseJsonBody<Record<string, unknown>>(request);
          if (!body) return jsonError("INVALID_JSON", "Request body must be valid JSON", 400);

          const parsed = z
            .object({
              id: z.string().uuid(),
              url: z.string().url().optional(),
              events: z.array(webhookEventSchema).min(1).optional(),
              status: z.enum(["active", "paused", "error"]).optional(),
            })
            .safeParse(body);

          if (!parsed.success) return jsonError("VALIDATION", parsed.error.message, 400);
          if (parsed.data.url && !isAllowedWebhookUrl(parsed.data.url)) {
            return jsonError("VALIDATION", "Webhook URL is not allowed", 400);
          }

          const { id, ...patch } = parsed.data;
          const [updated] = await db
            .update(tables.webhookEndpoint)
            .set(patch)
            .where(
              and(
                eq(tables.webhookEndpoint.id, id),
                eq(tables.webhookEndpoint.organizationId, ctx.orgId),
              ),
            )
            .returning();

          if (!updated) return jsonError("NOT_FOUND", "Webhook endpoint not found", 404);
          return jsonData(serializeEndpoint(updated));
        }),

      DELETE: ({ request }: { request: Request }) =>
        withApiAuth(request, async (ctx) => {
          const url = new URL(request.url);
          const id = url.searchParams.get("id");
          if (!id) return jsonError("VALIDATION", "Missing id query parameter", 400);

          const [deleted] = await db
            .delete(tables.webhookEndpoint)
            .where(
              and(
                eq(tables.webhookEndpoint.id, id),
                eq(tables.webhookEndpoint.organizationId, ctx.orgId),
              ),
            )
            .returning({ id: tables.webhookEndpoint.id });

          if (!deleted) return jsonError("NOT_FOUND", "Webhook endpoint not found", 404);
          return jsonData({ ok: true });
        }),
    },
  },
});
