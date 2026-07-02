import { env } from "@quiksend/config";
import { createAdapterForMailbox, createFakeAdapter } from "@quiksend/mail";
import { decryptSmtpConfig } from "@quiksend/mail";
import type { MailboxAdapter } from "@quiksend/mail";
import type { tables } from "@quiksend/db";

export function createMailboxAdapter(
  mailbox: typeof tables.mailbox.$inferSelect,
  _organizationId: string,
): MailboxAdapter {
  if (process.env.QUIKSEND_ENGINE_FAKE_MAIL === "1") {
    return createFakeAdapter().adapter;
  }

  if (mailbox.provider === "smtp") {
    const key = env.MAILBOX_ENCRYPTION_KEY;
    if (!key || typeof mailbox.smtpConfig !== "string") {
      throw new Error("SMTP mailbox configuration is unavailable");
    }
    return createAdapterForMailbox({
      provider: mailbox.provider,
      nangoConnectionId: mailbox.nangoConnectionId,
      smtpConfig: decryptSmtpConfig(mailbox.smtpConfig, key),
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
