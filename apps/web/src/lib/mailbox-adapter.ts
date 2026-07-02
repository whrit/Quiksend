import { env } from "@quiksend/config";
import { getNango } from "@quiksend/integrations";
import { createAdapterForMailbox, decryptSmtpConfig } from "@quiksend/mail";
import type { MailboxAdapter, MailProvider } from "@quiksend/mail";
import type { NangoProxyClient } from "@quiksend/mail/nango-proxy";

type MailboxRow = {
  provider: MailProvider;
  nangoConnectionId: string | null;
  smtpConfig: string | null;
  address: string;
  fromName: string | null;
};

function createNangoProxyClient(): NangoProxyClient {
  if (!env.NANGO_SECRET_KEY) {
    throw new Error(
      "NANGO_SECRET_KEY is not set. Configure Nango Cloud credentials before using OAuth mailboxes.",
    );
  }
  const nango = getNango();
  return {
    async post(config) {
      const response = await nango.post(config);
      return { data: response.data, status: response.status };
    },
    async get(config) {
      const response = await nango.get(config);
      return { data: response.data, status: response.status };
    },
  };
}

/** Web-app wiring for OAuth + SMTP mailbox adapters. */
export function getMailboxAdapter(mailbox: MailboxRow): MailboxAdapter {
  const nangoProxy =
    mailbox.provider === "gmail" || mailbox.provider === "microsoft"
      ? createNangoProxyClient()
      : undefined;

  if (mailbox.provider === "smtp") {
    const key = env.MAILBOX_ENCRYPTION_KEY;
    if (!key || typeof mailbox.smtpConfig !== "string") {
      throw new Error("SMTP mailbox configuration is unavailable");
    }
    return createAdapterForMailbox(
      {
        provider: mailbox.provider,
        nangoConnectionId: mailbox.nangoConnectionId,
        smtpConfig: decryptSmtpConfig(mailbox.smtpConfig, key),
        address: mailbox.address,
        fromName: mailbox.fromName,
      },
      nangoProxy,
    );
  }

  return createAdapterForMailbox(
    {
      provider: mailbox.provider,
      nangoConnectionId: mailbox.nangoConnectionId,
      smtpConfig: null,
      address: mailbox.address,
      fromName: mailbox.fromName,
    },
    nangoProxy,
  );
}
