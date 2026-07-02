import { env } from "@quiksend/config";
import { db, tables } from "@quiksend/db";
import {
  createSmtpTransport,
  decryptSmtpConfig,
  sendMime,
  type ComplianceInput,
} from "@quiksend/mail";
import { buildMime } from "@quiksend/mail/mime";
import { normalizeMessageId } from "@quiksend/mail/threading";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { orgFn } from "./org-fn.ts";

const anchorSchema = z.object({
  messageId: z.string().min(1),
  subject: z.string().min(1),
  providerThreadId: z.string().nullable().optional(),
  priorReferences: z.array(z.string()).optional(),
});

const sendComposedMessageSchema = z.object({
  mailboxId: z.string().uuid(),
  prospectId: z.string().uuid(),
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
    if (mailbox.provider !== "smtp") throw new Error("Only SMTP mailboxes are supported in Wave 1");

    const prospect = await loadProspect(data.prospectId, organizationId);

    const org = await db.query.organization.findFirst({
      where: eq(tables.organization.id, organizationId),
    });
    const senderOrgName = org?.name ?? "Quiksend";
    const senderPostalAddress = parseOrgPostalAddress(org?.metadata ?? null);

    const compliance: ComplianceInput = {
      unsubscribeUrl: "https://app.example.com/u/pending",
      senderPostalAddress,
      senderOrgName,
    };

    const bodyText = data.bodyText ?? stripHtml(data.bodyHtml);
    const signature = mailbox.signatureHtml ? `\n\n${mailbox.signatureHtml}` : "";

    const mime = buildMime({
      from: { email: mailbox.address, name: mailbox.fromName ?? undefined },
      to: [{ email: prospect.email, name: formatProspectName(prospect) }],
      subject: data.subject,
      html: `${data.bodyHtml}${signature}`,
      text: `${bodyText}${signature ? `\n\n${stripHtml(signature)}` : ""}`,
      anchor: data.anchor,
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
    const threading = data.anchor
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
      direction: "outbound",
      subject: mime.subject,
      bodyHtml: data.bodyHtml,
      bodyText,
      messageIdHeader,
      providerMessageId: sendResult.providerMessageId,
      providerThreadId: sendResult.providerThreadId,
      inReplyTo: threading.inReplyTo,
      referencesHeader: threading.referencesHeader,
      status: "sent",
      sentAt: sendResult.sentAt,
    });

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
