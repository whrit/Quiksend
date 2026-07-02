import { describe, expect, it, vi } from "vitest";
import { EmailSchema } from "./email-schema.ts";
import { generateEmail } from "./generate-email.ts";
import type { BuiltPrompt } from "./prompt-builder.ts";

const generateObject = vi.fn<(...args: unknown[]) => Promise<{ object: unknown }>>();

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObject(...args),
}));

vi.mock("../model/provider.ts", () => ({
  getDefaultModel: () => ({}),
}));

const prompt: BuiltPrompt = {
  system: "You write emails.",
  user: "Write a follow-up.",
  valuePropIds: [],
};

const validOutput = {
  subject: "Quick follow-up on our chat",
  body_markdown:
    "Hi there,\n\nI wanted to follow up on our conversation last week and see if you had any questions about the proposal we discussed. Happy to jump on a call if that would help.\n\nBest,\nAlex",
  angle: "value reminder",
  cited_facts: [{ claim: "Met last week", source_url: "https://example.com/meeting" }],
};

describe("generateEmail", () => {
  it("retries once when the model returns an invalid schema, then succeeds", async () => {
    generateObject
      .mockRejectedValueOnce(new Error("schema parse failed"))
      .mockResolvedValueOnce({ object: validOutput });

    const result = await generateEmail(prompt);

    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(EmailSchema.safeParse(result).success).toBe(true);
    expect(result.subject).toBe(validOutput.subject);
    expect(result.body_markdown).toBe(validOutput.body_markdown);
    expect(result.model).toBeTruthy();
    expect(result.prompt).toEqual(prompt);
  });
});
