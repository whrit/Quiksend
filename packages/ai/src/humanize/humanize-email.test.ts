import { describe, expect, it } from "vitest";
import { humanizeEmail, parseSpintax } from "./humanize-email.ts";

describe("parseSpintax", () => {
  it("picks deterministically from options", () => {
    const a = parseSpintax("{Hi|Hey|Hello} there", "seed-1");
    const b = parseSpintax("{Hi|Hey|Hello} there", "seed-1");
    expect(a).toBe(b);
    expect(["Hi there", "Hey there", "Hello there"]).toContain(a);
  });
});

describe("humanizeEmail", () => {
  it("returns warnings for spam phrases", () => {
    const result = humanizeEmail(
      {
        subject: "Act now — guaranteed results",
        bodyMarkdown:
          "Hi there, I wanted to reach out about your team. We help companies streamline outreach with better tooling and workflows.",
      },
      "gen-123",
    );
    expect(result.warnings.some((w) => w.code === "spam_phrase")).toBe(true);
  });

  it("applies spintax variations to greetings", () => {
    const input = {
      subject: "Hi — quick question",
      bodyMarkdown:
        "Hi there, I wanted to reach out about your team. We help companies streamline outreach with better tooling and workflows.",
    };
    const result = humanizeEmail(input, "gen-spintax-test");
    expect(result.humanized).toBe(true);
    expect(result.subject).not.toBe(input.subject);
  });
});
