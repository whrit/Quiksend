/**
 * Auto-reply / OOO detector — distinguishes vacation responders from real replies.
 *
 * Header signals take precedence; text heuristics run only when headers are clean.
 */

export interface AutoReplyDetection {
  isAutoReply: boolean;
  reason: "auto_submitted" | "x_autoreply" | "text_heuristic" | null;
}

const AUTO_SUBMITTED_RE = /^(?:auto-replied|auto-generated)\b/i;
const X_AUTOREPLY_RE = /^yes$/i;
const PRECEDENCE_RE = /^(?:auto_reply|bulk|list)\b/i;

const OOO_TEXT_PATTERNS: readonly RegExp[] = [
  /\bout of office\b/i,
  /\bon vacation\b/i,
  /\bi am (?:currently )?away\b/i,
  /\bcurrently away\b/i,
  /\bi will respond when i return\b/i,
];

export function detectAutoReply(
  headers: Record<string, string>,
  bodyText: string | null,
): AutoReplyDetection {
  const normalized = normalizeHeaders(headers);

  const autoSubmitted = normalized.get("auto-submitted");
  if (autoSubmitted && AUTO_SUBMITTED_RE.test(autoSubmitted)) {
    return { isAutoReply: true, reason: "auto_submitted" };
  }

  const xAutoreply = normalized.get("x-autoreply");
  if (xAutoreply && X_AUTOREPLY_RE.test(xAutoreply)) {
    return { isAutoReply: true, reason: "x_autoreply" };
  }

  if (normalized.has("x-autorespond")) {
    return { isAutoReply: true, reason: "x_autoreply" };
  }

  const precedence = normalized.get("precedence");
  if (precedence && PRECEDENCE_RE.test(precedence)) {
    return { isAutoReply: true, reason: "auto_submitted" };
  }

  if (bodyText && matchesOooText(bodyText)) {
    return { isAutoReply: true, reason: "text_heuristic" };
  }

  return { isAutoReply: false, reason: null };
}

function normalizeHeaders(headers: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    out.set(key.toLowerCase(), value.trim());
  }
  return out;
}

function matchesOooText(bodyText: string): boolean {
  const sample = bodyText.slice(0, 2000);
  return OOO_TEXT_PATTERNS.some((pattern) => pattern.test(sample));
}
