import { env } from "@quiksend/config";
import { db, tables } from "@quiksend/db";
import { buildComplianceParts, buildUnsubscribeUrl, mintUnsubscribeToken } from "@quiksend/mail";
import { buildThreadingHeaders, normalizeMessageId } from "@quiksend/mail/threading";
import { and, asc, desc, eq, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { orgFn } from "./org-fn.ts";
import { resolveMailboxAdapter } from "./mailboxes.functions.ts";

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
  sentiment: string | null;
};

function parseOrgPostalAddress(metadata: string | null): string {
  if (!metadata) return "1 Main St, City";
  try {
    const parsed = JSON.parse(metadata) as { postal_address?: string };
    return parsed.postal_address?.trim() || "1 Main St, City";
  } catch {
    return "1 Main St, City";
  }
}

type InboxFilter = z.infer<typeof inboxFilterSchema>;

type LatestThreadRow = {
  id: string;
  organization_id: string;
  mailbox_id: string;
  prospect_id: string | null;
  enrollment_id: string | null;
  direction: "inbound" | "outbound";
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  message_id_header: string | null;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  status: string;
  sentiment: string | null;
  bounce_type: string | null;
  sent_at: Date | null;
  received_at: Date | null;
  created_at: Date;
  thread_key: string;
  last_at: Date | string;
};

function buildInboxMessageFilters(organizationId: string, data: InboxFilter): SQL[] {
  const conditions: SQL[] = [sql`m.organization_id = ${organizationId}`];
  if (data.mailboxId) conditions.push(sql`m.mailbox_id = ${data.mailboxId}`);
  if (data.sequenceId) {
    conditions.push(sql`m.enrollment_id in (
      select id from enrollment
      where organization_id = ${organizationId}
        and sequence_id = ${data.sequenceId}
    )`);
  }
  if (data.unread) {
    conditions.push(sql`m.direction = 'inbound' and m.status = 'received'`);
  }
  if (data.bounced) {
    conditions.push(sql`m.bounce_type is not null`);
  }
  if (data.replied) {
    conditions.push(sql`m.enrollment_id in (
      select id from enrollment
      where organization_id = ${organizationId}
        and state = 'replied'
    )`);
  }
  return conditions;
}

export async function listInboxThreadsForOrg(
  organizationId: string,
  data: InboxFilter,
): Promise<{ threads: InboxThreadSummary[]; nextCursor: string | null }> {
  const limit = data.limit ?? 50;
  const whereClause = sql.join(buildInboxMessageFilters(organizationId, data), sql` and `);
  const cursor = data.cursor ? new Date(data.cursor) : null;

  const latestRows = await db.execute<LatestThreadRow>(sql`
    with latest as (
      select distinct on (
        coalesce(m.provider_thread_id, m.message_id_header, m.id::text)
      )
        m.id,
        m.organization_id,
        m.mailbox_id,
        m.prospect_id,
        m.enrollment_id,
        m.direction,
        m.subject,
        m.body_html,
        m.body_text,
        m.message_id_header,
        m.provider_message_id,
        m.provider_thread_id,
        m.status,
        m.sentiment,
        m.bounce_type,
        m.sent_at,
        m.received_at,
        m.created_at,
        coalesce(m.provider_thread_id, m.message_id_header, m.id::text) as thread_key,
        coalesce(m.received_at, m.sent_at, m.created_at) as last_at
      from message m
      where ${whereClause}
      order by
        coalesce(m.provider_thread_id, m.message_id_header, m.id::text),
        coalesce(m.received_at, m.sent_at, m.created_at) desc
    )
    select * from latest
    ${cursor ? sql`where last_at < ${cursor}` : sql``}
    order by last_at desc
    limit ${limit}
  `);

  if (latestRows.length === 0) {
    return { threads: [], nextCursor: null };
  }

  const threadKeys = latestRows.map((r) => r.thread_key);
  const threadKeyFilter =
    threadKeys.length > 0
      ? sql`coalesce(provider_thread_id, message_id_header, id::text) in (${sql.join(
          threadKeys.map((key) => sql`${key}`),
          sql`, `,
        )})`
      : sql`false`;

  const [threadStats, inboundSentiment] = await Promise.all([
    db.execute<{
      thread_key: string;
      unread_count: number;
      has_bounce: boolean;
    }>(sql`
      select
        coalesce(provider_thread_id, message_id_header, id::text) as thread_key,
        count(*) filter (where direction = 'inbound' and status = 'received')::int as unread_count,
        bool_or(bounce_type is not null) as has_bounce
      from message
      where organization_id = ${organizationId}
        and ${threadKeyFilter}
      group by 1
    `),
    db.execute<{ thread_key: string; sentiment: string | null }>(sql`
      select distinct on (thread_key)
        thread_key,
        sentiment
      from (
        select
          coalesce(provider_thread_id, message_id_header, id::text) as thread_key,
          sentiment,
          coalesce(received_at, sent_at, created_at) as at
        from message
        where organization_id = ${organizationId}
          and direction = 'inbound'
          and ${threadKeyFilter}
      ) inbound
      order by thread_key, at desc
    `),
  ]);

  const statsMap = new Map(threadStats.map((s) => [s.thread_key, s]));
  const sentimentMap = new Map(inboundSentiment.map((s) => [s.thread_key, s.sentiment]));

  const mailboxIds = [...new Set(latestRows.map((r) => r.mailbox_id))];
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

  const prospectIds = [
    ...new Set(latestRows.map((r) => r.prospect_id).filter(Boolean)),
  ] as string[];
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

  const enrollmentIds = [
    ...new Set(latestRows.map((r) => r.enrollment_id).filter(Boolean)),
  ] as string[];
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

  const threads: InboxThreadSummary[] = latestRows.map((latest) => {
    const mailbox = mailboxMap.get(latest.mailbox_id);
    const prospect = latest.prospect_id ? prospectMap.get(latest.prospect_id) : null;
    const enrollment = latest.enrollment_id ? enrollmentMap.get(latest.enrollment_id) : null;
    const sequence = enrollment ? sequenceMap.get(enrollment.sequenceId) : null;
    const stats = statsMap.get(latest.thread_key);

    return {
      threadKey: latest.thread_key,
      subject: latest.subject,
      mailboxId: latest.mailbox_id,
      mailboxAddress: mailbox?.address ?? "",
      prospectEmail: prospect?.email ?? null,
      prospectName: [prospect?.firstName, prospect?.lastName].filter(Boolean).join(" ") || null,
      enrollmentId: latest.enrollment_id,
      sequenceId: enrollment?.sequenceId ?? null,
      sequenceName: sequence?.name ?? null,
      lastMessageAt: new Date(latest.last_at).toISOString(),
      lastDirection: latest.direction,
      unreadCount: stats?.unread_count ?? 0,
      hasBounce: stats?.has_bounce ?? false,
      preview: latest.body_text?.slice(0, 140) ?? null,
      sentiment: sentimentMap.get(latest.thread_key) ?? null,
    };
  });

  const nextCursor =
    threads.length === limit ? (threads[threads.length - 1]?.lastMessageAt ?? null) : null;

  return { threads, nextCursor };
}

export const listInboxThreads = orgFn({ method: "POST" })
  .validator((data: unknown) => inboxFilterSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return listInboxThreadsForOrg(organizationId, data);
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
        sentiment: m.sentiment,
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

export const bulkUnsuppressEmails = orgFn({ method: "POST" })
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
