/**
 * `@quiksend/mail` — mailbox adapters + MIME/threading/compliance.
 *
 * The `MailboxAdapter` interface (adapter.ts) is the single contract Phase-6's
 * step executor talks to. Three implementations land in Phase 4: SMTP
 * (nodemailer + Mailpit for local), Gmail (Gmail API via Nango), Microsoft
 * (Graph via Nango). The fake adapter (adapters/fake.ts) is what unit tests
 * inject.
 */
export * from "./adapter.ts";
export * from "./threading.ts";
export * from "./compliance.ts";
export { parseBounce, type ParsedBounce } from "./bounce.ts";
export {
  extractCandidateIds,
  matchInbound,
  type InboundHeaders,
  type InboundMatch,
  type OutboundAnchor,
} from "./inbound-matching.ts";
export { detectAutoReply, type AutoReplyDetection } from "./auto-reply.ts";
export { buildMime, type BuildMimeInput, type BuildMimeOutput } from "./mime.ts";
export {
  sanitizeForSeg,
  extractRecipientDomain,
  type BuiltMime,
  type SanitizeForSegOptions,
} from "./content-sanitizer.ts";
export { validateImapHost, SAFE_IMAP_HOSTS } from "./imap-host-validation.ts";
export { decryptSmtpConfig, encryptSmtpConfig, type SmtpConfigPlain } from "./crypto.ts";
export {
  decryptSeedImapConfig,
  encryptSeedImapConfig,
  type SeedImapConfigPlain,
} from "./seed-crypto.ts";
export { checkDomainAuth, type DomainAuthResult } from "./dns.ts";
export {
  buildUnsubscribeUrl,
  mintUnsubscribeToken,
  UNSUBSCRIBE_TOKEN_TTL_SECONDS,
  verifyUnsubscribeToken,
  type UnsubscribeTokenPayload,
} from "./unsubscribe.ts";
export { createAdapterForMailbox, createFakeAdapter } from "./adapters/index.ts";
export { createSmtpTransport, sendMime } from "./adapters/smtp.ts";
export type { EmailGateway, GatewayEvidence } from "./gateway-detect.ts";
export { detectEmailGateway } from "./gateway-detect.ts";
