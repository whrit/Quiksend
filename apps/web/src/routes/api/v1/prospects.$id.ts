import { db, tables } from "@quiksend/db";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { jsonData, jsonError, parseJsonBody, withApiAuth } from "@/lib/api/v1/middleware.ts";

const prospectStatusSchema = z.enum([
  "new",
  "active",
  "replied",
  "bounced",
  "unsubscribed",
  "do_not_contact",
]);

function serializeProspect(row: typeof tables.prospect.$inferSelect) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    title: row.title,
    status: row.status,
    companyId: row.companyId,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const Route = createFileRoute("/api/v1/prospects/$id")({
  server: {
    handlers: {
      GET: ({ request, params }: { request: Request; params: { id: string } }) =>
        withApiAuth(request, async (ctx) => {
          const row = await db.query.prospect.findFirst({
            where: and(
              eq(tables.prospect.id, params.id),
              eq(tables.prospect.organizationId, ctx.orgId),
              isNull(tables.prospect.deletedAt),
            ),
          });
          if (!row) return jsonError("NOT_FOUND", "Prospect not found", 404);
          return jsonData(serializeProspect(row));
        }),

      PATCH: ({ request, params }: { request: Request; params: { id: string } }) =>
        withApiAuth(request, async (ctx) => {
          const body = await parseJsonBody<Record<string, unknown>>(request);
          if (!body) return jsonError("INVALID_JSON", "Request body must be valid JSON", 400);

          const patch = z
            .object({
              firstName: z.string().max(200).nullable().optional(),
              lastName: z.string().max(200).nullable().optional(),
              title: z.string().max(200).nullable().optional(),
              status: prospectStatusSchema.optional(),
              companyId: z.string().uuid().nullable().optional(),
            })
            .strict()
            .safeParse(body);

          if (!patch.success) return jsonError("VALIDATION", patch.error.message, 400);

          const [updated] = await db
            .update(tables.prospect)
            .set(patch.data)
            .where(
              and(
                eq(tables.prospect.id, params.id),
                eq(tables.prospect.organizationId, ctx.orgId),
                isNull(tables.prospect.deletedAt),
              ),
            )
            .returning();

          if (!updated) return jsonError("NOT_FOUND", "Prospect not found", 404);
          return jsonData(serializeProspect(updated));
        }),

      DELETE: ({ request, params }: { request: Request; params: { id: string } }) =>
        withApiAuth(request, async (ctx) => {
          const [deleted] = await db
            .update(tables.prospect)
            .set({ deletedAt: new Date() })
            .where(
              and(
                eq(tables.prospect.id, params.id),
                eq(tables.prospect.organizationId, ctx.orgId),
                isNull(tables.prospect.deletedAt),
              ),
            )
            .returning({ id: tables.prospect.id });

          if (!deleted) return jsonError("NOT_FOUND", "Prospect not found", 404);
          return jsonData({ ok: true });
        }),
    },
  },
});
