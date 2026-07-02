import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn<typeof generateTextStub>(),
}));

function generateTextStub() {
  return Promise.resolve({ text: "objection" });
}

vi.mock("@quiksend/config", () => ({
  env: {
    ANTHROPIC_API_KEY: "test-key",
    OPENAI_API_KEY: undefined,
    AI_DEFAULT_PROVIDER: "anthropic",
  },
  logger: {
    warn: vi.fn<(msg: unknown, ...args: unknown[]) => void>(),
    info: vi.fn<(msg: unknown, ...args: unknown[]) => void>(),
    error: vi.fn<(msg: unknown, ...args: unknown[]) => void>(),
  },
}));

vi.mock("../model/provider.ts", () => ({
  getDefaultModel: vi.fn<() => string>(() => "mock-model"),
}));

import { generateText } from "ai";
import { classifyInboundSentiment } from "./sentiment.ts";

describe("classifyInboundSentiment", () => {
  beforeEach(() => {
    vi.mocked(generateText).mockReset();
  });

  it("returns parsed label from model response", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "objection" } as never);
    const result = await classifyInboundSentiment({
      subject: "Re: Hello",
      bodyText: "Not interested, thanks.",
      bodyHtml: null,
    });
    expect(result).toBe("objection");
  });

  it("returns null for null label", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "null" } as never);
    const result = await classifyInboundSentiment({
      subject: null,
      bodyText: "Thanks for the info.",
      bodyHtml: null,
    });
    expect(result).toBeNull();
  });
});
