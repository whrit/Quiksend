import { randomUUID } from "node:crypto";
import { buildComplianceParts, type ComplianceInput } from "./compliance.ts";
import { buildThreadingHeaders, type ThreadAnchor } from "./threading.ts";
import type { EmailAddress } from "./adapter.ts";

/**
 * Deterministic RFC-822 MIME assembly. Adapters SHOULD lean on this instead of
 * hand-rolling — the threading + compliance headers are load-bearing enough
 * that centralizing them prevents whole classes of Phase-7 thread-match bugs.
 *
 * Gmail's `users.messages.send` accepts raw base64url MIME; SMTP writes bytes;
 * Graph accepts either a structured payload OR raw MIME — using raw MIME on
 * all three means one code path.
 */
export interface BuildMimeInput {
  readonly from: EmailAddress;
  readonly to: readonly EmailAddress[];
  readonly cc?: readonly EmailAddress[];
  readonly bcc?: readonly EmailAddress[];
  readonly replyTo?: EmailAddress;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly anchor?: ThreadAnchor;
  readonly compliance: ComplianceInput;
  readonly extraHeaders?: Readonly<Record<string, string>>;
  /** Override for tests. In production the default (uuid + @quiksend.local) is fine. */
  readonly messageIdDomain?: string;
  readonly messageId?: string;
  /** When set, adds X-Quiksend-Canary-Id header for deliverability canary sends. */
  readonly canaryToken?: string;
}

export interface BuildMimeOutput {
  readonly messageId: string;
  readonly subject: string;
  readonly raw: string;
  readonly headers: Readonly<Record<string, string>>;
}

const CRLF = "\r\n";

export function buildMime(input: BuildMimeInput): BuildMimeOutput {
  const messageId =
    input.messageId ?? `<${randomUUID()}@${input.messageIdDomain ?? "quiksend.local"}>`;
  const threading = input.anchor ? buildThreadingHeaders(input.anchor) : null;
  const subject = threading?.subject ?? input.subject;
  const compliance = buildComplianceParts(input.compliance);

  const headers: Record<string, string> = {
    "MIME-Version": "1.0",
    Date: new Date().toUTCString(),
    "Message-ID": messageId,
    From: formatAddress(input.from),
    To: input.to.map(formatAddress).join(", "),
    Subject: subject,
    ...compliance.headers,
    ...input.extraHeaders,
  };
  if (input.cc && input.cc.length > 0) headers.Cc = input.cc.map(formatAddress).join(", ");
  if (input.bcc && input.bcc.length > 0) headers.Bcc = input.bcc.map(formatAddress).join(", ");
  if (input.replyTo) headers["Reply-To"] = formatAddress(input.replyTo);
  if (threading) {
    headers["In-Reply-To"] = threading.inReplyTo;
    headers.References = threading.references;
  }
  if (input.canaryToken) {
    headers["X-Quiksend-Canary-Id"] = input.canaryToken;
  }

  const boundary = `----=_QuikSendBoundary_${randomUUID()}`;
  headers["Content-Type"] = `multipart/alternative; boundary="${boundary}"`;

  const bodyText = `${input.text.trimEnd()}${compliance.footerText}`;
  const bodyHtml = wrapHtml(input.html, compliance.footerHtml);

  const rawParts = [
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    bodyText,
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    bodyHtml,
    `--${boundary}--`,
    "",
  ];

  return { messageId, subject, raw: rawParts.join(CRLF), headers };
}

function formatAddress(addr: EmailAddress): string {
  return addr.name ? `"${addr.name.replace(/"/g, '\\"')}" <${addr.email}>` : `<${addr.email}>`;
}

function wrapHtml(body: string, footer: string): string {
  // If the body is a full document, inject the footer before </body>. Otherwise
  // wrap into a minimal <html> and append the footer.
  if (/<\s*\/\s*body\s*>/i.test(body)) {
    return body.replace(/<\s*\/\s*body\s*>/i, `${footer}</body>`);
  }
  return `<!DOCTYPE html><html><body>${body}${footer}</body></html>`;
}
