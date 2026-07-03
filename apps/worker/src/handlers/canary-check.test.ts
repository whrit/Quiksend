import { describe, expect, it } from "vitest";
import { evaluateAutoPause } from "@quiksend/core/deliverability";

describe("canary-check auto-pause integration", () => {
  it("pauses when rolling window stats breach threshold", () => {
    const decision = evaluateAutoPause(
      {
        sequenceId: "seq",
        mailboxId: "mb",
        gateway: "proofpoint",
        delivered: 1,
        total: 5,
      },
      80,
    );
    expect(decision.action).toBe("pause");
    expect(decision.deliverabilityPct).toBe(20);
  });
});
