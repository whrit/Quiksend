import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@quiksend/config";

/**
 * Verify an inbound webhook signature. Nango signs the raw request body with
 * the workspace's webhook secret. We accept the raw body + signature header and
 * return a boolean — a boolean, not a throw, so callers can log 401s cleanly.
 *
 * Constant-time comparison via `timingSafeEqual` — every signature verifier we
 * ship uses this to prevent timing oracle attacks.
 */
export interface VerifyWebhookInput {
  readonly rawBody: string;
  readonly signatureHeader: string | null;
  /** Override for tests; production uses `env.NANGO_WEBHOOK_SECRET`. */
  readonly secret?: string;
}

export function verifyNangoWebhook(input: VerifyWebhookInput): boolean {
  const secret = input.secret ?? env.NANGO_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!input.signatureHeader) return false;

  const expected = createHmac("sha256", secret).update(input.rawBody).digest("hex");
  const sig = input.signatureHeader.trim().toLowerCase();
  const exp = expected.toLowerCase();
  if (sig.length !== exp.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(exp));
}
