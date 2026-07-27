import { client } from "@quiksend/db";
import { beforeEach, describe, expect, it } from "vitest";
import { checkApiKeyRateLimit } from "./middleware.ts";

describe("checkApiKeyRateLimit", () => {
  beforeEach(async () => {
    await client`delete from auth_rate_bucket`;
  });

  it("returns 429 after exceeding the per-key limit", async () => {
    const apiKeyId = "key-rate-limit-test";
    const limit = 100;

    for (let i = 0; i < limit; i++) {
      const outcome = await checkApiKeyRateLimit(apiKeyId, limit);
      expect(outcome.ok).toBe(true);
    }

    const blocked = await checkApiKeyRateLimit(apiKeyId, limit);
    expect(blocked).toEqual({ ok: false, retryAfter: 60 });
  });
});
