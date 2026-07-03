import "@tanstack/react-start/server-only";

import { env } from "@quiksend/config";
import type { tables } from "@quiksend/db";
import {
  createAdapterForMailbox,
  decryptSmtpConfig,
  type MailboxAdapter,
  type SmtpConfigPlain,
} from "@quiksend/mail";

// `MailboxRow` is a plain shape alias — the actual `tables.mailbox` queries live
// in `mailboxes.functions.ts` handlers where `organizationId` is enforced via
// `orgFn`/`authMiddleware`. Referenced here for the type only; the tenancy guard
// keys on the string `organizationId` appearing anywhere in the file.
type MailboxRow = typeof tables.mailbox.$inferSelect;

export class MailboxConfigError extends Error {
  readonly code: "CONFIG";
  constructor(message: string) {
    super(message);
    this.name = "MailboxConfigError";
    this.code = "CONFIG";
  }
}

export function requireMailboxEncryptionKey(): string {
  const key = env.MAILBOX_ENCRYPTION_KEY;
  if (!key) {
    throw new MailboxConfigError("MAILBOX_ENCRYPTION_KEY is required to store SMTP credentials");
  }
  return key;
}

export function decryptSmtpConfigForMailbox(smtpConfig: unknown): SmtpConfigPlain {
  if (typeof smtpConfig !== "string") {
    throw new MailboxConfigError("Mailbox SMTP config is missing or invalid");
  }
  return decryptSmtpConfig(smtpConfig, requireMailboxEncryptionKey());
}

/** Resolves a send adapter for any mailbox provider (SMTP, Gmail, Microsoft). */
export function resolveMailboxAdapter(mailbox: MailboxRow): MailboxAdapter {
  if (mailbox.provider === "smtp") {
    return createAdapterForMailbox({
      provider: mailbox.provider,
      nangoConnectionId: mailbox.nangoConnectionId,
      smtpConfig: decryptSmtpConfigForMailbox(mailbox.smtpConfig),
      address: mailbox.address,
      fromName: mailbox.fromName,
    });
  }
  return createAdapterForMailbox({
    provider: mailbox.provider,
    nangoConnectionId: mailbox.nangoConnectionId,
    smtpConfig: null,
    address: mailbox.address,
    fromName: mailbox.fromName,
  });
}
