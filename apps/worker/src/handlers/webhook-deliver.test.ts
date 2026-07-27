import { lookup } from "node:dns/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeNextAttemptAt,
  fetchWebhookWithSsrfProtection,
  signWebhookPayload,
  validateWebhookDeliveryUrl,
  verifyWebhookSignature,
  WEBHOOK_RETRY_DELAYS_MS,
} from "./webhook-deliver.ts";

type MockLookup = {
  mockReset: () => void;
  mockImplementation: (
    fn: (
      hostname: string,
      options?: { all?: boolean; verbatim?: boolean },
    ) => Promise<Array<{ address: string; family: number }>>,
  ) => MockLookup;
  mockImplementationOnce: (
    fn: (
      hostname: string,
      options?: { all?: boolean; verbatim?: boolean },
    ) => Promise<Array<{ address: string; family: number }>>,
  ) => MockLookup;
};

vi.mock("node:dns/promises", () => ({
  lookup:
    vi.fn<
      (
        hostname: string,
        options?: { all?: boolean; verbatim?: boolean },
      ) => Promise<Array<{ address: string; family: number }>>
    >(),
}));

const mockLookup = lookup as unknown as MockLookup;

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

describe("webhook delivery SSRF protection", () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  it("rejects hostnames resolving to private IPv4 addresses", async () => {
    mockLookup.mockImplementation(async () => [{ address: "10.0.0.1", family: 4 }]);

    await expect(validateWebhookDeliveryUrl("https://customer.example.com/hook")).rejects.toThrow(
      /private or metadata address/i,
    );
  });

  it("rejects hostnames resolving to link-local metadata addresses", async () => {
    mockLookup.mockImplementation(async () => [{ address: "169.254.169.254", family: 4 }]);

    await expect(validateWebhookDeliveryUrl("https://customer.example.com/hook")).rejects.toThrow(
      /private or metadata address/i,
    );
  });

  it("rejects hostnames resolving to IPv6 loopback", async () => {
    mockLookup.mockImplementation(async () => [{ address: "::1", family: 6 }]);

    await expect(validateWebhookDeliveryUrl("https://customer.example.com/hook")).rejects.toThrow(
      /private or metadata address/i,
    );
  });

  it("rejects literal IPv6 loopback URLs", async () => {
    await expect(validateWebhookDeliveryUrl("http://[::1]/hook")).rejects.toThrow(/blocked host/i);
  });

  it("rejects literal metadata IPv4 URLs", async () => {
    await expect(validateWebhookDeliveryUrl("http://169.254.169.254/hook")).rejects.toThrow(
      /blocked host/i,
    );
  });

  it("refuses fetch when redirect target resolves to a private address", async () => {
    let lookupCalls = 0;
    mockLookup.mockImplementation(async () => {
      lookupCalls += 1;
      if (lookupCalls === 1) return [{ address: "8.8.8.8", family: 4 }];
      return [{ address: "10.0.0.1", family: 4 }];
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.example.com/internal" },
      }),
    );

    await expect(
      fetchWebhookWithSsrfProtection("https://customer.example.com/hook", { method: "POST" }),
    ).rejects.toThrow(/private or metadata address/i);

    fetchMock.mockRestore();
  });
});

describe("webhook retry scheduling", () => {
  it("uses the final delay before the last allowed attempt", () => {
    const next = computeNextAttemptAt(WEBHOOK_RETRY_DELAYS_MS.length);
    expect(next).not.toBeNull();
    expect(next?.getTime()).toBeGreaterThan(Date.now() + 12 * 60 * 60_000 - 1000);
  });
});
