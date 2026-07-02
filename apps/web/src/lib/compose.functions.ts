import { env } from "@quiksend/config";
import { buildUnsubscribeUrl, buildComplianceParts, mintUnsubscribeToken } from "@quiksend/mail";
import { db, tables } from "@quiksend/db";
import { buildThreadingHeaders, normalizeMessageId } from "@quiksend/mail/threading";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { captureManualAnchorForEnrollment } from "./anchor.functions.ts";
import { orgFn } from "./org-fn.ts";
import { resolveMailboxAdapter } from "./mailboxes.functions.ts";

const anchorSchema = z.object({
  messageId: z.string().min(1),
  subject: z.string().min(1),
  providerThreadId: z.string().nullable().optional(),
  priorReferences: z.array(z.string()).optional(),
});

const sendComposedMessageSchema = z.object({
  mailboxId: z.string().uuid(),
  prospectId: z.string().uuid(),
  enrollmentId: z.string().uuid().optional(),
  subject: z.string().min(1).max(500),
  bodyHtml: z.string().min(1),
  bodyText: z.string().optional(),
  anchor: anchorSchema.optional(),
});

function parseOrgPostalAddress(metadata: string | null): string {
  if (!metadata) return "1 Main St, City";
  try {
    const parsed = JSON.parse(metadata) as { postal_address?: string };
    return parsed.postal_address?.trim() || "1 Main St, City";
  } catch {
    return "1 Main St, City";
  }
}

async function loadProspect(prospectId: string, organizationId: string) {
  const rows = await db.execute<{
    id: string;
    organization_id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
  }>(sql`
    select id, organization_id, email, first_name, last_name
    from prospect
    where id = ${prospectId} and organization_id = ${organizationId}
    limit 1
  `);
  const row = rows[0];
  if (!row) throw new Error("Prospect not found");
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
  };
}

export const searchProspects = orgFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({ query: z.string().max(200), limit: z.number().int().min(1).max(25).optional() })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const q = data.query.trim();
    if (q.length === 0) return [];
    const limit = data.limit ?? 10;
    const pattern = `%${q}%`;
    const rows = await db.execute<{
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
    }>(sql`
      select id, email, first_name, last_name
      from prospect
      where organization_id = ${context.orgContext.organizationId}
        and (
          email ilike ${pattern}
          or coalesce(first_name, '') ilike ${pattern}
          or coalesce(last_name, '') ilike ${pattern}
        )
      order by email asc
      limit ${limit}
    `);
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      label: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    }));
  });

export const sendComposedMessage = orgFn({ method: "POST" })
  .validator((data: unknown) => sendComposedMessageSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const mailbox = await db.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, data.mailboxId),
        eq(tables.mailbox.organizationId, organizationId),
      ),
    });
    if (!mailbox) throw new Error("Mailbox not found");

    if (data.enrollmentId) {
      const enrollment = await db.query.enrollment.findFirst({
        where: and(
          eq(tables.enrollment.id, data.enrollmentId),
          eq(tables.enrollment.organizationId, organizationId),
        ),
      });
      if (!enrollment) throw new Error("Enrollment not found");
      if (enrollment.mailboxId !== data.mailboxId) {
        throw new Error(
          "Mailbox must match the enrollment mailbox — follow-ups must continue on the same thread",
        );
      }
    }

    const prospect = await loadProspect(data.prospectId, organizationId);

    const org = await db.query.organization.findFirst({
      where: eq(tables.organization.id, organizationId),
    });
    const senderOrgName = org?.name ?? "Quiksend";
    const senderPostalAddress = parseOrgPostalAddress(org?.metadata ?? null);

    const compliance = buildComplianceParts({
      unsubscribeUrl: buildUnsubscribeUrl(
        env.BETTER_AUTH_URL ?? "http://localhost:3000",
        mintUnsubscribeToken({ prospectId: prospect.id, orgId: organizationId }),
      ),
      senderPostalAddress,
      senderOrgName,
    });

    const bodyText = data.bodyText ?? stripHtml(data.bodyHtml);
    const signature = mailbox.signatureHtml ? `\n\n${mailbox.signatureHtml}` : "";

    const threading = data.anchor
      ? buildThreadingHeaders({
          messageId: data.anchor.messageId,
          subject: data.subject,
          providerThreadId: data.anchor.providerThreadId,
          priorReferences: data.anchor.priorReferences,
        })
      : null;

    const adapter = resolveMailboxAdapter(mailbox);
    const sendResult = await adapter.send({
      from: { email: mailbox.address, name: mailbox.fromName ?? undefined },
      to: [{ email: prospect.email, name: formatProspectName(prospect) }],
      subject: threading?.subject ?? data.subject,
      html: `${data.bodyHtml}${signature}${compliance.footerHtml}`,
      text: `${bodyText}${signature ? `\n\n${stripHtml(signature)}` : ""}${compliance.footerText}`,
      threading: threading ?? undefined,
      extraHeaders: compliance.headers,
    });

    const messageIdHeader = normalizeMessageId(sendResult.messageId);
    const threadingMeta = data.anchor
      ? {
          inReplyTo: normalizeMessageId(data.anchor.messageId),
          referencesHeader: [
            ...(data.anchor.priorReferences ?? []).map(normalizeMessageId),
            normalizeMessageId(data.anchor.messageId),
          ].join(" "),
        }
      : { inReplyTo: null, referencesHeader: null };

    await db.insert(tables.message).values({
      organizationId,
      mailboxId: mailbox.id,
      prospectId: prospect.id,
      enrollmentId: data.enrollmentId ?? null,
      direction: "outbound",
      subject: threading?.subject ?? data.subject,
      bodyHtml: data.bodyHtml,
      bodyText,
      messageIdHeader,
      providerMessageId: sendResult.providerMessageId,
      providerThreadId: sendResult.providerThreadId,
      inReplyTo: threadingMeta.inReplyTo,
      referencesHeader: threadingMeta.referencesHeader,
      status: "sent",
      sentAt: sendResult.sentAt,
    });

    if (data.enrollmentId) {
      await captureManualAnchorForEnrollment({
        enrollmentId: data.enrollmentId,
        organizationId,
        messageId: messageIdHeader,
        threadId: sendResult.providerThreadId ?? messageIdHeader,
        providerMessageId: sendResult.providerMessageId,
        sentAt: sendResult.sentAt,
      });
    }

    return {
      messageId: messageIdHeader,
      providerMessageId: sendResult.providerMessageId,
      sentAt: sendResult.sentAt.toISOString(),
    };
  });

function formatProspectName(prospect: {
  firstName: string | null;
  lastName: string | null;
}): string | undefined {
  const name = [prospect.firstName, prospect.lastName].filter(Boolean).join(" ");
  return name.length > 0 ? name : undefined;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
