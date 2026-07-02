import { client } from "@quiksend/db";
import { describe, expect, it, beforeEach } from "vitest";
import { checkAuthIpRateLimit } from "./middleware.ts";

function makeRequest(ip: string): Request {
  return new Request("http://localhost:3000/api/auth/get-session", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("checkAuthIpRateLimit", () => {
  beforeEach(async () => {
    await client`delete from auth_rate_bucket`;
  });

  it("returns 429 after exceeding the per-IP limit", async () => {
    const request = makeRequest("203.0.113.50");
    const limit = 100;

    for (let i = 0; i < limit; i++) {
      const outcome = await checkAuthIpRateLimit(request, limit);
      expect(outcome.ok).toBe(true);
    }

    const blocked = await checkAuthIpRateLimit(request, limit);
    expect(blocked).toEqual({ ok: false, retryAfter: 60 });
  });
});
