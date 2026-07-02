import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("unsubscribe token", () => {
  beforeAll(() => {
    vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", "test-secret-for-unsubscribe-tokens");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips prospect + org", async () => {
    const { mintUnsubscribeToken, verifyUnsubscribeToken } = await import("./unsubscribe.ts");
    const token = mintUnsubscribeToken({
      prospectId: "550e8400-e29b-41d4-a716-446655440000",
      orgId: "org_test123",
    });
    const payload = verifyUnsubscribeToken(token);
    expect(payload).toEqual({
      prospectId: "550e8400-e29b-41d4-a716-446655440000",
      orgId: "org_test123",
      iat: expect.any(Number),
    });
  });

  it("rejects tampered tokens", async () => {
    const { mintUnsubscribeToken, verifyUnsubscribeToken } = await import("./unsubscribe.ts");
    const token = mintUnsubscribeToken({
      prospectId: "550e8400-e29b-41d4-a716-446655440000",
      orgId: "org_test123",
    });
    expect(verifyUnsubscribeToken(`${token}x`)).toBeNull();
  });
});
