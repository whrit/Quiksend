import { generateObject } from "ai";
import { describe, expect, it, vi } from "vitest";
import { getDefaultModel } from "../model/provider.ts";
import { generateEmail } from "./generate-email.ts";
import type { BuiltPrompt } from "./prompt-builder.ts";

vi.mock("ai", () => ({
  generateObject: vi.fn<typeof import("ai").generateObject>(),
}));

vi.mock("../model/provider.ts", () => ({
  getDefaultModel: vi.fn<typeof getDefaultModel>(),
}));

const prompt: BuiltPrompt = {
  system: "system",
  user: "user",
  valuePropIds: [],
};

describe("generateEmail", () => {
  it("persists modelId from getDefaultModel, not a hardcoded string", async () => {
    vi.mocked(getDefaultModel).mockReturnValue({
      model: {} as ReturnType<typeof getDefaultModel>["model"],
      modelId: "claude-sonnet-4-5",
      provider: "anthropic",
    });
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        subject: "Hello",
        body_markdown: "Body",
        angle: "Direct",
        cited_facts: [],
      },
    } as Awaited<ReturnType<typeof generateObject>>);

    const result = await generateEmail(prompt);

    expect(result.model).toBe("claude-sonnet-4-5");
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.any(Object) }),
    );
  });
});
