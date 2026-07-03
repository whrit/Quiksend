import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, eq, or, sql } from "drizzle-orm";
import type { EnrollmentContext } from "./context.ts";

const SUPPRESSED_STATUSES = new Set(["unsubscribed", "do_not_contact", "bounced"]);

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : email.toLowerCase();
}

export function emailDomain(email: string): string {
  return domainOf(email);
}

export function isProspectStatusSuppressed(status: string): boolean {
  return SUPPRESSED_STATUSES.has(status);
}

/** Query suppression table for email or domain match. */
export async function isSuppressionListed(organizationId: string, email: string): Promise<boolean> {
  const normalized = email.toLowerCase();
  const domain = domainOf(normalized);

  const rows = await db
    .select({ id: tables.suppression.id })
    .from(tables.suppression)
    .where(
      and(
        eq(tables.suppression.organizationId, organizationId),
        or(
          and(eq(tables.suppression.valueType, "email"), eq(tables.suppression.value, normalized)),
          and(eq(tables.suppression.valueType, "domain"), eq(tables.suppression.value, domain)),
        ),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export async function isSuppressed(ctx: EnrollmentContext): Promise<boolean> {
  if (isProspectStatusSuppressed(ctx.prospect.status)) return true;
  return isSuppressionListed(ctx.organizationId, ctx.prospect.email);
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
