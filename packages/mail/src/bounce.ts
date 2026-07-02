/**
 * Bounce / DSN parser — classifies delivery failures from raw MIME.
 *
 * Handles RFC 3464 multipart/report (message/delivery-status), plus
 * provider-specific formats from Gmail, Microsoft Graph, and generic SMTP.
 * Returns null when the MIME is not a bounce (replies, OOO, etc.).
 */

export interface ParsedBounce {
  type: "hard" | "soft";
  statusCode: string | null;
  recipient: string | null;
  diagnostic: string | null;
  provider: "gmail" | "microsoft" | "smtp" | "unknown";
}

const GMAIL_FROM_RE = /mailer-daemon@(?:googlemail|gmail)\.com/i;
const GMAIL_REPORTING_MTA_RE = /reporting-mta:\s*dns;\s*(?:googlemail|gmail)\.com/i;
const MICROSOFT_NDR_RE = /x-failed-recipients:|x-postmaster-msguid:/i;
const SMTP_UNDELIVERABLE_RE = /^undeliverable:/i;

const HARD_TEXT_RE =
  /\b(?:user\s+unknown|no\s+such\s+user|mailbox\s+not\s+found|address\s+rejected|does\s+not\s+exist|recipient\s+address\s+rejected|spam|blocked|550\s)/i;
const SOFT_TEXT_RE =
  /\b(?:over\s+quota|mailbox\s+full|quota\s+exceeded|try\s+again\s+later|452\s|452-|temporary\s+failure|deferred)\b/i;

/** Parse raw MIME and classify a bounce, or null if not a bounce. */
export function parseBounce(rawMime: string): ParsedBounce | null {
  const headers = parseMimeHeaders(rawMime);
  const from = getHeader(headers, "from") ?? "";
  const subject = getHeader(headers, "subject") ?? "";
  const contentType = getHeader(headers, "content-type") ?? "";
  const bodyText = extractTextBody(rawMime, headers);

  const provider = detectProvider(headers, from, subject, bodyText);
  if (provider === null) return null;

  const dsn = parseDeliveryStatusPart(rawMime, contentType);
  const statusCode = dsn.statusCode ?? extractStatusFromText(bodyText);
  const recipient = dsn.recipient ?? extractRecipient(headers, bodyText, provider);
  const diagnostic = dsn.diagnostic ?? extractDiagnostic(bodyText);

  const type = classifyBounce(statusCode, subject, bodyText);

  return {
    type,
    statusCode,
    recipient,
    diagnostic,
    provider,
  };
}

function detectProvider(
  headers: Map<string, string>,
  from: string,
  subject: string,
  bodyText: string,
): ParsedBounce["provider"] | null {
  const headerBlob = [...headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");

  if (GMAIL_FROM_RE.test(from) || GMAIL_REPORTING_MTA_RE.test(bodyText)) {
    return "gmail";
  }

  if (MICROSOFT_NDR_RE.test(headerBlob) || MICROSOFT_NDR_RE.test(bodyText)) {
    return "microsoft";
  }

  const isSmtpBounce =
    SMTP_UNDELIVERABLE_RE.test(subject.trim()) ||
    /\b(?:mail\s+delivery\s+(?:failed|subsystem|system)|mailer-daemon@|MAILER-DAEMON@)/i.test(
      from,
    ) ||
    /\bMAILER-DAEMON@/i.test(bodyText);

  if (isSmtpBounce) {
    return "smtp";
  }

  const isRfc3464 =
    /multipart\/report/i.test(getHeader(headers, "content-type") ?? "") ||
    hasDeliveryStatusPart(headers, bodyText);

  if (isRfc3464) {
    return "unknown";
  }

  if (
    /\b(?:delivery\s+status\s+notification|returned\s+mail|delivery\s+failure)\b/i.test(subject) ||
    /\b(?:status:\s*[45]\.\d+\.\d+|diagnostic-code:)/i.test(bodyText)
  ) {
    return "unknown";
  }

  return null;
}

function hasDeliveryStatusPart(headers: Map<string, string>, bodyText: string): boolean {
  const ct = getHeader(headers, "content-type") ?? "";
  if (/message\/delivery-status/i.test(ct)) return true;
  return /content-type:\s*message\/delivery-status/i.test(bodyText);
}

function classifyBounce(
  statusCode: string | null,
  subject: string,
  bodyText: string,
): "hard" | "soft" {
  if (statusCode) {
    if (statusCode.startsWith("5.")) return "hard";
    if (statusCode.startsWith("4.")) return "soft";
  }

  const combined = `${subject}\n${bodyText}`;
  if (HARD_TEXT_RE.test(combined)) return "hard";
  if (SOFT_TEXT_RE.test(combined)) return "soft";

  return "hard";
}

function extractStatusFromText(text: string): string | null {
  const statusMatch = text.match(/\bStatus:\s*([45]\.\d+\.\d+)/i);
  if (statusMatch?.[1]) return statusMatch[1].toLowerCase();

  // Enhanced status after SMTP code (e.g. "550 5.1.1 ...") or standalone X.Y.Z.
  const enhancedAfterSmtp = text.match(/\b[45]\d{2}\s+([45]\.\d+\.\d+)\b/);
  if (enhancedAfterSmtp?.[1]) return enhancedAfterSmtp[1].toLowerCase();

  const enhancedStandalone = text.match(/\b([45]\.\d+\.\d+)\b/);
  if (enhancedStandalone?.[1]) return enhancedStandalone[1].toLowerCase();

  const smtpMatch = text.match(/\b([45]\d{2})\b/);
  if (smtpMatch?.[1]) {
    return `${smtpMatch[1][0]}.0.0`;
  }

  return null;
}

function extractRecipient(
  headers: Map<string, string>,
  bodyText: string,
  provider: ParsedBounce["provider"],
): string | null {
  const failed = getHeader(headers, "x-failed-recipients");
  if (failed) return extractEmailAddress(failed);

  const originalRecipient = bodyText.match(/Original-Recipient:\s*(?:rfc822;)?\s*([^\s;]+)/i);
  if (originalRecipient?.[1]) return extractEmailAddress(originalRecipient[1]);

  const finalRecipient = bodyText.match(/Final-Recipient:\s*(?:rfc822;)?\s*([^\s;]+)/i);
  if (finalRecipient?.[1]) return extractEmailAddress(finalRecipient[1]);

  if (provider === "gmail") {
    const gmailMatch = bodyText.match(
      /(?:wasn't delivered to|was not delivered to|delivery to)\s+<?([^\s<>@]+@[^\s<>]+)>?/i,
    );
    if (gmailMatch?.[1]) return gmailMatch[1].toLowerCase();
  }

  const angleMatch = bodyText.match(/<([^\s<>@]+@[^\s<>]+)>/);
  if (angleMatch?.[1]) return angleMatch[1].toLowerCase();

  return null;
}

function extractDiagnostic(bodyText: string): string | null {
  const diagMatch = bodyText.match(/Diagnostic-Code:\s*([^\n\r]+)/i);
  if (diagMatch?.[1]) return diagMatch[1].trim();

  const remoteMatch = bodyText.match(/Remote-MTA:\s*([^\n\r]+)/i);
  if (remoteMatch?.[1]) return remoteMatch[1].trim();

  const responseMatch = bodyText.match(/\b([45]\d{2}[\s-][^\n\r]{5,120})/);
  if (responseMatch?.[1]) return responseMatch[1].trim();

  return null;
}

function extractEmailAddress(raw: string): string {
  const angle = raw.match(/<([^>]+)>/);
  if (angle?.[1]) return angle[1].trim().toLowerCase();
  const plain = raw.match(/([^\s<>@]+@[^\s<>]+)/);
  return (plain?.[1] ?? raw).trim().toLowerCase();
}

interface DsnFields {
  statusCode: string | null;
  recipient: string | null;
  diagnostic: string | null;
}

function parseDeliveryStatusPart(rawMime: string, topContentType: string): DsnFields {
  const parts = splitMimeParts(rawMime, topContentType);
  for (const part of parts) {
    const partCt = getPartHeader(part, "content-type") ?? "";
    if (!/message\/delivery-status/i.test(partCt)) continue;

    const partHeaders = parseMimeHeaders(part);
    const status =
      getHeader(partHeaders, "status") ?? part.match(/\bStatus:\s*([45]\.\d+\.\d+)/i)?.[1] ?? null;
    const recipient =
      getHeader(partHeaders, "original-recipient") ??
      getHeader(partHeaders, "final-recipient") ??
      null;
    const diagnostic = getHeader(partHeaders, "diagnostic-code") ?? null;

    return {
      statusCode: status ? status.toLowerCase() : null,
      recipient: recipient ? extractEmailAddress(recipient) : null,
      diagnostic: diagnostic?.trim() ?? null,
    };
  }

  const inline = rawMime.match(
    /content-type:\s*message\/delivery-status[\s\S]*?\n\n([\s\S]*?)(?:\n--|\ncontent-type:|$)/i,
  );
  if (inline?.[1]) {
    const block = inline[1];
    return {
      statusCode: block.match(/\bStatus:\s*([45]\.\d+\.\d+)/i)?.[1]?.toLowerCase() ?? null,
      recipient:
        extractEmailAddress(
          block.match(/Original-Recipient:\s*[^\n\r]+/i)?.[0] ??
            block.match(/Final-Recipient:\s*[^\n\r]+/i)?.[0] ??
            "",
        ) || null,
      diagnostic: block.match(/Diagnostic-Code:\s*([^\n\r]+)/i)?.[1]?.trim() ?? null,
    };
  }

  return { statusCode: null, recipient: null, diagnostic: null };
}

function parseMimeHeaders(raw: string): Map<string, string> {
  const headerEnd = findHeaderBodySplit(raw);
  const headerBlock = raw.slice(0, headerEnd);
  const unfolded = unfoldHeaders(headerBlock);
  const headers = new Map<string, string>();

  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name.length === 0) continue;
    headers.set(name, headers.has(name) ? `${headers.get(name)}, ${value}` : value);
  }

  return headers;
}

function unfoldHeaders(block: string): string {
  return block
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]+/g, " ")
    .trimEnd();
}

function findHeaderBodySplit(raw: string): number {
  const crlf = raw.indexOf("\r\n\r\n");
  if (crlf >= 0) return crlf;
  const lf = raw.indexOf("\n\n");
  return lf >= 0 ? lf : raw.length;
}

function getHeader(headers: Map<string, string>, name: string): string | null {
  return headers.get(name.toLowerCase()) ?? null;
}

function getPartHeader(part: string, name: string): string | null {
  const headerEnd = findHeaderBodySplit(part);
  const headers = parseMimeHeaders(part.slice(0, headerEnd + (part.includes("\r\n\r\n") ? 4 : 2)));
  return getHeader(headers, name);
}

function extractBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary="?([^";\s]+)"?/i);
  return match?.[1] ?? null;
}

function splitMimeParts(raw: string, contentType: string): string[] {
  const boundary = extractBoundary(contentType);
  if (!boundary) return [raw];

  const headerEnd = findHeaderBodySplit(raw);
  const bodyStart = raw.includes("\r\n\r\n") ? headerEnd + 4 : headerEnd + 2;
  const body = raw.slice(bodyStart);
  const delimiter = `--${boundary}`;

  return body
    .split(delimiter)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0 && chunk !== "--");
}

function extractTextBody(raw: string, headers: Map<string, string>): string {
  const contentType = getHeader(headers, "content-type") ?? "text/plain";
  const parts = splitMimeParts(raw, contentType);
  const texts: string[] = [];

  for (const part of parts) {
    const partHeaderEnd = findHeaderBodySplit(part);
    const partHeaders = parseMimeHeaders(part.slice(0, partHeaderEnd));
    const partCt = getHeader(partHeaders, "content-type") ?? "";
    const partEncoding = (getHeader(partHeaders, "content-transfer-encoding") ?? "").toLowerCase();

    if (/multipart\//i.test(partCt)) {
      texts.push(extractTextBody(part, partHeaders));
      continue;
    }

    if (
      !/text\/plain/i.test(partCt) &&
      !/text\/html/i.test(partCt) &&
      !/message\/delivery-status/i.test(partCt)
    ) {
      continue;
    }

    const bodyStart = part.includes("\r\n\r\n") ? partHeaderEnd + 4 : partHeaderEnd + 2;
    let body = part.slice(bodyStart).trim();
    if (partEncoding === "base64") {
      try {
        body = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
      } catch {
        // keep raw body
      }
    }
    texts.push(body);
  }

  return texts.join("\n");
}
