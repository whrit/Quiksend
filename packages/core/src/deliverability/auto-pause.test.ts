import { describe, expect, it } from "vitest";
import { evaluateAutoPause } from "./auto-pause.ts";

const baseStats = {
  sequenceId: "seq-1",
  mailboxId: "mb-1",
  gateway: "proofpoint" as const,
  delivered: 0,
  total: 0,
};

describe("evaluateAutoPause", () => {
  it("returns no_action when fewer than 3 canaries", () => {
    expect(evaluateAutoPause({ ...baseStats, delivered: 0, total: 2 }, 80)).toEqual({
      action: "no_action",
    });
    expect(evaluateAutoPause({ ...baseStats, delivered: 2, total: 2 }, 80)).toEqual({
      action: "no_action",
    });
  });

  it("returns no_action at exactly threshold", () => {
    const result = evaluateAutoPause({ ...baseStats, delivered: 8, total: 10 }, 80);
    expect(result.action).toBe("no_action");
    expect(result.deliverabilityPct).toBe(80);
    expect(result.threshold).toBe(80);
  });

  it("returns pause when below threshold with enough samples", () => {
    const result = evaluateAutoPause({ ...baseStats, delivered: 2, total: 10 }, 80);
    expect(result).toEqual({
      action: "pause",
      reason: "canary_deliverability_below_threshold",
      deliverabilityPct: 20,
      threshold: 80,
    });
  });

  it("returns no_action when above threshold", () => {
    const result = evaluateAutoPause({ ...baseStats, delivered: 9, total: 10 }, 80);
    expect(result.action).toBe("no_action");
    expect(result.deliverabilityPct).toBe(90);
  });

  it("handles 100% delivery", () => {
    const result = evaluateAutoPause({ ...baseStats, delivered: 5, total: 5 }, 80);
    expect(result.action).toBe("no_action");
    expect(result.deliverabilityPct).toBe(100);
  });

  it("handles 0% delivery at minimum sample size", () => {
    const result = evaluateAutoPause({ ...baseStats, delivered: 0, total: 3 }, 80);
    expect(result.action).toBe("pause");
    expect(result.deliverabilityPct).toBe(0);
  });

  it("respects custom threshold", () => {
    const result = evaluateAutoPause({ ...baseStats, delivered: 4, total: 5 }, 90);
    expect(result.action).toBe("pause");
    expect(result.deliverabilityPct).toBe(80);
    expect(result.threshold).toBe(90);
  });
});
