import { env } from "@quiksend/config";
import { createAdapterForMailbox, createFakeAdapter, SendError } from "@quiksend/mail";
import { decryptSmtpConfig } from "@quiksend/mail";
import type { ComplianceInput } from "@quiksend/mail";
import type { MailboxAdapter } from "@quiksend/mail";
import type { tables } from "@quiksend/db";

function createPermanentFailureAdapter(): MailboxAdapter {
  return {
    provider: "smtp",
    async send() {
      throw new SendError("permanent", "Simulated permanent send failure (load test)");
    },
    async verifyIdentity() {
      return {
        domain: "loadtest.local",
        spf: { pass: true, reason: null },
        dkim: { pass: true, reason: null },
        dmarc: { pass: true, reason: null },
        checkedAt: new Date(),
      };
    },
  };
}

export function createMailboxAdapter(
  mailbox: typeof tables.mailbox.$inferSelect,
  _organizationId: string,
  compliance: ComplianceInput,
): MailboxAdapter {
  if (env.QUIKSEND_ENGINE_TEST_MODE === "permanent-failure") {
    return createPermanentFailureAdapter();
  }

  if (env.QUIKSEND_ENGINE_FAKE_MAIL) {
    return createFakeAdapter().adapter;
  }

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
      compliance,
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
    compliance,
  );
}
