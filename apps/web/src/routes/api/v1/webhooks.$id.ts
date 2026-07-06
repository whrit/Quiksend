import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { SUPPORTED_WEBHOOK_EVENTS } from "@quiksend/db/schema";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isAllowedWebhookUrl } from "@/lib/api/v1/helpers.ts";
import { jsonData, jsonError, parseJsonBody, withApiAuth } from "@/lib/api/v1/middleware.ts";

/**
 * REST-canonical PATCH/DELETE by path param.
 *
 * The existing `webhooks.ts` route keeps PATCH-with-body-id and DELETE-with-?id=
 * shapes for backwards compatibility (see docs/api.md compat note). New callers
 * should use these path-param verbs — they match every other resource in the API
 * (`/prospects/{id}`, `/webhooks/{id}/deliveries`, ...).
 */

const webhookEventSchema = z.enum(SUPPORTED_WEBHOOK_EVENTS);

const updateSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(webhookEventSchema).min(1).optional(),
  status: z.enum(["active", "paused", "error"]).optional(),
});

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

export const Route = createFileRoute("/api/v1/webhooks/$id")({
  server: {
    handlers: {
      PATCH: ({ request, params }: { request: Request; params: { id: string } }) =>
        withApiAuth(request, async (ctx) => {
          const uuid = z.string().uuid().safeParse(params.id);
          if (!uuid.success) return jsonError("VALIDATION", "Webhook id must be a UUID", 400);

          const body = await parseJsonBody<Record<string, unknown>>(request);
          if (!body) return jsonError("INVALID_JSON", "Request body must be valid JSON", 400);

          const parsed = updateSchema.safeParse(body);
          if (!parsed.success) return jsonError("VALIDATION", parsed.error.message, 400);
          if (parsed.data.url && !isAllowedWebhookUrl(parsed.data.url)) {
            return jsonError("VALIDATION", "Webhook URL is not allowed", 400);
          }

          const [updated] = await db
            .update(tables.webhookEndpoint)
            .set(parsed.data)
            .where(
              and(
                eq(tables.webhookEndpoint.id, uuid.data),
                eq(tables.webhookEndpoint.organizationId, ctx.orgId),
              ),
            )
            .returning();

          if (!updated) return jsonError("NOT_FOUND", "Webhook endpoint not found", 404);
          return jsonData(serializeEndpoint(updated));
        }),

      DELETE: ({ request, params }: { request: Request; params: { id: string } }) =>
        withApiAuth(request, async (ctx) => {
          const uuid = z.string().uuid().safeParse(params.id);
          if (!uuid.success) return jsonError("VALIDATION", "Webhook id must be a UUID", 400);

          const [deleted] = await db
            .delete(tables.webhookEndpoint)
            .where(
              and(
                eq(tables.webhookEndpoint.id, uuid.data),
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
