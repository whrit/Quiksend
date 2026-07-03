import { describe, expect, it } from "vitest";
import { evaluateEntryCondition } from "./entry-conditions.ts";

const baseCtx = {
  hasReplyOnThread: false,
  hasBounceOnThread: false,
  currentStepIndex: 1,
  lastReplyAt: null,
  recipientGateway: null,
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

  it("skips when recipient gateway is not in allow list", () => {
    const result = evaluateEntryCondition(
      { recipientGatewayIn: ["proofpoint"] },
      { ...baseCtx, recipientGateway: "mimecast" },
    );
    expect(result).toEqual({
      proceed: false,
      skipReason: "recipient_gateway_not_in_allow_list",
    });
  });

  it("proceeds when recipient gateway is in allow list", () => {
    expect(
      evaluateEntryCondition(
        { recipientGatewayIn: ["proofpoint", "mimecast"] },
        { ...baseCtx, recipientGateway: "proofpoint" },
      ),
    ).toEqual({ proceed: true });
  });

  it("skips when recipient gateway is in deny list", () => {
    const result = evaluateEntryCondition(
      { recipientGatewayNotIn: ["proofpoint"] },
      { ...baseCtx, recipientGateway: "proofpoint" },
    );
    expect(result).toEqual({
      proceed: false,
      skipReason: "recipient_gateway_in_deny_list",
    });
  });

  it("proceeds deny list when recipient gateway is not listed", () => {
    expect(
      evaluateEntryCondition(
        { recipientGatewayNotIn: ["proofpoint"] },
        { ...baseCtx, recipientGateway: "google_workspace" },
      ),
    ).toEqual({ proceed: true });
  });

  it("ignores gateway predicates when recipient gateway is unknown/null", () => {
    expect(evaluateEntryCondition({ recipientGatewayIn: ["proofpoint"] }, baseCtx)).toEqual({
      proceed: true,
    });
  });

  it("if_no_reply short-circuits over gateway predicate", () => {
    const result = evaluateEntryCondition(
      { kind: "if_no_reply", recipientGatewayIn: ["proofpoint"] },
      { ...baseCtx, hasReplyOnThread: true, recipientGateway: "proofpoint" },
    );
    expect(result.proceed).toBe(false);
    expect(result.skipReason).toContain("if_no_reply");
  });
});
