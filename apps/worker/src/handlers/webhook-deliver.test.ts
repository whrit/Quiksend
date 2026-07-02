import { describe, expect, it } from "vitest";
import { signWebhookPayload, verifyWebhookSignature } from "./webhook-deliver.ts";

describe("webhook HMAC signing", () => {
  const secret = "test-endpoint-secret";
  const deliveryId = "550e8400-e29b-41d4-a716-446655440000";
  const payload = { event: "message.sent", messageId: "msg-1" };
  const timestamp = Math.floor(Date.now() / 1000);

  it("round-trips sign and verify with deliveryId in the canonical string", () => {
    const signature = signWebhookPayload(payload, secret, timestamp, deliveryId);
    expect(
      verifyWebhookSignature({
        payload,
        secret,
        timestamp,
        signature,
        deliveryId,
      }),
    ).toBe(true);
  });

  it("rejects a tampered deliveryId", () => {
    const signature = signWebhookPayload(payload, secret, timestamp, deliveryId);
    expect(
      verifyWebhookSignature({
        payload,
        secret,
        timestamp,
        signature,
        deliveryId: "00000000-0000-0000-0000-000000000000",
      }),
    ).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const signature = signWebhookPayload(payload, secret, timestamp, deliveryId);
    expect(
      verifyWebhookSignature({
        payload: { event: "message.sent", messageId: "msg-2" },
        secret,
        timestamp,
        signature,
        deliveryId,
      }),
    ).toBe(false);
  });
});
