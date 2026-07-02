import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@quiksend/config";

/** Token lifetime — one year is generous for email footers. */
export const UNSUBSCRIBE_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;

export interface UnsubscribeTokenPayload {
  readonly prospectId: string;
  readonly orgId: string;
  readonly iat: number;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: UnsubscribeTokenPayload, secret: string): string {
  const body = JSON.stringify(payload);
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${base64UrlEncode(body)}.${sig}`;
}

function parseSignedToken(token: string, secret: string): UnsubscribeTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedBody, sig] = parts;
  if (!encodedBody || !sig) return null;

  let body: string;
  try {
    body = base64UrlDecode(encodedBody);
  } catch {
    return null;
  }

  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  let payload: UnsubscribeTokenPayload;
  try {
    payload = JSON.parse(body) as UnsubscribeTokenPayload;
  } catch {
    return null;
  }

  if (!payload.prospectId || !payload.orgId || typeof payload.iat !== "number") return null;

  const ageSeconds = Math.floor(Date.now() / 1000) - payload.iat;
  if (ageSeconds < 0 || ageSeconds > UNSUBSCRIBE_TOKEN_TTL_SECONDS) return null;

  return payload;
}

export function mintUnsubscribeToken(input: { prospectId: string; orgId: string }): string {
  const secret = process.env.UNSUBSCRIBE_TOKEN_SECRET ?? env.UNSUBSCRIBE_TOKEN_SECRET;
  if (!secret) throw new Error("UNSUBSCRIBE_TOKEN_SECRET is not configured");

  const payload: UnsubscribeTokenPayload = {
    prospectId: input.prospectId,
    orgId: input.orgId,
    iat: Math.floor(Date.now() / 1000),
  };
  return signPayload(payload, secret);
}

export function verifyUnsubscribeToken(token: string): UnsubscribeTokenPayload | null {
  const secret = process.env.UNSUBSCRIBE_TOKEN_SECRET ?? env.UNSUBSCRIBE_TOKEN_SECRET;
  if (!secret) return null;
  return parseSignedToken(token, secret);
}

export function buildUnsubscribeUrl(baseUrl: string, token: string): string {
  const url = new URL("/api/v1/unsubscribe", baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}
