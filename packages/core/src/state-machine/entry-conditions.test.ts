import { describe, expect, it } from "vitest";
import { evaluateEntryCondition } from "./entry-conditions.ts";

const baseCtx = {
  hasReplyOnThread: false,
  hasBounceOnThread: false,
  currentStepIndex: 1,
  lastReplyAt: null,
};

describe("evaluateEntryCondition", () => {
  it("proceeds when condition is null", () => {
    expect(evaluateEntryCondition(null, baseCtx)).toEqual({ proceed: true });
  });

  it("skips if_no_reply when thread has a reply", () => {
    const result = evaluateEntryCondition(
      { kind: "if_no_reply" },
      { ...baseCtx, hasReplyOnThread: true },
    );
    expect(result.proceed).toBe(false);
    expect(result.skipReason).toContain("if_no_reply");
  });

  it("proceeds if_no_reply when no reply on thread", () => {
    expect(evaluateEntryCondition({ kind: "if_no_reply" }, baseCtx)).toEqual({ proceed: true });
  });
});
