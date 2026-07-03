import { describe, expect, it } from "vitest";
import { pickInjectionPositions } from "./canary-config.ts";

describe("pickInjectionPositions", () => {
  const steps = [0, 1, 2, 3, 4];

  it("random_position returns requested count from step pool", () => {
    const positions = pickInjectionPositions(steps, 3, "random_position");
    expect(positions).toHaveLength(3);
    for (const pos of positions) {
      expect(steps).toContain(pos);
    }
  });

  it("first_then_last alternates first and last step indices", () => {
    const positions = pickInjectionPositions(steps, 4, "first_then_last");
    expect(positions).toEqual([0, 4, 0, 4]);
  });

  it("every_nth picks indices at N intervals starting at 0", () => {
    const positions = pickInjectionPositions(steps, 3, "every_nth", 2);
    expect(positions).toEqual([0, 2, 4]);
  });

  it("every_nth falls back when pool is empty", () => {
    const positions = pickInjectionPositions([], 2, "every_nth", 2);
    expect(positions).toEqual([]);
  });
});
