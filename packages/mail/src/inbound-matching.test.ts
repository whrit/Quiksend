import { describe, expect, it } from "vitest";
import { extractCandidateIds, matchInbound, type OutboundAnchor } from "./inbound-matching.ts";

const anchorA: OutboundAnchor = {
  messageIdHeader: "<msg-a@quiksend.test>",
  providerThreadId: "thread-a",
  subject: "Intro to Quiksend",
};

const anchorB: OutboundAnchor = {
  messageIdHeader: "<msg-b@quiksend.test>",
  providerThreadId: "thread-b",
  subject: "Follow-up on pricing",
};

describe("extractCandidateIds", () => {
  it("normalizes In-Reply-To and References", () => {
    const ids = extractCandidateIds({
      inReplyTo: "MSG-B@QUIKSEND.TEST",
      references: "<msg-a@quiksend.test> <msg-b@quiksend.test>",
      providerThreadId: " thread-b ",
      subject: "Re: Follow-up",
    });
    expect(ids.normalizedInReplyTo).toBe("<msg-b@quiksend.test>");
    expect(ids.normalizedReferences).toEqual(["<msg-a@quiksend.test>", "<msg-b@quiksend.test>"]);
    expect(ids.providerThreadId).toBe("thread-b");
  });

  it("returns null for malformed In-Reply-To", () => {
    const ids = extractCandidateIds({
      inReplyTo: "   ",
      references: null,
      providerThreadId: null,
      subject: null,
    });
    expect(ids.normalizedInReplyTo).toBeNull();
    expect(ids.normalizedReferences).toEqual([]);
  });
});

describe("matchInbound", () => {
  it("matches on In-Reply-To (happy path)", () => {
    const match = matchInbound(
      {
        inReplyTo: "<msg-b@quiksend.test>",
        references: "<msg-a@quiksend.test> <msg-b@quiksend.test>",
        providerThreadId: null,
        subject: "Re: Follow-up on pricing",
      },
      [anchorA, anchorB],
    );
    expect(match).toEqual({
      outboundMessageIdHeader: "<msg-b@quiksend.test>",
      matchType: "in_reply_to",
      confidence: "high",
    });
  });

  it("matches on References mid-chain", () => {
    const match = matchInbound(
      {
        inReplyTo: "<other@client.com>",
        references: "<msg-a@quiksend.test> <other@client.com>",
        providerThreadId: null,
        subject: "Re: Intro",
      },
      [anchorA, anchorB],
    );
    expect(match).toEqual({
      outboundMessageIdHeader: "<msg-a@quiksend.test>",
      matchType: "references",
      confidence: "high",
    });
  });

  it("matches on providerThreadId when Message-Id does not line up", () => {
    const match = matchInbound(
      {
        inReplyTo: "<rewritten-by-mobile@client.com>",
        references: "<rewritten-by-mobile@client.com>",
        providerThreadId: "thread-b",
        subject: "Re: Follow-up",
      },
      [anchorA, anchorB],
    );
    expect(match).toEqual({
      outboundMessageIdHeader: "<msg-b@quiksend.test>",
      matchType: "thread_id",
      confidence: "high",
    });
  });

  it("matches via subject heuristic fallback", () => {
    const match = matchInbound(
      {
        inReplyTo: null,
        references: null,
        providerThreadId: null,
        subject: "Fwd: Re: Follow-up on pricing",
      },
      [anchorA, anchorB],
    );
    expect(match).toEqual({
      outboundMessageIdHeader: "<msg-b@quiksend.test>",
      matchType: "subject_heuristic",
      confidence: "medium",
    });
  });

  it("returns null when nothing matches", () => {
    const match = matchInbound(
      {
        inReplyTo: "<unknown@elsewhere.com>",
        references: "<unknown@elsewhere.com>",
        providerThreadId: "thread-z",
        subject: "Unrelated topic",
      },
      [anchorA, anchorB],
    );
    expect(match).toBeNull();
  });

  it("matches the correct anchor among many, not the first", () => {
    const match = matchInbound(
      {
        inReplyTo: "<msg-b@quiksend.test>",
        references: null,
        providerThreadId: null,
        subject: null,
      },
      [anchorA, anchorB],
    );
    expect(match?.outboundMessageIdHeader).toBe("<msg-b@quiksend.test>");
  });

  it("handles malformed inbound headers cleanly", () => {
    const match = matchInbound(
      {
        inReplyTo: "   ",
        references: "garbage <>  ",
        providerThreadId: "",
        subject: "   ",
      },
      [anchorA, anchorB],
    );
    expect(match).toBeNull();
  });
});
