/**
 * CAN-SPAM / GDPR-aware compliance headers + footer.
 *
 * Phase 4 emits the header + footer on every outbound send; Phase 10 wires the
 * end-to-end unsubscribe link (`/api/v1/unsubscribe?token=…`) that resolves a
 * signed token → `suppression` row → CRM status write-back.
 *
 * The unsubscribe TOKEN itself is minted in `apps/web` because the signing
 * secret lives there. This module accepts a pre-signed URL — it does not sign.
 */

import { logger } from "@quiksend/config";

export interface ComplianceInput {
  /** One-click unsubscribe URL. Pre-signed by the caller. */
  readonly unsubscribeUrl: string;
  /** Optional mailto: unsubscribe fallback (some providers require it). */
  readonly unsubscribeMailto?: string;
  /** Physical mailing address of the sender org — CAN-SPAM requirement. */
  readonly senderPostalAddress: string;
  /** Sender org display name for the footer. */
  readonly senderOrgName: string;
}

export interface ComplianceOutput {
  readonly headers: Readonly<Record<string, string>>;
  readonly footerHtml: string;
  readonly footerText: string;
}

/**
 * `List-Unsubscribe` is a comma-separated list. Gmail requires the HTTPS URL
 * form; adding a `mailto:` fallback improves compatibility. The one-click
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header is what enables
 * Gmail's inbox-side unsubscribe button.
 */
export function buildComplianceParts(input: ComplianceInput): ComplianceOutput {
  const listUnsubscribeParts: string[] = [`<${input.unsubscribeUrl}>`];
  if (input.unsubscribeMailto) listUnsubscribeParts.push(`<mailto:${input.unsubscribeMailto}>`);

  const headers: Record<string, string> = {
    "List-Unsubscribe": listUnsubscribeParts.join(", "),
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };

  const footerHtml = [
    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px 0;" />',
    '<p style="font-size:12px;color:#6b7280;line-height:1.5;margin:0;">',
    `${escapeHtml(input.senderOrgName)}<br />`,
    `${escapeHtml(input.senderPostalAddress)}<br />`,
    `<a href="${input.unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>`,
    "</p>",
  ].join("");

  const footerText = [
    "",
    "--",
    input.senderOrgName,
    input.senderPostalAddress,
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ].join("\n");

  return { headers, footerHtml, footerText };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Placeholder used when a workspace has not configured its CAN-SPAM postal
 * address. Shipping it is a compliance risk, so every resolution that falls
 * back here warns.
 */
export const DEFAULT_POSTAL_ADDRESS = "1 Main St, City";

/**
 * Resolve a workspace's physical postal address from `organization.metadata`.
 *
 * Lives here because it is a compliance concern and had drifted into four
 * separate copies — the worker's warned on fallback, the three web copies were
 * silent, so a manual compose or inbox reply from an unconfigured workspace
 * shipped the placeholder with no signal at all.
 */
export function resolvePostalAddress(input: {
  organizationId: string;
  metadata: string | null;
}): string {
  const address = parsePostalAddress(input.metadata);
  if (address) return address;

  logger.warn(
    { organizationId: input.organizationId },
    "workspace postal_address not configured — using placeholder (CAN-SPAM/deliverability risk)",
  );
  return DEFAULT_POSTAL_ADDRESS;
}

function parsePostalAddress(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { postal_address?: string };
    return parsed.postal_address?.trim() || null;
  } catch {
    return null;
  }
}
