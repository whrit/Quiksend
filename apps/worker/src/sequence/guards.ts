import { db, tables } from "@quiksend/db";
import { and, eq, sql } from "drizzle-orm";
import type { EnrollmentContext } from "./context.ts";

const SUPPRESSED_STATUSES = new Set(["unsubscribed", "do_not_contact"]);

export function isSuppressed(ctx: EnrollmentContext): boolean {
  return SUPPRESSED_STATUSES.has(ctx.prospect.status);
}

export async function hasReplyOnThread(ctx: EnrollmentContext): Promise<boolean> {
  if (!ctx.enrollment.anchorThreadId && !ctx.enrollment.anchorMessageId) return false;

  const conditions = [eq(tables.message.organizationId, ctx.organizationId)];
  const threadId = ctx.enrollment.anchorThreadId;
  const anchorId = ctx.enrollment.anchorMessageId;

  if (threadId) {
    const rows = await db
      .select({ id: tables.message.id })
      .from(tables.message)
      .where(
        and(
          ...conditions,
          eq(tables.message.direction, "inbound"),
          eq(tables.message.providerThreadId, threadId),
        ),
      )
      .limit(1);
    if (rows.length > 0) return true;
  }

  if (anchorId) {
    const rows = await db.execute<{ id: string }>(sql`
      select id from message
      where organization_id = ${ctx.organizationId}
        and direction = 'inbound'
        and (
          in_reply_to = ${anchorId}
          or references_header ilike ${`%${anchorId}%`}
        )
      limit 1
    `);
    if (rows.length > 0) return true;
  }

  return false;
}
