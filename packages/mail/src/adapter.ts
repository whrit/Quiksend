import type { ThreadingHeaders } from "./threading.ts";

/**
 * The single contract every mailbox provider implements. Adding a new provider
 * is one new file in `./adapters/` — the engine touches nothing.
 *
 * Contract:
 *   • `send()` MUST return the RFC `Message-Id` header VALUE (angle brackets
 *     included and NORMALIZED — see threading.ts) so the engine can persist
 *     it as the manual-first anchor for follow-ups.
 *   • `send()` MUST throw a `SendError` classified as `permanent` for hard
 *     failures (invalid recipient, revoked auth) and `transient` for retryable
 *     failures (rate limit, transient 5xx). Phase-6 retries only `transient`.
 *   • `listInbound()` is provider-polling for Phase 7. Idempotent — the caller
 *     dedupes by `providerMessageId`.
 *   • `verifyIdentity()` runs DNS + provider auth checks for the SPF/DKIM/DMARC
 *     health card (Phase 4 R-044).
 */
export interface MailboxAdapter {
  readonly provider: MailProvider;
  send(input: OutboundEmail): Promise<SendResult>;
  listInbound(since: Date): Promise<readonly InboundEmail[]>;
  verifyIdentity(): Promise<IdentityHealth>;
}

export type MailProvider = "gmail" | "microsoft" | "smtp";

export interface OutboundEmail {
  readonly from: EmailAddress;
  readonly to: readonly EmailAddress[];
  readonly cc?: readonly EmailAddress[];
  readonly bcc?: readonly EmailAddress[];
  readonly replyTo?: EmailAddress;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly threading?: ThreadingHeaders;
  /** Extra RFC-822 headers. `List-Unsubscribe` + compliance footer are already applied by the caller. */
  readonly extraHeaders?: Readonly<Record<string, string>>;
  /** Stable id from the engine — providers that support it MUST echo it back. */
  readonly idempotencyKey?: string;
}

export interface EmailAddress {
  readonly email: string;
  readonly name?: string;
}

export interface SendResult {
  /** Normalized RFC-822 Message-Id value (with angle brackets). */
  readonly messageId: string;
  /** Provider-specific opaque id used for later reads/updates. */
  readonly providerMessageId: string;
  /** Provider-specific thread id (Gmail threadId, Graph conversationId, none for pure SMTP). */
  readonly providerThreadId: string | null;
  readonly sentAt: Date;
}

export interface InboundEmail {
  readonly providerMessageId: string;
  readonly messageId: string;
  readonly inReplyTo: readonly string[];
  readonly references: readonly string[];
  readonly providerThreadId: string | null;
  readonly from: EmailAddress;
  readonly to: readonly EmailAddress[];
  readonly subject: string;
  readonly html: string | null;
  readonly text: string | null;
  readonly receivedAt: Date;
  /** Populated when the message is a DSN/bounce — see `parseBounce()` in Phase 7. */
  readonly bounce: InboundBounce | null;
}

export interface InboundBounce {
  readonly type: "hard" | "soft";
  readonly statusCode: string | null;
  readonly recipient: string | null;
  readonly diagnostic: string | null;
}

export interface IdentityHealth {
  readonly domain: string;
  readonly spf: DnsCheck;
  readonly dkim: DnsCheck;
  readonly dmarc: DnsCheck;
  readonly checkedAt: Date;
}

export interface DnsCheck {
  readonly pass: boolean;
  readonly reason: string | null;
}

export type SendErrorKind = "permanent" | "transient" | "auth" | "quota";

export class SendError extends Error {
  readonly kind: SendErrorKind;
  readonly providerCode: string | null;
  constructor(kind: SendErrorKind, message: string, providerCode: string | null = null) {
    super(message);
    this.name = "SendError";
    this.kind = kind;
    this.providerCode = providerCode;
  }
}
