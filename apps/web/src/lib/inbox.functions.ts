import { env } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { buildComplianceParts, buildUnsubscribeUrl, mintUnsubscribeToken } from "@quiksend/mail";
import { buildThreadingHeaders, normalizeMessageId } from "@quiksend/mail/threading";
import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./org-fn.ts";
import { resolveMailboxAdapter } from "./mailboxes.server.ts";

const inboxFilterSchema = z.object({
  unread: z.boolean().optional(),
  replied: z.boolean().optional(),
  bounced: z.boolean().optional(),
  sequenceId: z.string().uuid().optional(),
  mailboxId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

// Types + server-only reader now live in dedicated files so the client bundle
// can import the shape (`InboxThreadSummary`) without pulling in `db`/`env`.
export type { InboxThreadSummary } from "./inbox-types.ts";
import { listInboxThreadsForOrg } from "./inbox.server.ts";
export { listInboxThreadsForOrg };

function parseOrgPostalAddress(metadata: string | null): string {
  if (!metadata) return "1 Main St, City";
  try {
    const parsed = JSON.parse(metadata) as { postal_address?: string };
    return parsed.postal_address?.trim() || "1 Main St, City";
  } catch {
    return "1 Main St, City";
  }
}

export const listInboxThreads = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => inboxFilterSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return listInboxThreadsForOrg(organizationId, data);
  });

export const getInboxThread = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ threadKey: z.string().min(1) }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const rows = await db.query.message.findMany({
      where: and(
        eq(tables.message.organizationId, organizationId),
        or(
          eq(tables.message.providerThreadId, data.threadKey),
          eq(tables.message.messageIdHeader, data.threadKey),
          eq(tables.message.id, data.threadKey),
        ),
      ),
      orderBy: asc(sql`coalesce(${tables.message.sentAt}, ${tables.message.receivedAt})`),
    });

    if (rows.length === 0) throw new Error("Thread not found");

    const mailbox = await db.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, rows[0]!.mailboxId),
        eq(tables.mailbox.organizationId, organizationId),
      ),
    });

    await db
      .update(tables.message)
      .set({ status: "read" })
      .where(
        and(
          eq(tables.message.organizationId, organizationId),
          eq(tables.message.direction, "inbound"),
          eq(tables.message.status, "received"),
          or(
            eq(tables.message.providerThreadId, data.threadKey),
            eq(tables.message.messageIdHeader, data.threadKey),
            eq(tables.message.id, data.threadKey),
          ),
        ),
      );

    return {
      threadKey: data.threadKey,
      mailbox: mailbox
        ? { id: mailbox.id, address: mailbox.address, displayName: mailbox.displayName }
        : null,
      messages: rows.map((m) => ({
        id: m.id,
        direction: m.direction,
        subject: m.subject,
        bodyHtml: m.bodyHtml,
        bodyText: m.bodyText,
        status: m.status,
        bounceType: m.bounceType,
        sentAt: m.sentAt?.toISOString() ?? null,
        receivedAt: m.receivedAt?.toISOString() ?? null,
        messageIdHeader: m.messageIdHeader,
        inReplyTo: m.inReplyTo,
        enrollmentId: m.enrollmentId,
        prospectId: m.prospectId,
        sentiment: m.sentiment,
      })),
    };
  });

export const sendReply = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        threadKey: z.string().min(1),
        bodyHtml: z.string().min(1),
        bodyText: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const threadMessages = await db.query.message.findMany({
      where: and(
        eq(tables.message.organizationId, organizationId),
        or(
          eq(tables.message.providerThreadId, data.threadKey),
          eq(tables.message.messageIdHeader, data.threadKey),
          eq(tables.message.id, data.threadKey),
        ),
      ),
      orderBy: desc(sql`coalesce(${tables.message.sentAt}, ${tables.message.receivedAt})`),
    });
    if (threadMessages.length === 0) throw new Error("Thread not found");

    const anchor =
      threadMessages.find((m) => m.direction === "inbound") ??
      threadMessages.find((m) => m.messageIdHeader) ??
      threadMessages[0]!;

    const mailbox = await db.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, anchor.mailboxId),
        eq(tables.mailbox.organizationId, organizationId),
      ),
    });
    if (!mailbox) throw new Error("Mailbox not found");

    const prospect = anchor.prospectId
      ? await db.query.prospect.findFirst({
          where: and(
            eq(tables.prospect.id, anchor.prospectId),
            eq(tables.prospect.organizationId, organizationId),
          ),
        })
      : null;
    if (!prospect) throw new Error("Prospect not found for thread");

    const org = await db.query.organization.findFirst({
      where: eq(tables.organization.id, organizationId),
    });

    const priorRefs = threadMessages
      .map((m) => m.messageIdHeader)
      .filter((id): id is string => Boolean(id));

    const replyToId = anchor.messageIdHeader ?? anchor.inReplyTo;
    if (!replyToId) throw new Error("Cannot thread reply without anchor Message-ID");

    const compliance = buildComplianceParts({
      unsubscribeUrl: buildUnsubscribeUrl(
        env.BETTER_AUTH_URL ?? "http://localhost:3000",
        mintUnsubscribeToken({ prospectId: prospect.id, orgId: organizationId }),
      ),
      senderPostalAddress: parseOrgPostalAddress(org?.metadata ?? null),
      senderOrgName: org?.name ?? "Quiksend",
    });

    const bodyText = data.bodyText ?? stripHtml(data.bodyHtml);
    const signature = mailbox.signatureHtml ? `\n\n${mailbox.signatureHtml}` : "";
    const subject = anchor.subject?.startsWith("Re:")
      ? anchor.subject
      : `Re: ${anchor.subject ?? "(no subject)"}`;

    const threading = buildThreadingHeaders({
      messageId: replyToId,
      subject,
      providerThreadId: anchor.providerThreadId,
      priorReferences: priorRefs,
    });

    const adapter = resolveMailboxAdapter(mailbox);
    const sendResult = await adapter.send({
      from: { email: mailbox.address, name: mailbox.fromName ?? undefined },
      to: [
        {
          email: prospect.email,
          name: [prospect.firstName, prospect.lastName].filter(Boolean).join(" ") || undefined,
        },
      ],
      subject: threading.subject,
      html: `${data.bodyHtml}${signature}${compliance.footerHtml}`,
      text: `${bodyText}${signature ? `\n\n${stripHtml(signature)}` : ""}${compliance.footerText}`,
      threading,
      extraHeaders: compliance.headers,
    });

    const messageIdHeader = normalizeMessageId(sendResult.messageId);

    await db.insert(tables.message).values({
      organizationId,
      mailboxId: mailbox.id,
      prospectId: prospect.id,
      enrollmentId: anchor.enrollmentId,
      direction: "outbound",
      subject: threading.subject,
      bodyHtml: data.bodyHtml,
      bodyText,
      messageIdHeader,
      providerMessageId: sendResult.providerMessageId,
      providerThreadId: sendResult.providerThreadId ?? anchor.providerThreadId,
      inReplyTo: normalizeMessageId(replyToId),
      referencesHeader: [...priorRefs.map(normalizeMessageId), normalizeMessageId(replyToId)].join(
        " ",
      ),
      status: "sent",
      sentAt: sendResult.sentAt,
    });

    return {
      messageId: messageIdHeader,
      sentAt: sendResult.sentAt.toISOString(),
    };
  });

export const manuallyStopEnrollment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        enrollmentId: z.string().uuid(),
        reason: z.string().max(500).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const enrollment = await db.query.enrollment.findFirst({
      where: and(
        eq(tables.enrollment.id, data.enrollmentId),
        eq(tables.enrollment.organizationId, organizationId),
      ),
    });
    if (!enrollment) throw new Error("Enrollment not found");

    await db
      .update(tables.enrollment)
      .set({
        state: "stopped",
        nextRunAt: null,
        lastError: data.reason ?? null,
      })
      .where(
        and(
          eq(tables.enrollment.id, data.enrollmentId),
          eq(tables.enrollment.organizationId, organizationId),
        ),
      );

    return { ok: true };
  });

export const suppressEmail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        email: z.string().email(),
        reason: z.enum(["bounce", "unsubscribe", "manual", "complaint"]).optional(),
        notes: z.string().max(1000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, userId } = context.orgContext;
    const value = data.email.toLowerCase();

    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(tables.suppression)
        .values({
          organizationId,
          value,
          valueType: "email",
          reason: data.reason ?? "manual",
          notes: data.notes ?? null,
          createdByUserId: userId,
        })
        .onConflictDoUpdate({
          target: [tables.suppression.organizationId, tables.suppression.value],
          set: {
            reason: data.reason ?? "manual",
            notes: data.notes ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();

      const prospectStatus =
        data.reason === "manual" || data.reason === "complaint" ? "do_not_contact" : "unsubscribed";

      await tx
        .update(tables.prospect)
        .set({ status: prospectStatus })
        .where(
          and(eq(tables.prospect.organizationId, organizationId), eq(tables.prospect.email, value)),
        );

      return row;
    });

    return { id: result?.id };
  });

export const unsuppressEmail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ email: z.string().email() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    await db
      .delete(tables.suppression)
      .where(
        and(
          eq(tables.suppression.organizationId, organizationId),
          eq(tables.suppression.value, data.email.toLowerCase()),
        ),
      );
    return { ok: true };
  });

export const bulkUnsuppressEmails = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z.object({ emails: z.array(z.string().email()).min(1).max(500) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const values = data.emails.map((e) => e.toLowerCase());
    await db
      .delete(tables.suppression)
      .where(
        and(
          eq(tables.suppression.organizationId, organizationId),
          inArray(tables.suppression.value, values),
        ),
      );
    return { deleted: values.length };
  });

export const listSuppressions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        search: z.string().max(200).optional(),
        cursor: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const limit = data.limit ?? 50;
    const conditions = [eq(tables.suppression.organizationId, organizationId)];

    if (data.search?.trim()) {
      conditions.push(ilike(tables.suppression.value, `%${data.search.trim()}%`));
    }
    if (data.cursor) {
      conditions.push(lt(tables.suppression.createdAt, new Date(data.cursor)));
    }

    const rows = await db.query.suppression.findMany({
      where: and(...conditions),
      orderBy: desc(tables.suppression.createdAt),
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (items[items.length - 1]?.createdAt.toISOString() ?? null) : null;

    return {
      items: items.map((r) => ({
        id: r.id,
        value: r.value,
        valueType: r.valueType,
        reason: r.reason,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor,
    };
  });

export const markAllInboxRead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({}).parse(data ?? {}))
  .handler(async ({ context }) => {
    const { organizationId } = context.orgContext;
    await db
      .update(tables.message)
      .set({ status: "read" })
      .where(
        and(
          eq(tables.message.organizationId, organizationId),
          eq(tables.message.direction, "inbound"),
          eq(tables.message.status, "received"),
        ),
      );
    return { ok: true };
  });

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
