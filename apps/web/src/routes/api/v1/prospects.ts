import { db, tables } from "@quiksend/db";
import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  encodeCursor,
  jsonData,
  jsonError,
  parseCursor,
  parseJsonBody,
  parseLimit,
  withApiAuth,
} from "@/lib/api/v1/middleware.ts";
import { normalizeEmail } from "@/lib/prospect-import.ts";
import { apiCreateProspectSchema, prospectStatusSchema } from "@/lib/schemas/prospect.ts";

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

export const Route = createFileRoute("/api/v1/prospects")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        withApiAuth(request, async (ctx) => {
          const url = new URL(request.url);
          const status = url.searchParams.getAll("status");
          const listId = url.searchParams.get("list_id");
          const limit = parseLimit(url.searchParams.get("limit"));
          const cursor = parseCursor(url.searchParams.get("cursor"));

          const conditions = [
            eq(tables.prospect.organizationId, ctx.orgId),
            isNull(tables.prospect.deletedAt),
          ];

          const validStatuses = status.filter(
            (s): s is z.infer<typeof prospectStatusSchema> =>
              prospectStatusSchema.safeParse(s).success,
          );
          if (validStatuses.length) {
            conditions.push(inArray(tables.prospect.status, validStatuses));
          }

          if (listId) {
            conditions.push(
              sql`${tables.prospect.id} in (select ${tables.listMember.prospectId} from ${tables.listMember} inner join ${tables.list} on ${tables.listMember.listId} = ${tables.list.id} where ${tables.listMember.listId} = ${listId} and ${tables.list.organizationId} = ${ctx.orgId})`,
            );
          }

          if (cursor) {
            const cursorDate = new Date(cursor.createdAt);
            conditions.push(
              or(
                lt(tables.prospect.createdAt, cursorDate),
                and(eq(tables.prospect.createdAt, cursorDate), lt(tables.prospect.id, cursor.id)),
              )!,
            );
          }

          const rows = await db
            .select()
            .from(tables.prospect)
            .where(and(...conditions))
            .orderBy(desc(tables.prospect.createdAt), desc(tables.prospect.id))
            .limit(limit + 1);

          const hasMore = rows.length > limit;
          const page = hasMore ? rows.slice(0, limit) : rows;
          const last = page.at(-1);

          return jsonData({
            items: page.map(serializeProspect),
            nextCursor:
              hasMore && last
                ? encodeCursor({ id: last.id, createdAt: last.createdAt.toISOString() })
                : null,
          });
        }),

      POST: ({ request }: { request: Request }) =>
        withApiAuth(request, async (ctx) => {
          const body = await parseJsonBody<Record<string, unknown>>(request);
          if (!body) return jsonError("INVALID_JSON", "Request body must be valid JSON", 400);

          const parsed = apiCreateProspectSchema.safeParse(body);

          if (!parsed.success) {
            return jsonError("VALIDATION", parsed.error.message, 400);
          }

          const email = normalizeEmail(parsed.data.email);
          if (!email) return jsonError("VALIDATION", "Invalid email address", 400);

          const existing = await db.query.prospect.findFirst({
            where: and(
              eq(tables.prospect.organizationId, ctx.orgId),
              eq(tables.prospect.email, email),
            ),
          });

          if (existing) {
            if (existing.deletedAt) {
              const [restored] = await db
                .update(tables.prospect)
                .set({
                  deletedAt: null,
                  firstName: parsed.data.firstName ?? existing.firstName,
                  lastName: parsed.data.lastName ?? existing.lastName,
                  title: parsed.data.title ?? existing.title,
                  status: parsed.data.status ?? existing.status,
                  companyId: parsed.data.companyId ?? existing.companyId,
                  source: "api",
                })
                .where(
                  and(
                    eq(tables.prospect.id, existing.id),
                    eq(tables.prospect.organizationId, ctx.orgId),
                  ),
                )
                .returning();
              return jsonData(serializeProspect(restored!), 200);
            }

            const [updated] = await db
              .update(tables.prospect)
              .set({
                firstName: parsed.data.firstName ?? existing.firstName,
                lastName: parsed.data.lastName ?? existing.lastName,
                title: parsed.data.title ?? existing.title,
                status: parsed.data.status ?? existing.status,
                companyId: parsed.data.companyId ?? existing.companyId,
                source: "api",
              })
              .where(
                and(
                  eq(tables.prospect.id, existing.id),
                  eq(tables.prospect.organizationId, ctx.orgId),
                ),
              )
              .returning();
            return jsonData(serializeProspect(updated!), 200);
          }

          const [created] = await db
            .insert(tables.prospect)
            .values({
              organizationId: ctx.orgId,
              email,
              firstName: parsed.data.firstName,
              lastName: parsed.data.lastName,
              title: parsed.data.title,
              status: parsed.data.status ?? "new",
              companyId: parsed.data.companyId,
              source: "api",
            })
            .returning();

          return jsonData(serializeProspect(created!), 201);
        }),
    },
  },
});
