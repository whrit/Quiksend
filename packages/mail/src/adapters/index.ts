import { env } from "@quiksend/config";
import { getNango } from "@quiksend/integrations";
import type { MailboxAdapter, MailProvider } from "../adapter.ts";
import type { SmtpConfigPlain } from "../crypto.ts";
import { createGmailAdapter, type NangoProxyClient } from "./gmail.ts";
import { createMicrosoftAdapter } from "./microsoft.ts";
import { createSmtpAdapter } from "./smtp.ts";

export { createFakeAdapter } from "./fake.ts";
export { createGmailAdapter, type GmailAdapterConfig, type NangoProxyClient } from "./gmail.ts";
export { createMicrosoftAdapter, type MicrosoftAdapterConfig } from "./microsoft.ts";
export { createSmtpAdapter, createSmtpTransport, sendMime } from "./smtp.ts";

function wrapNango(nango: ReturnType<typeof getNango>): NangoProxyClient {
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

export function createAdapterForMailbox(mailbox: {
  provider: MailProvider;
  nangoConnectionId: string | null;
  smtpConfig: SmtpConfigPlain | null;
  address: string;
  fromName: string | null;
}): MailboxAdapter {
  const fromName = mailbox.fromName ?? undefined;

  switch (mailbox.provider) {
    case "gmail": {
      if (!mailbox.nangoConnectionId) {
        throw new Error("Gmail mailbox is missing nangoConnectionId");
      }
      if (!env.NANGO_SECRET_KEY) {
        throw new Error(
          "NANGO_SECRET_KEY is not set. Configure Nango Cloud credentials before using Gmail mailboxes.",
        );
      }
      return createGmailAdapter({
        nangoConnectionId: mailbox.nangoConnectionId,
        fromAddress: mailbox.address,
        fromName,
        nango: wrapNango(getNango()),
      });
    }
    case "microsoft": {
      if (!mailbox.nangoConnectionId) {
        throw new Error("Microsoft mailbox is missing nangoConnectionId");
      }
      if (!env.NANGO_SECRET_KEY) {
        throw new Error(
          "NANGO_SECRET_KEY is not set. Configure Nango Cloud credentials before using Microsoft mailboxes.",
        );
      }
      return createMicrosoftAdapter({
        nangoConnectionId: mailbox.nangoConnectionId,
        fromAddress: mailbox.address,
        fromName,
        nango: wrapNango(getNango()),
      });
    }
    case "smtp": {
      if (!mailbox.smtpConfig) {
        throw new Error("SMTP mailbox is missing smtpConfig");
      }
      return createSmtpAdapter({
        host: mailbox.smtpConfig.host,
        port: mailbox.smtpConfig.port,
        secure: mailbox.smtpConfig.secure,
        auth: mailbox.smtpConfig.auth,
        fromAddress: mailbox.address,
        fromName,
      });
    }
    default: {
      const unknown: never = mailbox.provider;
      throw new Error(`Unknown mailbox provider: ${String(unknown)}`);
    }
  }
}
