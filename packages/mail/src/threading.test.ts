import { describe, expect, it } from "vitest";
import {
  buildThreadingHeaders,
  normalizeMessageId,
  parseReferences,
  replySubject,
} from "./threading.ts";

describe("normalizeMessageId", () => {
  it("lowercases and adds angle brackets", () => {
    expect(normalizeMessageId("ABC@example.com")).toBe("<abc@example.com>");
  });

  it("collapses repeated angle brackets", () => {
    expect(normalizeMessageId("<<abc@example.com>>")).toBe("<abc@example.com>");
  });

  it("rejects empty and whitespace-only ids", () => {
    expect(() => normalizeMessageId("")).toThrow(/empty/i);
    expect(() => normalizeMessageId("   ")).toThrow(/empty/i);
    expect(() => normalizeMessageId("<>")).toThrow(/whitespace-only|empty/i);
  });
});

describe("parseReferences", () => {
  it("normalizes every entry in a References header", () => {
    const chain = parseReferences("<A@x> <B@x> <C@x>");
    expect(chain).toEqual(["<a@x>", "<b@x>", "<c@x>"]);
  });

  it("silently drops malformed entries", () => {
    const chain = parseReferences("<A@x> garbage <> <B@x>");
    // "garbage" normalizes to "<garbage>" (technically valid per RFC, just weird)
    // but `<>` is dropped.
    expect(chain).toContain("<a@x>");
    expect(chain).toContain("<b@x>");
    expect(chain).not.toContain("<>");
  });

  it("returns empty on null/undefined", () => {
    expect(parseReferences(null)).toEqual([]);
    expect(parseReferences(undefined)).toEqual([]);
  });
});

describe("replySubject", () => {
  it("prepends Re: to a plain subject", () => {
    expect(replySubject("Hello world")).toBe("Re: Hello world");
  });

  it("does NOT stack Re: Re:", () => {
    expect(replySubject("Re: Hello world")).toBe("Re: Hello world");
    expect(replySubject("RE:  Hello")).toBe("RE:  Hello");
    expect(replySubject("re: Hello")).toBe("re: Hello");
  });
});

describe("buildThreadingHeaders", () => {
  it("builds In-Reply-To + References for a fresh reply", () => {
    const h = buildThreadingHeaders({
      messageId: "<anchor@quiksend>",
      subject: "Intro",
      providerThreadId: "gmail-thread-1",
    });
    expect(h.inReplyTo).toBe("<anchor@quiksend>");
    expect(h.references).toBe("<anchor@quiksend>");
    expect(h.subject).toBe("Re: Intro");
    expect(h.providerThreadId).toBe("gmail-thread-1");
  });

  it("chains References with priors and dedupes", () => {
    const h = buildThreadingHeaders({
      messageId: "<c@x>",
      subject: "Re: Intro",
      priorReferences: ["<A@x>", "<B@x>", "<A@x>"],
    });
    expect(h.references).toBe("<a@x> <b@x> <c@x>");
    expect(h.subject).toBe("Re: Intro");
  });
});
