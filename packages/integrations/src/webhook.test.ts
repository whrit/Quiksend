import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyNangoWebhook } from "./webhook.ts";

describe("verifyNangoWebhook", () => {
  const secret = "test-secret-not-real";
  const body = '{"type":"sync","payload":{}}';
  const sign = (input: string): string => createHmac("sha256", secret).update(input).digest("hex");

  it("accepts a correct signature", () => {
    const ok = verifyNangoWebhook({ rawBody: body, signatureHeader: sign(body), secret });
    expect(ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const ok = verifyNangoWebhook({
      rawBody: `${body}TAMPER`,
      signatureHeader: sign(body),
      secret,
    });
    expect(ok).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const ok = verifyNangoWebhook({ rawBody: body, signatureHeader: sign(body), secret: "wrong" });
    expect(ok).toBe(false);
  });

  it("rejects a missing signature header", () => {
    const ok = verifyNangoWebhook({ rawBody: body, signatureHeader: null, secret });
    expect(ok).toBe(false);
  });

  it("returns false (never throws) when no secret is configured", () => {
    // Simulates env.NANGO_WEBHOOK_SECRET being unset.
    const ok = verifyNangoWebhook({ rawBody: body, signatureHeader: "abc", secret: "" });
    expect(ok).toBe(false);
  });
});
