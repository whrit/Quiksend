import { logger } from "@quiksend/config";
import { sendTransactionalEmail } from "@quiksend/mail";
import { registerHandler } from "@quiksend/queue";
import type { MailSendTransactionalPayload } from "@quiksend/queue";

/**
 * Consumer side of `packages/auth/src/auth.ts`'s durable transactional mail
 * enqueue (password reset, organization invitation, email verification).
 * The payload never carries SMTP credentials — `sendTransactionalEmail`
 * reads the operator relay's host/auth/TLS from this process's own env.
 *
 * Throwing here (rather than swallowing) is what makes retries work: pg-boss
 * only retries a job whose handler rejects. `registerHandler`'s queue
 * defaults give this job 5 attempts with exponential backoff (see
 * `packages/queue/src/boss.ts`).
 */
export async function handleMailSendTransactional(
  payload: MailSendTransactionalPayload,
): Promise<void> {
  try {
    await sendTransactionalEmail(payload);
  } catch (err) {
    logger.error(
      { err, to: payload.to, subject: payload.subject },
      "Failed to send transactional email",
    );
    throw err;
  }
}

export async function registerMailTransactionalSendHandler(): Promise<void> {
  await registerHandler("mail.send_transactional", handleMailSendTransactional);
}
