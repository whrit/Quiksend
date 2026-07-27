import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@quiksend/config";

/**
 * Verify an inbound webhook signature. Nango signs the raw request body with
 * the environment's webhook signing key (distinct from the API secret key).
 * We accept the raw body + signature header(s) and return a boolean — a
 * boolean, not a throw, so callers can log 401s cleanly.
 *
 * Constant-time comparison via `timingSafeEqual` — every signature verifier we
 * ship uses this to prevent timing oracle attacks.
 *
 * After signature verification, rejects payloads whose delivery timestamp is
 * outside the replay window (default 300s) when a delivery time is known.
 * Timestamps are read from the `from` / `failedAt` / `startedAt` body fields
 * (Nango sync envelope) or an optional `timestampHeader` (unix seconds or
 * ISO-8601). Auth webhooks and successful sync webhooks often omit those
 * fields; when the HMAC is valid but no delivery time is present, we accept
 * the payload and skip the replay window (callers should dedupe via `event_id`).
 */
export interface VerifyWebhookInput {
  readonly rawBody: string;
  /** Legacy header; Nango still sends this for backward compatibility. */
  readonly signatureHeader: string | null;
  /** Preferred header per current Nango docs (`X-Nango-Hmac-Sha256`). */
  readonly hmacSha256Header?: string | null;
  /** Optional delivery timestamp header (unix seconds or ISO-8601). */
  readonly timestampHeader?: string | null;
  /** Override for tests; production uses the webhook signing key env vars. */
  readonly secret?: string;
  /** Replay window in seconds (default 300). */
  readonly maxSkewSeconds?: number;
}

const DEFAULT_MAX_SKEW_SECONDS = 300;

/** Body fields that carry the webhook delivery time (not sync cursor times). */
const DELIVERY_TIMESTAMP_FIELDS = ["from", "failedAt", "startedAt"] as const;

function parseTimestampValue(value: string): number | null {
  const trimmed = value.trim();
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum > 0) {
    return asNum > 1_000_000_000_000 ? Math.floor(asNum / 1000) : Math.floor(asNum);
  }
  const ms = Date.parse(trimmed);
  if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  return null;
}

function extractDeliveryTimestampSeconds(rawBody: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const record = parsed as Record<string, unknown>;
  let best: number | null = null;
  for (const field of DELIVERY_TIMESTAMP_FIELDS) {
    const value = record[field];
    if (typeof value !== "string" || value.length === 0) continue;
    const secs = parseTimestampValue(value);
    if (secs === null) continue;
    if (best === null || secs > best) best = secs;
  }
  return best;
}

function isTimestampFresh(timestampSeconds: number, maxSkewSeconds: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - timestampSeconds) <= maxSkewSeconds;
}

/**
 * Nango's webhook signing key (Environment Settings → Webhooks → Signing key) is
 * distinct from `NANGO_SECRET_KEY`. Prefer `NANGO_WEBHOOK_SIGNING_KEY`; fall back to
 * the legacy `NANGO_WEBHOOK_SECRET` name for older deployments.
 */
function resolveWebhookSigningKey(override?: string): string | undefined {
  if (override) return override;
  const signingKey = process.env.NANGO_WEBHOOK_SIGNING_KEY;
  if (signingKey) return signingKey;
  return env.NANGO_WEBHOOK_SECRET;
}

function matchesHmacSha256(rawBody: string, secret: string, signatureHeader: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const sig = signatureHeader.trim().toLowerCase();
  const exp = expected.toLowerCase();
  if (sig.length !== exp.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(exp));
}

function hasValidSignature(rawBody: string, secret: string, input: VerifyWebhookInput): boolean {
  const candidates = [input.hmacSha256Header, input.signatureHeader].filter(
    (header): header is string => typeof header === "string" && header.length > 0,
  );
  if (candidates.length === 0) return false;
  return candidates.some((header) => matchesHmacSha256(rawBody, secret, header));
}

export function verifyNangoWebhook(input: VerifyWebhookInput): boolean {
  const secret = resolveWebhookSigningKey(input.secret);
  if (!secret) return false;
  if (!hasValidSignature(input.rawBody, secret, input)) return false;

  const maxSkew = input.maxSkewSeconds ?? DEFAULT_MAX_SKEW_SECONDS;
  const fromHeader =
    input.timestampHeader === null || input.timestampHeader === undefined
      ? null
      : parseTimestampValue(input.timestampHeader);
  const fromBody = extractDeliveryTimestampSeconds(input.rawBody);
  const timestampSeconds = fromHeader ?? fromBody;
  // No delivery-time fields (typical for auth webhooks and successful syncs).
  // HMAC authenticity is sufficient; replay protection is the caller's dedup layer.
  if (timestampSeconds === null) return true;

  return isTimestampFresh(timestampSeconds, maxSkew);
}
