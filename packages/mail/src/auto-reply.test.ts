import { describe, expect, it } from "vitest";
import { detectAutoReply } from "./auto-reply.ts";

describe("detectAutoReply header triggers", () => {
  it("detects Auto-Submitted: auto-replied", () => {
    const result = detectAutoReply({ "Auto-Submitted": "auto-replied" }, null);
    expect(result).toEqual({ isAutoReply: true, reason: "auto_submitted" });
  });

  it("detects Auto-Submitted: auto-generated", () => {
    const result = detectAutoReply({ "Auto-Submitted": "auto-generated" }, null);
    expect(result).toEqual({ isAutoReply: true, reason: "auto_submitted" });
  });

  it("detects X-Autoreply: yes", () => {
    const result = detectAutoReply({ "X-Autoreply": "yes" }, null);
    expect(result).toEqual({ isAutoReply: true, reason: "x_autoreply" });
  });

  it("detects X-Autorespond", () => {
    const result = detectAutoReply({ "X-Autorespond": "true" }, null);
    expect(result).toEqual({ isAutoReply: true, reason: "x_autoreply" });
  });

  it("detects Precedence: auto_reply", () => {
    const result = detectAutoReply({ Precedence: "auto_reply" }, null);
    expect(result).toEqual({ isAutoReply: true, reason: "auto_submitted" });
  });

  it("detects Precedence: bulk", () => {
    const result = detectAutoReply({ Precedence: "bulk" }, null);
    expect(result).toEqual({ isAutoReply: true, reason: "auto_submitted" });
  });

  it("detects Precedence: list", () => {
    const result = detectAutoReply({ Precedence: "list" }, null);
    expect(result).toEqual({ isAutoReply: true, reason: "auto_submitted" });
  });
});

describe("detectAutoReply text heuristics", () => {
  it("detects out of office text when headers are clean", () => {
    const result = detectAutoReply(
      {},
      "I am out of office until Monday. I will respond when I return.",
    );
    expect(result).toEqual({ isAutoReply: true, reason: "text_heuristic" });
  });

  it("detects on vacation text", () => {
    const result = detectAutoReply({}, "Hi, I am on vacation this week.");
    expect(result).toEqual({ isAutoReply: true, reason: "text_heuristic" });
  });

  it("detects currently away text", () => {
    const result = detectAutoReply({}, "I am currently away from my desk.");
    expect(result).toEqual({ isAutoReply: true, reason: "text_heuristic" });
  });

  it("does not flag a real reply that mentions vacation as a topic", () => {
    const result = detectAutoReply(
      {},
      "Thanks for your email about the vacation rental package. Let's schedule a demo.",
    );
    expect(result).toEqual({ isAutoReply: false, reason: null });
  });

  it("prefers headers over body text", () => {
    const result = detectAutoReply(
      { "Auto-Submitted": "auto-replied" },
      "Thanks for your email about the vacation rental package.",
    );
    expect(result).toEqual({ isAutoReply: true, reason: "auto_submitted" });
  });
});

describe("detectAutoReply negative cases", () => {
  it("returns false for a normal reply", () => {
    const result = detectAutoReply(
      { Subject: "Re: Intro" },
      "Happy to chat next week — does Tuesday work?",
    );
    expect(result).toEqual({ isAutoReply: false, reason: null });
  });
});
