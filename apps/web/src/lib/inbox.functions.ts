import { env } from "@quiksend/config";
import { db, tables } from "@quiksend/db";
import { decryptSmtpConfig, type ComplianceInput } from "@quiksend/mail";
import { createSmtpTransport, sendMime } from "@quiksend/mail/adapters/smtp";
import { buildMime } from "@quiksend/mail/mime";
import { normalizeMessageId } from "@quiksend/mail/threading";
import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { orgFn } from "./org-fn.ts";

const inboxFilterSchema = z.object({
  unread: z.boolean().optional(),
  replied: z.boolean().optional(),
  bounced: z.boolean().optional(),
  sequenceId: z.string().uuid().optional(),
  mailboxId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export type InboxThreadSummary = {
  threadKey: string;
  subject: string | null;
  mailboxId: string;
  mailboxAddress: string;
  prospectEmail: string | null;
  prospectName: string | null;
  enrollmentId: string | null;
  sequenceId: string | null;
  sequenceName: string | null;
  lastMessageAt: string;
  lastDirection: "inbound" | "outbound";
  unreadCount: number;
  hasBounce: boolean;
  preview: string | null;
};

function threadKeyForMessage(row: {
  providerThreadId: string | null;
  messageIdHeader: string | null;
  id: string;
}): string {
  return row.providerThreadId ?? row.messageIdHeader ?? row.id;
}

function parseOrgPostalAddress(metadata: string | null): string {
  if (!metadata) return "1 Main St, City";
  try {
    const parsed = JSON.parse(metadata) as { postal_address?: string };
    return parsed.postal_address?.trim() || "1 Main St, City";
  } catch {
    return "1 Main St, City";
  }
}

export const listInboxThreads = orgFn({ method: "POST" })
  .validator((data: unknown) => inboxFilterSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const limit = data.limit ?? 50;

    const conditions = [eq(tables.message.organizationId, organizationId)];
    if (data.mailboxId) conditions.push(eq(tables.message.mailboxId, data.mailboxId));
    if (data.sequenceId) {
      conditions.push(
        sql`${tables.message.enrollmentId} in (
          select id from enrollment
          where organization_id = ${organizationId}
            and sequence_id = ${data.sequenceId}
        )`,
      );
    }
    if (data.unread) {
      conditions.push(
        and(eq(tables.message.direction, "inbound"), eq(tables.message.status, "received"))!,
      );
    }
    if (data.bounced) {
      conditions.push(sql`${tables.message.bounceType} is not null`);
    }
    if (data.replied) {
      conditions.push(
        sql`${tables.message.enrollmentId} in (
          select id from enrollment
          where organization_id = ${organizationId}
            and state = 'replied'
        )`,
      );
    }

    const rows = await db.query.message.findMany({
      where: and(...conditions),
      orderBy: desc(sql`coalesce(${tables.message.receivedAt}, ${tables.message.sentAt})`),
      limit: 500,
    });

    const mailboxIds = [...new Set(rows.map((r) => r.mailboxId))];
    const mailboxes =
      mailboxIds.length > 0
        ? await db.query.mailbox.findMany({
            where: and(
              eq(tables.mailbox.organizationId, organizationId),
              inArray(tables.mailbox.id, mailboxIds),
            ),
          })
        : [];
    const mailboxMap = new Map(mailboxes.map((m) => [m.id, m]));

    const prospectIds = [...new Set(rows.map((r) => r.prospectId).filter(Boolean))] as string[];
    const prospects =
      prospectIds.length > 0
        ? await db.query.prospect.findMany({
            where: and(
              eq(tables.prospect.organizationId, organizationId),
              inArray(tables.prospect.id, prospectIds),
            ),
          })
        : [];
    const prospectMap = new Map(prospects.map((p) => [p.id, p]));

    const enrollmentIds = [...new Set(rows.map((r) => r.enrollmentId).filter(Boolean))] as string[];
    const enrollments =
      enrollmentIds.length > 0
        ? await db.query.enrollment.findMany({
            where: and(
              eq(tables.enrollment.organizationId, organizationId),
              inArray(tables.enrollment.id, enrollmentIds),
            ),
          })
        : [];
    const enrollmentMap = new Map(enrollments.map((e) => [e.id, e]));

    const sequenceIds = [...new Set(enrollments.map((e) => e.sequenceId))];
    const sequences =
      sequenceIds.length > 0
        ? await db.query.sequence.findMany({
            where: and(
              eq(tables.sequence.organizationId, organizationId),
              inArray(tables.sequence.id, sequenceIds),
            ),
          })
        : [];
    const sequenceMap = new Map(sequences.map((s) => [s.id, s]));

    const threadMap = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = threadKeyForMessage(row);
      const existing = threadMap.get(key) ?? [];
      existing.push(row);
      threadMap.set(key, existing);
    }

    let threads: InboxThreadSummary[] = [...threadMap.entries()].map(([threadKey, messages]) => {
      const sorted = messages.toSorted(
        (a, b) =>
          (b.receivedAt ?? b.sentAt ?? b.createdAt).getTime() -
          (a.receivedAt ?? a.sentAt ?? a.createdAt).getTime(),
      );
      const latest = sorted[0]!;
      const mailbox = mailboxMap.get(latest.mailboxId);
      const prospect = latest.prospectId ? prospectMap.get(latest.prospectId) : null;
      const enrollment = latest.enrollmentId ? enrollmentMap.get(latest.enrollmentId) : null;
      const sequence = enrollment ? sequenceMap.get(enrollment.sequenceId) : null;
      const unreadCount = messages.filter(
        (m) => m.direction === "inbound" && m.status === "received",
      ).length;

      return {
        threadKey,
        subject: latest.subject,
        mailboxId: latest.mailboxId,
        mailboxAddress: mailbox?.address ?? "",
        prospectEmail: prospect?.email ?? null,
        prospectName: [prospect?.firstName, prospect?.lastName].filter(Boolean).join(" ") || null,
        enrollmentId: latest.enrollmentId,
        sequenceId: enrollment?.sequenceId ?? null,
        sequenceName: sequence?.name ?? null,
        lastMessageAt: (latest.receivedAt ?? latest.sentAt ?? latest.createdAt).toISOString(),
        lastDirection: latest.direction,
        unreadCount,
        hasBounce: messages.some((m) => m.bounceType !== null),
        preview: latest.bodyText?.slice(0, 140) ?? null,
      };
    });

    threads = threads.toSorted((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));

    if (data.cursor) {
      threads = threads.filter((t) => t.lastMessageAt < data.cursor!);
    }

    const page = threads.slice(0, limit);
    const nextCursor =
      page.length === limit ? (page[page.length - 1]?.lastMessageAt ?? null) : null;

    return { threads: page, nextCursor };
  });

export const getInboxThread = orgFn({ method: "POST" })
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
      })),
    };
  });

export const sendReply = orgFn({ method: "POST" })
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
    if (mailbox.provider !== "smtp")
      throw new Error("Only SMTP mailboxes are supported for replies");

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

    const compliance: ComplianceInput = {
      unsubscribeUrl: "https://app.example.com/u/pending",
      senderPostalAddress: parseOrgPostalAddress(org?.metadata ?? null),
      senderOrgName: org?.name ?? "Quiksend",
    };

    const bodyText = data.bodyText ?? stripHtml(data.bodyHtml);
    const signature = mailbox.signatureHtml ? `\n\n${mailbox.signatureHtml}` : "";
    const subject = anchor.subject?.startsWith("Re:")
      ? anchor.subject
      : `Re: ${anchor.subject ?? "(no subject)"}`;

    const mime = buildMime({
      from: { email: mailbox.address, name: mailbox.fromName ?? undefined },
      to: [
        {
          email: prospect.email,
          name: [prospect.firstName, prospect.lastName].filter(Boolean).join(" ") || undefined,
        },
      ],
      subject,
      html: `${data.bodyHtml}${signature}`,
      text: `${bodyText}${signature ? `\n\n${stripHtml(signature)}` : ""}`,
      anchor: {
        messageId: replyToId,
        subject,
        providerThreadId: anchor.providerThreadId,
        priorReferences: priorRefs,
      },
      compliance,
    });

    const smtpKey = env.MAILBOX_ENCRYPTION_KEY;
    if (!smtpKey || typeof mailbox.smtpConfig !== "string") {
      throw new Error("Mailbox SMTP configuration is unavailable");
    }
    const smtp = decryptSmtpConfig(mailbox.smtpConfig, smtpKey);
    const sendResult = await sendMime(
      createSmtpTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.auth,
        fromAddress: mailbox.address,
        fromName: mailbox.fromName ?? undefined,
      }),
      mime,
      { from: mailbox.address, to: [prospect.email] },
    );

    const messageIdHeader = normalizeMessageId(sendResult.messageId);

    await db.insert(tables.message).values({
      organizationId,
      mailboxId: mailbox.id,
      prospectId: prospect.id,
      enrollmentId: anchor.enrollmentId,
      direction: "outbound",
      subject: mime.subject,
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

export const manuallyStopEnrollment = orgFn({ method: "POST" })
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

export const suppressEmail = orgFn({ method: "POST" })
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

    const [row] = await db
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

    return { id: row?.id };
  });

export const unsuppressEmail = orgFn({ method: "POST" })
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

export const listSuppressions = orgFn({ method: "POST" })
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

export const markAllInboxRead = orgFn({ method: "POST" })
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
