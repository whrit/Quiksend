import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signWebhookPayload, verifyWebhookSignature } from "./webhook-deliver.ts";

/** SEC-005 (GAMMA): deliveryId must be included in the signed payload. */
function signWebhookPayloadWithDelivery(
  payload: unknown,
  secret: string,
  timestamp: number,
  deliveryId: string,
): string {
  const body = `${timestamp}.${deliveryId}.${JSON.stringify(payload)}`;
  return createHmac("sha256", secret).update(body).digest("hex");
}

function verifyWebhookSignatureWithDelivery(input: {
  payload: unknown;
  secret: string;
  timestamp: number;
  signature: string;
  deliveryId: string;
  maxSkewSeconds?: number;
}): boolean {
  const maxSkew = input.maxSkewSeconds ?? 300;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.timestamp) > maxSkew) return false;

  const expected = signWebhookPayloadWithDelivery(
    input.payload,
    input.secret,
    input.timestamp,
    input.deliveryId,
  );
  const sig = input.signature.trim().toLowerCase();
  const exp = expected.toLowerCase();
  if (sig.length !== exp.length) return false;
  return sig === exp;
}

describe("webhook HMAC signing", () => {
  const secret = "whsec_test_secret";
  const payload = { event: "message.sent", id: "msg-1" };

  it("round-trips sign and verify for the current payload format", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(payload, secret, timestamp);

    expect(
      verifyWebhookSignature({
        payload,
        secret,
        timestamp,
        signature,
      }),
    ).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(payload, secret, timestamp);

    expect(
      verifyWebhookSignature({
        payload: { ...payload, id: "tampered" },
        secret,
        timestamp,
        signature,
      }),
    ).toBe(false);
  });

  it("rejects timestamps outside the 300s skew window", () => {
    const timestamp = Math.floor(Date.now() / 1000) - 400;
    const signature = signWebhookPayload(payload, secret, timestamp);

    expect(
      verifyWebhookSignature({
        payload,
        secret,
        timestamp,
        signature,
      }),
    ).toBe(false);
  });

  it("SEC-005 contract: deliveryId-bound signature round-trips via spec helpers (GAMMA)", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const deliveryId = "delivery-uuid-1";
    const signature = signWebhookPayloadWithDelivery(payload, secret, timestamp, deliveryId);

    expect(
      verifyWebhookSignatureWithDelivery({
        payload,
        secret,
        timestamp,
        signature,
        deliveryId,
      }),
    ).toBe(true);

    expect(
      verifyWebhookSignatureWithDelivery({
        payload,
        secret,
        timestamp,
        signature,
        deliveryId: "other-delivery",
      }),
    ).toBe(false);
  });
});
