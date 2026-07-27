import "@tanstack/react-start/server-only";

import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import type { SendResult } from "@quiksend/mail";
import { normalizeMessageId } from "@quiksend/mail/threading";
import { and, eq } from "drizzle-orm";

/**
 * Message fields a caller supplies. Everything describing the *outcome* of the
 * send (status, provider ids, sentAt, error) is owned by `sendAndRecord`.
 */
export type PendingMessageValues = Omit<
  typeof tables.message.$inferInsert,
  "status" | "messageIdHeader" | "providerMessageId" | "sentAt" | "error"
>;

export interface DurableSendResult {
  readonly messageId: string;
  readonly result: SendResult;
}

/**
 * Record an outbound message, then send it, then settle the row.
 *
 * The ordering is the point. Sending first and inserting afterwards leaves a
 * delivered email with no row behind it whenever the insert fails — no audit
 * trail, no thread anchor, and nothing to stop someone sending it again. So the
 * row is committed as `sending` first, and only then does the network call
 * happen; the row is settled to `sent` or `failed` once the provider answers.
 *
 * The residual failure mode is the inverse and the safe one: a crash between a
 * successful send and the settle leaves a `sending` row — visible, and
 * recoverable — rather than an invisible email.
 *
 * Used by both manual send paths (compose and inbox reply). The worker's
 * sequence executor applies the same shape inside its own transaction.
 */
export async function sendAndRecord(
  organizationId: string,
  values: PendingMessageValues,
  send: () => Promise<SendResult>,
): Promise<DurableSendResult> {
  const [pending] = await db
    .insert(tables.message)
    .values({ ...values, status: "sending" })
    .returning({ id: tables.message.id });

  if (!pending) throw new Error("Failed to record outbound message");

  const scope = and(
    eq(tables.message.id, pending.id),
    eq(tables.message.organizationId, organizationId),
  );

  let result: SendResult;
  try {
    result = await send();
  } catch (err) {
    await db
      .update(tables.message)
      .set({ status: "failed", error: err instanceof Error ? err.message : String(err) })
      .where(scope);
    throw err;
  }

  const messageId = normalizeMessageId(result.messageId);

  await db
    .update(tables.message)
    .set({
      messageIdHeader: messageId,
      providerMessageId: result.providerMessageId,
      // Providers that thread server-side return their own id; otherwise keep
      // whatever thread the caller already knew about.
      providerThreadId: result.providerThreadId ?? values.providerThreadId ?? null,
      status: "sent",
      sentAt: result.sentAt,
    })
    .where(scope);

  return { messageId, result };
}
