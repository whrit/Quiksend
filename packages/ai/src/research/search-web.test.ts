import { describe, expect, it } from "vitest";
import { searchWeb } from "./search-web.ts";

describe("searchWeb", () => {
  it("uses the fake provider when no search API keys are configured", async () => {
    const results = await searchWeb("acme corp funding");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.url).toBeTruthy();
  });
});
