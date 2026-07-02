import { describe, expect, it } from "vitest";
import { createFakeSearchProvider } from "./fake.ts";

describe("createFakeSearchProvider", () => {
  it("returns fixture results for a known query", async () => {
    const provider = createFakeSearchProvider();
    const results = await provider.search("acme corp funding");
    expect(results).toHaveLength(2);
    expect(results[0]?.title).toBe("Acme Corp raises Series B");
    expect(results[0]?.url).toContain("acme-series-b");
  });

  it("respects the limit option", async () => {
    const provider = createFakeSearchProvider();
    const results = await provider.search("acme corp funding", { limit: 1 });
    expect(results).toHaveLength(1);
  });

  it("returns the default fixture for unknown queries", async () => {
    const provider = createFakeSearchProvider();
    const results = await provider.search("totally unknown query");
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("No fixture match");
  });
});
