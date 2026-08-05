import { env } from "@quiksend/config";
import type { Transporter } from "nodemailer";
import { createSmtpTransport } from "./adapters/smtp.ts";

export interface TransactionalEmailInput {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

// Dev-only fallback — `env.schema.ts` requires `SMTP_FROM` in production, so
// this branch is unreachable outside local/self-host development.
const DEV_FALLBACK_FROM_ADDRESS = "no-reply@quiksend.local";
const DEV_FALLBACK_FROM_NAME = "Quiksend";

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
      secure: env.SMTP_SECURE ?? false,
      requireTLS: env.SMTP_REQUIRE_TLS ?? false,
      auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

/**
 * Sends a transactional email (password reset, organization invitation,
 * email verification) over the operator's own SMTP relay — never a
 * customer's connected mailbox. This is the low-level SMTP send; the actual
 * caller is `apps/worker`'s `mail.send_transactional` job handler, not
 * `packages/auth` directly — Better Auth's hooks (see
 * `packages/auth/src/auth.ts`) durably enqueue the job instead of awaiting
 * SMTP inline, so account-flow response time never depends on relay latency.
 */
export async function sendTransactionalEmail(input: TransactionalEmailInput): Promise<void> {
  const fromAddress = env.SMTP_FROM ?? DEV_FALLBACK_FROM_ADDRESS;
  const fromName = env.SMTP_FROM_NAME ?? DEV_FALLBACK_FROM_NAME;
  await getTransport().sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapes user-controlled text (organization names, display names, …) before
 * interpolating it into a transactional email's HTML body. Every caller that
 * builds HTML from anything a workspace member can set (not just the raw
 * href/url values this module generates itself) MUST route through this.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}
