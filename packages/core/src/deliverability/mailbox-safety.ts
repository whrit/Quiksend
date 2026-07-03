import type { EmailGateway } from "@quiksend/mail/gateway-detect";
import { SEG_GATEWAYS as MAIL_SEG_GATEWAYS } from "@quiksend/mail/gateway-detect";

/**
 * Snapshot of the mailbox fields used to decide safety. Keeps this module
 * pure (no Drizzle imports).
 */
export interface MailboxSafetySnapshot {
  enterpriseSafe: boolean;
  enterpriseSafeAutoDowngraded: boolean;
  provider: "gmail" | "microsoft" | "smtp";
}

/**
 * A mailbox is safe for a gateway if:
 *  - Recipient is not behind a SEG (google_workspace, microsoft_365, or unknown) → any mailbox OK
 *  - Recipient is behind a SEG → mailbox must be enterprise_safe AND not auto-downgraded
 *
 * Both Track UPSILON (routing decision at send time) and Track PHI (auto-downgrade
 * logic in canary auto-pause) call this. Sharing the helper prevents two subtly-
 * different implementations from drifting apart.
 */
export function isMailboxSafeForGateway(
  mailbox: MailboxSafetySnapshot,
  gateway: EmailGateway | null,
): boolean {
  if (
    gateway === null ||
    gateway === "google_workspace" ||
    gateway === "microsoft_365" ||
    gateway === "unknown"
  ) {
    return true;
  }
  return mailbox.enterpriseSafe && !mailbox.enterpriseSafeAutoDowngraded;
}

/**
 * SEG gateways that trigger routing decisions. Canonical list lives in
 * `@quiksend/mail/gateway-detect` and is re-exported here for deliverability code.
 */
export const SEG_GATEWAYS: readonly EmailGateway[] = MAIL_SEG_GATEWAYS;

export function isSegGateway(gateway: EmailGateway | null): boolean {
  return gateway !== null && (SEG_GATEWAYS as readonly EmailGateway[]).includes(gateway);
}
