import { describe, expect, it, vi } from "vitest";

vi.mock("@quiksend/config", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    env: { ...(original.env as Record<string, unknown>) },
  };
});

import { env } from "@quiksend/config";
import { searchWeb } from "./search-web.ts";

describe("searchWeb", () => {
  it("uses the fake provider when no search API keys are configured in non-production", async () => {
    const results = await searchWeb("acme corp funding");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.url).toBeTruthy();
  });

  it("rejects in production when no real search provider is configured", async () => {
    const mutableEnv = env as Record<string, unknown>;
    const origNodeEnv = mutableEnv.NODE_ENV;
    const origBrave = mutableEnv.BRAVE_API_KEY;
    const origExa = mutableEnv.EXA_API_KEY;
    const origTavily = mutableEnv.TAVILY_API_KEY;

    mutableEnv.NODE_ENV = "production";
    mutableEnv.BRAVE_API_KEY = undefined;
    mutableEnv.EXA_API_KEY = undefined;
    mutableEnv.TAVILY_API_KEY = undefined;

    try {
      await expect(searchWeb("acme corp")).rejects.toThrow(
        "Production requires a real search provider",
      );
    } finally {
      mutableEnv.NODE_ENV = origNodeEnv;
      mutableEnv.BRAVE_API_KEY = origBrave;
      mutableEnv.EXA_API_KEY = origExa;
      mutableEnv.TAVILY_API_KEY = origTavily;
    }
  });
});
