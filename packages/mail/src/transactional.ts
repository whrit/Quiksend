import { env } from "@quiksend/config";
import type { Transporter } from "nodemailer";
import { createSmtpTransport } from "./adapters/smtp.ts";

export interface TransactionalEmailInput {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

const FROM_ADDRESS = "no-reply@quiksend.local";
const FROM_NAME = "Quiksend";

let transport: Transporter | null = null;

/**
 * Lazily builds (and memoizes) the operator's transactional SMTP transport.
 * Nothing touches the network at import time — only the first
 * `sendTransactionalEmail` call does — so importing this module in tests or
 * tooling never requires a live SMTP relay.
 */
function getTransport(): Transporter {
  if (!env.SMTP_HOST) {
    throw new Error(
      "sendTransactionalEmail: SMTP_HOST is not configured — a transactional SMTP relay is required to deliver account-security email",
    );
  }
  if (!transport) {
    transport = createSmtpTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 1025,
      secure: false,
      fromAddress: FROM_ADDRESS,
      fromName: FROM_NAME,
      // `createSmtpTransport` only reads host/port/secure/auth; `compliance`
      // is required by the shared `SmtpAdapterConfig` type but unused here —
      // transactional mail never goes through the customer-mailbox
      // MIME/compliance pipeline (no List-Unsubscribe, no per-workspace
      // sender identity).
      compliance: { unsubscribeUrl: "", senderPostalAddress: "", senderOrgName: FROM_NAME },
    });
  }
  return transport;
}

/**
 * Sends a transactional email (password reset, organization invitation) over
 * the operator's own SMTP relay — never a customer's connected mailbox.
 * Used exclusively by Better Auth's `sendResetPassword` / `sendInvitationEmail`
 * hooks (see `packages/auth/src/auth.ts`).
 */
export async function sendTransactionalEmail(input: TransactionalEmailInput): Promise<void> {
  await getTransport().sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}
