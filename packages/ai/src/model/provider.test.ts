import { describe, expect, it } from "vitest";
import { getDefaultModel, resolveModel } from "./provider.ts";

describe("resolveModel", () => {
  it("throws when ANTHROPIC_API_KEY is missing for anthropic provider", () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => resolveModel({ provider: "anthropic", modelId: "claude-sonnet-4-5" })).toThrow(
        /ANTHROPIC_API_KEY is required/,
      );
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it("throws when OPENAI_API_KEY is missing for openai provider", () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => resolveModel({ provider: "openai", modelId: "gpt-4o" })).toThrow(
        /OPENAI_API_KEY is required/,
      );
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  it("returns a LanguageModel when the API key is set", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const model = resolveModel({ provider: "anthropic", modelId: "claude-sonnet-4-5" });
    expect(model).toBeDefined();
    expect(typeof model).toBe("object");
  });
});

describe("getDefaultModel", () => {
  it("throws with a clear error when the default provider API key is unset", () => {
    const prevAnthropic = process.env.ANTHROPIC_API_KEY;
    const prevProvider = process.env.AI_DEFAULT_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AI_DEFAULT_PROVIDER = "anthropic";
    try {
      expect(() => getDefaultModel()).toThrow(/ANTHROPIC_API_KEY is required/);
    } finally {
      if (prevAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = prevAnthropic;
      if (prevProvider !== undefined) process.env.AI_DEFAULT_PROVIDER = prevProvider;
      else delete process.env.AI_DEFAULT_PROVIDER;
    }
  });

  it("returns model metadata matching the resolved default", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.AI_DEFAULT_PROVIDER = "anthropic";
    const result = getDefaultModel();
    expect(result.provider).toBe("anthropic");
    expect(result.modelId).toBe("claude-sonnet-4-5");
    expect(result.model).toBeDefined();
  });
});
