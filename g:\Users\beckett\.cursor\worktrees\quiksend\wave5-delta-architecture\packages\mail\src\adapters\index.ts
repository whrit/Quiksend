import type { MailboxAdapter, MailProvider } from "../adapter.ts";
import type { NangoProxyClient } from "../nango-proxy.ts";
import type { SmtpConfigPlain } from "../crypto.ts";
import { createGmailAdapter } from "./gmail.ts";
import { createMicrosoftAdapter } from "./microsoft.ts";
import { createSmtpAdapter } from "./smtp.ts";

export { createFakeAdapter } from "./fake.ts";
export { createGmailAdapter, type GmailAdapterConfig } from "./gmail.ts";
export { createMicrosoftAdapter, type MicrosoftAdapterConfig } from "./microsoft.ts";
export { createSmtpAdapter, createSmtpTransport, sendMime } from "./smtp.ts";
export type { NangoProxyClient } from "../nango-proxy.ts";

export function createAdapterForMailbox(
  mailbox: {
    provider: MailProvider;
    nangoConnectionId: string | null;
    smtpConfig: SmtpConfigPlain | null;
    address: string;
    fromName: string | null;
  },
  nangoProxy?: NangoProxyClient,
): MailboxAdapter {
  const fromName = mailbox.fromName ?? undefined;

  switch (mailbox.provider) {
    case "gmail": {
      if (!mailbox.nangoConnectionId) {
        throw new Error("Gmail mailbox is missing nangoConnectionId");
      }
      if (!nangoProxy) {
        throw new Error(
          "Gmail adapter requires a NangoProxyClient — inject via createAdapterForMailbox's second argument",
        );
      }
      return createGmailAdapter({
        nangoConnectionId: mailbox.nangoConnectionId,
        fromAddress: mailbox.address,
        fromName,
        nango: nangoProxy,
      });
    }
    case "microsoft": {
      if (!mailbox.nangoConnectionId) {
        throw new Error("Microsoft mailbox is missing nangoConnectionId");
      }
      if (!nangoProxy) {
        throw new Error(
          "Microsoft adapter requires a NangoProxyClient — inject via createAdapterForMailbox's second argument",
        );
      }
      return createMicrosoftAdapter({
        nangoConnectionId: mailbox.nangoConnectionId,
        fromAddress: mailbox.address,
        fromName,
        nango: nangoProxy,
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
