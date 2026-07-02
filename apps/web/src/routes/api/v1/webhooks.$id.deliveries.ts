import { db, tables } from "@quiksend/db";
import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq } from "drizzle-orm";
import { jsonData, jsonError, parseLimit, withApiAuth } from "@/lib/api/v1/middleware.ts";

function serializeDelivery(row: typeof tables.webhookDelivery.$inferSelect) {
  return {
    id: row.id,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const Route = createFileRoute("/api/v1/webhooks/$id/deliveries")({
  server: {
    handlers: {
      GET: ({ request, params }: { request: Request; params: { id: string } }) =>
        withApiAuth(request, async (ctx) => {
          const url = new URL(request.url);
          const limit = parseLimit(url.searchParams.get("limit"), 25, 100);

          const endpoint = await db.query.webhookEndpoint.findFirst({
            where: and(
              eq(tables.webhookEndpoint.id, params.id),
              eq(tables.webhookEndpoint.organizationId, ctx.orgId),
            ),
          });
          if (!endpoint) return jsonError("NOT_FOUND", "Webhook endpoint not found", 404);

          const rows = await db.query.webhookDelivery.findMany({
            where: and(
              eq(tables.webhookDelivery.endpointId, params.id),
              eq(tables.webhookDelivery.organizationId, ctx.orgId),
            ),
            orderBy: desc(tables.webhookDelivery.createdAt),
            limit,
          });

          return jsonData({ items: rows.map(serializeDelivery) });
        }),
    },
  },
});
