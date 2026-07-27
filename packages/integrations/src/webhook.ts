import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@quiksend/config";

/**
 * Verify an inbound webhook signature. Nango signs the raw request body with
 * the workspace's webhook secret. We accept the raw body + signature header and
 * return a boolean — a boolean, not a throw, so callers can log 401s cleanly.
 *
 * Constant-time comparison via `timingSafeEqual` — every signature verifier we
 * ship uses this to prevent timing oracle attacks.
 *
 * After signature verification, rejects payloads whose delivery timestamp is
 * outside the replay window (default 300s). Timestamps are read from the
 * `from` / `failedAt` / `startedAt` body fields (Nango webhook envelope) or
 * an optional `timestampHeader` (unix seconds or ISO-8601).
 */
export interface VerifyWebhookInput {
  readonly rawBody: string;
  readonly signatureHeader: string | null;
  /** Optional delivery timestamp header (unix seconds or ISO-8601). */
  readonly timestampHeader?: string | null;
  /** Override for tests; production uses `env.NANGO_WEBHOOK_SECRET`. */
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

export function verifyNangoWebhook(input: VerifyWebhookInput): boolean {
  const secret = input.secret ?? env.NANGO_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!input.signatureHeader) return false;

  const expected = createHmac("sha256", secret).update(input.rawBody).digest("hex");
  const sig = input.signatureHeader.trim().toLowerCase();
  const exp = expected.toLowerCase();
  if (sig.length !== exp.length) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return false;

  const maxSkew = input.maxSkewSeconds ?? DEFAULT_MAX_SKEW_SECONDS;
  const fromHeader =
    input.timestampHeader === null || input.timestampHeader === undefined
      ? null
      : parseTimestampValue(input.timestampHeader);
  const fromBody = extractDeliveryTimestampSeconds(input.rawBody);
  const timestampSeconds = fromHeader ?? fromBody;
  if (timestampSeconds === null) return false;

  return isTimestampFresh(timestampSeconds, maxSkew);
}
