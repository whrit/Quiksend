import { isAdminOrOwner } from "@quiksend/core";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { getNango } from "@quiksend/integrations";
import {
  buildComplianceParts,
  checkDomainAuth,
  encryptSmtpConfig,
  type SmtpConfigPlain,
} from "@quiksend/mail";
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  decryptSmtpConfigForMailbox,
  requireMailboxEncryptionKey,
  resolveMailboxAdapter,
} from "./mailboxes.server.ts";
import { authMiddleware } from "./org-fn.ts";

class MailboxError extends Error {
  readonly code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "CONFIG";
  constructor(code: MailboxError["code"], message: string) {
    super(message);
    this.name = "MailboxError";
    this.code = code;
  }
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
  return decryptSmtpConfigForMailbox(smtpConfig);
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
  enterpriseSafe: boolean;
  enterpriseSafeReason: string | null;
  enterpriseSafeDeclaredAt: string | null;
  enterpriseSafeAutoDowngraded: boolean;
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
    enterpriseSafe: row.enterpriseSafe,
    enterpriseSafeReason: row.enterpriseSafeReason,
    enterpriseSafeDeclaredAt: row.enterpriseSafeDeclaredAt?.toISOString() ?? null,
    enterpriseSafeAutoDowngraded: row.enterpriseSafeAutoDowngraded,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const listMailboxes = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { organizationId } = context.orgContext;
    const rows = await db.query.mailbox.findMany({
      where: eq(tables.mailbox.organizationId, organizationId),
      orderBy: desc(tables.mailbox.createdAt),
    });
    return rows.map(toPublicMailbox);
  });

export const getMailbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
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

export const createSmtpMailbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => createSmtpMailboxSchema.parse(data))
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    const key = requireMailboxEncryptionKey();
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

    // Mirror finalizeGmailMailbox / finalizeMicrosoftMailbox: run SPF/DKIM/DMARC
    // right after insert so the row shows sensible health dots on first load.
    const domain = domainFromAddress(row.address);
    const auth = await checkDomainAuth(domain);
    const healthNotes = { spf: auth.spf, dkim: auth.dkim, dmarc: auth.dmarc };
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
      .where(eq(tables.mailbox.id, row.id))
      .returning();
    if (!updated) throw new MailboxError("NOT_FOUND", "Mailbox not found");
    return toPublicMailbox(updated);
  });

export const updateMailbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
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
      smtpConfig = encryptSmtpConfig(next, requireMailboxEncryptionKey());
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

export const deleteMailbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
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

export const checkMailboxHealth = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
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

export const testMailboxSend = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
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

    const adapter = resolveMailboxAdapter(mailbox);
    const complianceParts = buildComplianceParts({
      unsubscribeUrl: "https://app.example.com/u/pending",
      senderPostalAddress: "1 Main St, City",
      senderOrgName: "Quiksend",
    });
    const html = "<p>This is a Quiksend test message.</p>";
    const text = "This is a Quiksend test message.";
    const result = await adapter.send({
      from: { email: mailbox.address, name: mailbox.fromName ?? undefined },
      to: [{ email: data.toEmail }],
      subject: "Quiksend test",
      html: `${html}${complianceParts.footerHtml}`,
      text: `${text}${complianceParts.footerText}`,
      extraHeaders: complianceParts.headers,
    });
    return {
      messageId: result.messageId,
      providerMessageId: result.providerMessageId,
      sentAt: result.sentAt.toISOString(),
    };
  });

/**
 * OAuth finalize input. `address` is intentionally NOT here — for Gmail and
 * Microsoft it's read from the provider's own profile endpoint after OAuth
 * completes, so the mailbox address is guaranteed to be the account the user
 * actually consented with. Only the optional display name and the Nango
 * connection id come from the client.
 */
const oauthMailboxSchema = z.object({
  fromName: z.string().max(200).optional(),
  nangoConnectionId: z.string().min(1),
});

/**
 * `users.getProfile` for Gmail returns the primary address of the authorized
 * mailbox. We parse the response with Zod at the boundary so the address we
 * persist is validated once, not asserted at every read site.
 * https://developers.google.com/gmail/api/reference/rest/v1/users/getProfile
 */
const gmailProfileSchema = z.object({
  emailAddress: z.string().email(),
});

/**
 * Microsoft Graph `/me` returns `mail` (SMTP address, when the tenant has
 * assigned one) and always returns `userPrincipalName` (the login identifier,
 * routable as an email for cloud accounts). Prefer `mail`, fall back to UPN.
 * https://learn.microsoft.com/en-us/graph/api/user-get
 */
const microsoftProfileSchema = z.object({
  mail: z.string().email().nullish(),
  userPrincipalName: z.string().nullish(),
});

/**
 * Fetch the authenticated Gmail user's primary address. Deriving it
 * server-side means a user logged in as themselves can never accidentally
 * register a different mailbox as their own by typing the wrong address.
 */
async function fetchGmailAddressFromNango(connectionId: string): Promise<string> {
  const nango = getNango();
  const profile = await nango.get({
    endpoint: "/gmail/v1/users/me/profile",
    providerConfigKey: "google-mail",
    connectionId,
  });
  const parsed = gmailProfileSchema.safeParse(profile.data);
  if (!parsed.success) {
    throw new MailboxError(
      "CONFIG",
      "Google did not return a mailbox address — check that the Gmail scope was granted",
    );
  }
  return parsed.data.emailAddress.toLowerCase();
}

/**
 * Fetch the authenticated Microsoft user's primary address via Graph.
 */
async function fetchMicrosoftAddressFromNango(connectionId: string): Promise<string> {
  const nango = getNango();
  const me = await nango.get({
    endpoint: "/v1.0/me",
    providerConfigKey: "microsoft",
    connectionId,
  });
  const parsed = microsoftProfileSchema.safeParse(me.data);
  if (!parsed.success) {
    throw new MailboxError(
      "CONFIG",
      "Microsoft did not return a mailbox address — check that the Mail.Send scope was granted",
    );
  }
  const address = (parsed.data.mail ?? parsed.data.userPrincipalName ?? "").toLowerCase();
  if (!address || !address.includes("@")) {
    throw new MailboxError("CONFIG", "Microsoft account has no routable mailbox address");
  }
  return address;
}

const reconnectMailboxSchema = z.object({
  mailboxId: z.string().uuid(),
});

export const createGmailConnectSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    requireAdmin({ orgContext: context.orgContext });
    const nango = getNango();
    const session = await nango.createConnectSession({
      end_user: {
        id: context.orgContext.userId,
      },
      allowed_integrations: ["google-mail"],
      organization: {
        id: context.orgContext.organizationId,
      },
    });
    return {
      sessionToken: session.data.token,
      connectUrl: session.data.connect_link,
    };
  });

export const createMicrosoftConnectSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    requireAdmin({ orgContext: context.orgContext });
    const nango = getNango();
    const session = await nango.createConnectSession({
      end_user: {
        id: context.orgContext.userId,
      },
      allowed_integrations: ["microsoft"],
      organization: {
        id: context.orgContext.organizationId,
      },
    });
    return {
      sessionToken: session.data.token,
      connectUrl: session.data.connect_link,
    };
  });

/**
 * Mint a Nango Connect session bound to an existing mailbox's connection so the
 * user can re-authorize after credentials go stale (e.g. `invalid_credentials`).
 * See docs/nango-setup.md and https://docs.nango.dev/guides/reauthorize-a-connection.
 */
export const createGmailReconnectSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => reconnectMailboxSchema.parse(data))
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    const mailbox = await db.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, data.mailboxId),
        eq(tables.mailbox.organizationId, context.orgContext.organizationId),
      ),
    });
    if (!mailbox) throw new MailboxError("NOT_FOUND", "Mailbox not found");
    if (mailbox.provider !== "gmail") {
      throw new MailboxError("VALIDATION", "Mailbox is not a Gmail mailbox");
    }
    if (!mailbox.nangoConnectionId) {
      throw new MailboxError("CONFIG", "Mailbox has no Nango connection to reconnect");
    }
    const nango = getNango();
    const session = await nango.createReconnectSession({
      connection_id: mailbox.nangoConnectionId,
      integration_id: "google-mail",
      end_user: {
        id: context.orgContext.userId,
      },
      organization: {
        id: context.orgContext.organizationId,
      },
    });
    return {
      sessionToken: session.data.token,
      connectUrl: session.data.connect_link,
    };
  });

export const createMicrosoftReconnectSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => reconnectMailboxSchema.parse(data))
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    const mailbox = await db.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, data.mailboxId),
        eq(tables.mailbox.organizationId, context.orgContext.organizationId),
      ),
    });
    if (!mailbox) throw new MailboxError("NOT_FOUND", "Mailbox not found");
    if (mailbox.provider !== "microsoft") {
      throw new MailboxError("VALIDATION", "Mailbox is not a Microsoft mailbox");
    }
    if (!mailbox.nangoConnectionId) {
      throw new MailboxError("CONFIG", "Mailbox has no Nango connection to reconnect");
    }
    const nango = getNango();
    const session = await nango.createReconnectSession({
      connection_id: mailbox.nangoConnectionId,
      integration_id: "microsoft",
      end_user: {
        id: context.orgContext.userId,
      },
      organization: {
        id: context.orgContext.organizationId,
      },
    });
    return {
      sessionToken: session.data.token,
      connectUrl: session.data.connect_link,
    };
  });

export const finalizeGmailMailbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => oauthMailboxSchema.parse(data))
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    // Trust the OAuth-verified address from Gmail, not user input.
    const address = await fetchGmailAddressFromNango(data.nangoConnectionId);
    const [row] = await db
      .insert(tables.mailbox)
      .values({
        organizationId: context.orgContext.organizationId,
        ownerUserId: context.orgContext.userId,
        provider: "gmail",
        address,
        fromName: data.fromName,
        nangoConnectionId: data.nangoConnectionId,
      })
      .returning();
    if (!row) throw new MailboxError("VALIDATION", "Failed to create mailbox");

    const domain = domainFromAddress(row.address);
    const auth = await checkDomainAuth(domain);
    const healthNotes = { spf: auth.spf, dkim: auth.dkim, dmarc: auth.dmarc };
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
      .where(eq(tables.mailbox.id, row.id))
      .returning();
    if (!updated) throw new MailboxError("NOT_FOUND", "Mailbox not found");
    return toPublicMailbox(updated);
  });

export const finalizeMicrosoftMailbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => oauthMailboxSchema.parse(data))
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    // Trust the OAuth-verified address from Microsoft Graph, not user input.
    const address = await fetchMicrosoftAddressFromNango(data.nangoConnectionId);
    const [row] = await db
      .insert(tables.mailbox)
      .values({
        organizationId: context.orgContext.organizationId,
        ownerUserId: context.orgContext.userId,
        provider: "microsoft",
        address,
        fromName: data.fromName,
        nangoConnectionId: data.nangoConnectionId,
      })
      .returning();
    if (!row) throw new MailboxError("VALIDATION", "Failed to create mailbox");

    const domain = domainFromAddress(row.address);
    const auth = await checkDomainAuth(domain);
    const healthNotes = { spf: auth.spf, dkim: auth.dkim, dmarc: auth.dmarc };
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
      .where(eq(tables.mailbox.id, row.id))
      .returning();
    if (!updated) throw new MailboxError("NOT_FOUND", "Mailbox not found");
    return toPublicMailbox(updated);
  });

export const setMailboxEnterpriseSafe = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        mailboxId: z.string().uuid(),
        safe: z.boolean(),
        reason: z.string().max(500).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    const organizationId = context.orgContext.organizationId;

    const existing = await db.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, data.mailboxId),
        eq(tables.mailbox.organizationId, organizationId),
      ),
    });
    if (!existing) throw new MailboxError("NOT_FOUND", "Mailbox not found");

    const now = new Date();
    const [row] = await db
      .update(tables.mailbox)
      .set({
        enterpriseSafe: data.safe,
        enterpriseSafeReason: data.safe ? (data.reason ?? existing.enterpriseSafeReason) : null,
        enterpriseSafeDeclaredAt: data.safe ? now : null,
        enterpriseSafeAutoDowngraded: data.safe ? false : existing.enterpriseSafeAutoDowngraded,
      })
      .where(
        and(
          eq(tables.mailbox.id, data.mailboxId),
          eq(tables.mailbox.organizationId, organizationId),
        ),
      )
      .returning();
    if (!row) throw new MailboxError("NOT_FOUND", "Mailbox not found");

    await db.insert(tables.event).values({
      organizationId,
      type: "mailbox.enterprise_safe_toggled",
      entityType: "mailbox",
      entityId: row.id,
      payload: {
        safe: data.safe,
        reason: data.reason ?? null,
      },
    });

    return toPublicMailbox(row);
  });
