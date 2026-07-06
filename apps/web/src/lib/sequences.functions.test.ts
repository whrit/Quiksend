import { describe, expect, it } from "vitest";
import { assertFirstStepIsNotAutoEmail } from "./sequences.functions.ts";

describe("assertFirstStepIsNotAutoEmail", () => {
  it("throws when step 0 is auto_email", () => {
    expect(() => assertFirstStepIsNotAutoEmail([{ stepType: "auto_email" }])).toThrowError(
      /first step cannot be auto_email/i,
    );
  });

  it("passes when step 0 is manual_email", () => {
    expect(() =>
      assertFirstStepIsNotAutoEmail([{ stepType: "manual_email" }, { stepType: "auto_email" }]),
    ).not.toThrow();
  });

  it("passes when step 0 is a wait step", () => {
    expect(() =>
      assertFirstStepIsNotAutoEmail([{ stepType: "wait" }, { stepType: "auto_email" }]),
    ).not.toThrow();
  });

  it("passes on empty steps (length check runs separately)", () => {
    expect(() => assertFirstStepIsNotAutoEmail([])).not.toThrow();
  });
});
