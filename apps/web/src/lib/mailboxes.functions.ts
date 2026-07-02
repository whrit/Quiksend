import { env } from "@quiksend/config";
import { isAdminOrOwner } from "@quiksend/core";
import { db, tables } from "@quiksend/db";
import {
  checkDomainAuth,
  createSmtpTransport,
  decryptSmtpConfig,
  encryptSmtpConfig,
  sendMime,
  type SmtpConfigPlain,
} from "@quiksend/mail";
import { buildMime } from "@quiksend/mail/mime";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { orgFn } from "./org-fn.ts";

class MailboxError extends Error {
  readonly code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "CONFIG";
  constructor(code: MailboxError["code"], message: string) {
    super(message);
    this.name = "MailboxError";
    this.code = code;
  }
}

const sendWindowSchema = z.object({
  timezone: z.string(),
  window: z.record(z.string(), z.array(z.tuple([z.number(), z.number()]))),
});

const createSmtpMailboxSchema = z.object({
  address: z.string().email(),
  fromName: z.string().max(200).optional(),
  host: z.string().min(1),
  port: z.number().int().positive(),
  secure: z.boolean().optional(),
  auth: z.object({ user: z.string(), pass: z.string() }).optional(),
  dailyCap: z.number().int().positive().optional(),
  throttleSeconds: z.number().int().positive().optional(),
  sendWindow: sendWindowSchema.optional(),
  signatureHtml: z.string().optional(),
});

const updateMailboxSchema = z.object({
  id: z.string().uuid(),
  patch: z
    .object({
      fromName: z.string().max(200).nullable().optional(),
      displayName: z.string().max(200).nullable().optional(),
      dailyCap: z.number().int().positive().optional(),
      throttleSeconds: z.number().int().positive().optional(),
      sendWindow: sendWindowSchema.optional(),
      signatureHtml: z.string().nullable().optional(),
      status: z.enum(["active", "paused", "error"]).optional(),
      host: z.string().min(1).optional(),
      port: z.number().int().positive().optional(),
      secure: z.boolean().optional(),
      auth: z.object({ user: z.string(), pass: z.string() }).nullable().optional(),
    })
    .strict(),
});

function requireEncryptionKey(): string {
  const key = env.MAILBOX_ENCRYPTION_KEY;
  if (!key) {
    throw new MailboxError(
      "CONFIG",
      "MAILBOX_ENCRYPTION_KEY is required to store SMTP credentials",
    );
  }
  return key;
}

function requireAdmin(ctx: { orgContext: { role: string } }): void {
  if (!isAdminOrOwner(ctx.orgContext as never)) {
    throw new MailboxError("FORBIDDEN", "Admin or owner role required");
  }
}

function domainFromAddress(address: string): string {
  const domain = address.split("@")[1];
  if (!domain) throw new MailboxError("VALIDATION", "Invalid mailbox address");
  return domain.toLowerCase();
}

function decryptMailboxSmtp(smtpConfig: unknown): SmtpConfigPlain {
  if (typeof smtpConfig !== "string") {
    throw new MailboxError("CONFIG", "Mailbox SMTP config is missing or invalid");
  }
  return decryptSmtpConfig(smtpConfig, requireEncryptionKey());
}

type MailboxRow = typeof tables.mailbox.$inferSelect;

export type PublicMailbox = {
  id: string;
  organizationId: string;
  ownerUserId: string;
  provider: MailboxRow["provider"];
  address: string;
  displayName: string | null;
  fromName: string | null;
  nangoConnectionId: string | null;
  hasSmtpConfig: boolean;
  dailyCap: number;
  sendWindow: {
    timezone: string;
    window: Record<string, [number, number][]>;
  };
  throttleSeconds: number;
  signatureHtml: string | null;
  spfOk: boolean | null;
  dkimOk: boolean | null;
  dmarcOk: boolean | null;
  healthCheckedAt: string | null;
  healthNotes: {
    spf: { pass: boolean; reason: string | null; record: string | null };
    dkim: { pass: boolean; reason: string | null };
    dmarc: { pass: boolean; reason: string | null; record: string | null };
  } | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function toPublicMailbox(row: MailboxRow): PublicMailbox {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    provider: row.provider,
    address: row.address,
    displayName: row.displayName,
    fromName: row.fromName,
    nangoConnectionId: row.nangoConnectionId,
    hasSmtpConfig: row.smtpConfig != null,
    dailyCap: row.dailyCap,
    sendWindow: row.sendWindow as PublicMailbox["sendWindow"],
    throttleSeconds: row.throttleSeconds,
    signatureHtml: row.signatureHtml,
    spfOk: row.spfOk,
    dkimOk: row.dkimOk,
    dmarcOk: row.dmarcOk,
    healthCheckedAt: row.healthCheckedAt?.toISOString() ?? null,
    healthNotes: row.healthNotes as PublicMailbox["healthNotes"],
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const listMailboxes = orgFn({ method: "GET" }).handler(async ({ context }) => {
  const { organizationId } = context.orgContext;
  const rows = await db.query.mailbox.findMany({
    where: eq(tables.mailbox.organizationId, organizationId),
    orderBy: desc(tables.mailbox.createdAt),
  });
  return rows.map(toPublicMailbox);
});

export const getMailbox = orgFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const row = await db.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, data.id),
        eq(tables.mailbox.organizationId, context.orgContext.organizationId),
      ),
    });
    if (!row) throw new MailboxError("NOT_FOUND", "Mailbox not found");
    return toPublicMailbox(row);
  });

export const createSmtpMailbox = orgFn({ method: "POST" })
  .validator((data: unknown) => createSmtpMailboxSchema.parse(data))
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    const key = requireEncryptionKey();
    const smtpPlain: SmtpConfigPlain = {
      host: data.host,
      port: data.port,
      secure: data.secure,
      auth: data.auth,
    };
    const [row] = await db
      .insert(tables.mailbox)
      .values({
        organizationId: context.orgContext.organizationId,
        ownerUserId: context.orgContext.userId,
        provider: "smtp",
        address: data.address.toLowerCase(),
        fromName: data.fromName,
        smtpConfig: encryptSmtpConfig(smtpPlain, key),
        dailyCap: data.dailyCap,
        throttleSeconds: data.throttleSeconds,
        sendWindow: data.sendWindow,
        signatureHtml: data.signatureHtml,
      })
      .returning();
    if (!row) throw new MailboxError("VALIDATION", "Failed to create mailbox");
    return toPublicMailbox(row);
  });

export const updateMailbox = orgFn({ method: "POST" })
  .validator((data: unknown) => updateMailboxSchema.parse(data))
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    const existing = await db.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, data.id),
        eq(tables.mailbox.organizationId, context.orgContext.organizationId),
      ),
    });
    if (!existing) throw new MailboxError("NOT_FOUND", "Mailbox not found");

    const patch = { ...data.patch };
    let smtpConfig = existing.smtpConfig;
    if (
      patch.host !== undefined ||
      patch.port !== undefined ||
      patch.secure !== undefined ||
      patch.auth !== undefined
    ) {
      const current = decryptMailboxSmtp(existing.smtpConfig);
      const next: SmtpConfigPlain = {
        host: patch.host ?? current.host,
        port: patch.port ?? current.port,
        secure: patch.secure ?? current.secure,
        auth: patch.auth === null ? undefined : (patch.auth ?? current.auth),
      };
      smtpConfig = encryptSmtpConfig(next, requireEncryptionKey());
    }

    const { host: _h, port: _p, secure: _s, auth: _a, ...mailboxPatch } = patch;

    const [row] = await db
      .update(tables.mailbox)
      .set({ ...mailboxPatch, smtpConfig })
      .where(
        and(
          eq(tables.mailbox.id, data.id),
          eq(tables.mailbox.organizationId, context.orgContext.organizationId),
        ),
      )
      .returning();
    if (!row) throw new MailboxError("NOT_FOUND", "Mailbox not found");
    return toPublicMailbox(row);
  });

export const deleteMailbox = orgFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    const deleted = await db
      .delete(tables.mailbox)
      .where(
        and(
          eq(tables.mailbox.id, data.id),
          eq(tables.mailbox.organizationId, context.orgContext.organizationId),
        ),
      )
      .returning({ id: tables.mailbox.id });
    if (deleted.length === 0) throw new MailboxError("NOT_FOUND", "Mailbox not found");
    return { ok: true as const };
  });

export const checkMailboxHealth = orgFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const mailbox = await db.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, data.id),
        eq(tables.mailbox.organizationId, context.orgContext.organizationId),
      ),
    });
    if (!mailbox) throw new MailboxError("NOT_FOUND", "Mailbox not found");

    const domain = domainFromAddress(mailbox.address);
    const auth = await checkDomainAuth(domain);
    const healthNotes = {
      spf: auth.spf,
      dkim: auth.dkim,
      dmarc: auth.dmarc,
    };
    const checkedAt = new Date();

    const [updated] = await db
      .update(tables.mailbox)
      .set({
        spfOk: auth.spf.pass,
        dkimOk: auth.dkim.pass,
        dmarcOk: auth.dmarc.pass,
        healthCheckedAt: checkedAt,
        healthNotes,
      })
      .where(
        and(
          eq(tables.mailbox.id, mailbox.id),
          eq(tables.mailbox.organizationId, context.orgContext.organizationId),
        ),
      )
      .returning();

    if (!updated) throw new MailboxError("NOT_FOUND", "Mailbox not found");

    return {
      spfOk: updated.spfOk,
      dkimOk: updated.dkimOk,
      dmarcOk: updated.dmarcOk,
      healthCheckedAt: updated.healthCheckedAt?.toISOString() ?? null,
      healthNotes,
    };
  });

export const testMailboxSend = orgFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        toEmail: z.string().email(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const mailbox = await db.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, data.id),
        eq(tables.mailbox.organizationId, context.orgContext.organizationId),
      ),
    });
    if (!mailbox) throw new MailboxError("NOT_FOUND", "Mailbox not found");

    const compliance = {
      unsubscribeUrl: "https://app.example.com/u/pending",
      senderPostalAddress: "1 Main St, City",
      senderOrgName: "Quiksend",
    };
    const smtp = decryptMailboxSmtp(mailbox.smtpConfig);
    const mime = buildMime({
      from: { email: mailbox.address, name: mailbox.fromName ?? undefined },
      to: [{ email: data.toEmail }],
      subject: "Quiksend test",
      html: "<p>This is a Quiksend test message.</p>",
      text: "This is a Quiksend test message.",
      compliance,
    });
    const result = await sendMime(
      createSmtpTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.auth,
        fromAddress: mailbox.address,
        fromName: mailbox.fromName ?? undefined,
      }),
      mime,
      { from: mailbox.address, to: [data.toEmail] },
    );
    return {
      messageId: result.messageId,
      providerMessageId: result.providerMessageId,
      sentAt: result.sentAt.toISOString(),
    };
  });
