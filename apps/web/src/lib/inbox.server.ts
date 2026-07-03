import "@tanstack/react-start/server-only";

import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { InboxThreadSummary } from "./inbox-types.ts";

/**
 * Server-only reader that powers the `/inbox` list. Imported by the
 * `listInboxThreads` server-fn in `inbox.functions.ts` and by
 * `inbox-threads.test.ts` (both server-context).
 */

export type InboxFilter = {
  unread?: boolean;
  replied?: boolean;
  bounced?: boolean;
  sequenceId?: string;
  mailboxId?: string;
  cursor?: string;
  limit?: number;
};

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
    ${cursor ? sql`where last_at < ${cursor.toISOString()}` : sql``}
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
