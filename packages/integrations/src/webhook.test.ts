/**
 * These tests cover Nango's INBOUND webhook signature (Nango → us).
 * Outbound HMAC (us → subscriber endpoints) is tested in webhook-deliver.test.ts.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyNangoWebhook } from "./webhook.ts";

function freshBody(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "sync",
    payload: {},
    from: new Date().toISOString(),
    ...extra,
  });
}

describe("Nango inbound webhook signature verification", () => {
  const secret = "test-secret-not-real";

  const sign = (input: string): string => createHmac("sha256", secret).update(input).digest("hex");

  it("accepts a correct signature with a fresh delivery timestamp", () => {
    const body = freshBody();
    const ok = verifyNangoWebhook({ rawBody: body, signatureHeader: sign(body), secret });
    expect(ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = freshBody();
    const ok = verifyNangoWebhook({
      rawBody: `${body}TAMPER`,
      signatureHeader: sign(body),
      secret,
    });
    expect(ok).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const body = freshBody();
    const ok = verifyNangoWebhook({ rawBody: body, signatureHeader: sign(body), secret: "wrong" });
    expect(ok).toBe(false);
  });

  it("rejects a missing signature header", () => {
    const body = freshBody();
    const ok = verifyNangoWebhook({ rawBody: body, signatureHeader: null, secret });
    expect(ok).toBe(false);
  });

  it("returns false (never throws) when no secret is configured", () => {
    const body = freshBody();
    const ok = verifyNangoWebhook({ rawBody: body, signatureHeader: "abc", secret: "" });
    expect(ok).toBe(false);
  });

  it("accepts payloads with no delivery timestamp (auth webhooks omit it)", () => {
    // Nango auth webhooks and successful syncs carry no delivery-time field.
    // HMAC proves authenticity; replay is handled by the nangoWebhookProcessed
    // dedup table, so absence must not be treated as a forgery.
    const body = '{"type":"sync","payload":{}}';
    const ok = verifyNangoWebhook({ rawBody: body, signatureHeader: sign(body), secret });
    expect(ok).toBe(true);
  });

  it("rejects payloads outside the replay window", () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const body = JSON.stringify({ type: "sync", payload: {}, from: stale });
    const ok = verifyNangoWebhook({ rawBody: body, signatureHeader: sign(body), secret });
    expect(ok).toBe(false);
  });

  it("accepts a timestamp from the optional header when the body has none", () => {
    const body = '{"type":"auth","operation":"creation"}';
    const now = Math.floor(Date.now() / 1000);
    const ok = verifyNangoWebhook({
      rawBody: body,
      signatureHeader: sign(body),
      secret,
      timestampHeader: String(now),
    });
    expect(ok).toBe(true);
  });
});
