import { emailDomain } from "@quiksend/core";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, eq, or, sql } from "drizzle-orm";
import type { EnrollmentContext } from "./context.ts";

const SUPPRESSED_STATUSES = new Set(["unsubscribed", "do_not_contact", "bounced"]);

export function isProspectStatusSuppressed(status: string): boolean {
  return SUPPRESSED_STATUSES.has(status);
}

/** Query suppression table for email or domain match. */
export async function isSuppressionListed(organizationId: string, email: string): Promise<boolean> {
  const normalized = email.toLowerCase();
  const domain = emailDomain(normalized);

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
          eq(tables.message.isAutoReply, false),
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
        and is_auto_reply = false
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

/**
 * Fail-closed pre-send safety check. Every send entry point — worker auto,
 * web compose, inbox reply — MUST reject when any condition returns not-ok.
 *
 * Synchronous checks only; callers add async suppression-list and
 * reply-on-thread queries at their own layer (in-tx or out-of-tx).
 */
export type SendSafeResult = { ok: true } | { ok: false; reason: string };

export function checkSendPreConditions(opts: {
  mailboxStatus: string;
  prospectStatus: string;
  prospectDeletedAt: Date | null;
  enrollmentState?: string | null;
}): SendSafeResult {
  if (opts.mailboxStatus === "archived") {
    return { ok: false, reason: "mailbox_archived" };
  }
  if (opts.prospectDeletedAt != null) {
    return { ok: false, reason: "prospect_deleted" };
  }
  if (isProspectStatusSuppressed(opts.prospectStatus)) {
    return { ok: false, reason: "suppressed" };
  }
  if (
    opts.enrollmentState != null &&
    opts.enrollmentState !== "active" &&
    opts.enrollmentState !== "waiting_manual"
  ) {
    return { ok: false, reason: "enrollment_not_active" };
  }
  return { ok: true };
}
