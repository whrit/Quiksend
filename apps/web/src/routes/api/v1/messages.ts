import { db, tables } from "@quiksend/db";
import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, lt, or } from "drizzle-orm";
import {
  encodeCursor,
  jsonData,
  parseCursor,
  parseLimit,
  withApiAuth,
} from "@/lib/api/v1/middleware.ts";

function serializeMessage(row: typeof tables.message.$inferSelect) {
  return {
    id: row.id,
    mailboxId: row.mailboxId,
    prospectId: row.prospectId,
    enrollmentId: row.enrollmentId,
    direction: row.direction,
    subject: row.subject,
    status: row.status,
    sentAt: row.sentAt?.toISOString() ?? null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const Route = createFileRoute("/api/v1/messages")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        withApiAuth(request, async (ctx) => {
          const url = new URL(request.url);
          const mailboxId = url.searchParams.get("mailbox_id");
          const direction = url.searchParams.get("direction");
          const limit = parseLimit(url.searchParams.get("limit"));
          const cursor = parseCursor(url.searchParams.get("cursor"));

          const conditions = [eq(tables.message.organizationId, ctx.orgId)];

          if (mailboxId) {
            conditions.push(eq(tables.message.mailboxId, mailboxId));
          }
          if (direction === "inbound" || direction === "outbound") {
            conditions.push(eq(tables.message.direction, direction));
          }
          if (cursor) {
            const cursorDate = new Date(cursor.createdAt);
            conditions.push(
              or(
                lt(tables.message.createdAt, cursorDate),
                and(eq(tables.message.createdAt, cursorDate), lt(tables.message.id, cursor.id)),
              )!,
            );
          }

          const rows = await db
            .select()
            .from(tables.message)
            .where(and(...conditions))
            .orderBy(desc(tables.message.createdAt), desc(tables.message.id))
            .limit(limit + 1);

          const hasMore = rows.length > limit;
          const page = hasMore ? rows.slice(0, limit) : rows;
          const last = page.at(-1);

          return jsonData({
            items: page.map(serializeMessage),
            nextCursor:
              hasMore && last
                ? encodeCursor({ id: last.id, createdAt: last.createdAt.toISOString() })
                : null,
          });
        }),
    },
  },
});
