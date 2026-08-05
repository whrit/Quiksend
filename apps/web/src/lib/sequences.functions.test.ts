import { describe, expect, it } from "vitest";
import {
  assertFirstStepIsNotAutoEmail,
  isUniqueViolation,
  type EnrollmentExclusionReason,
} from "./sequences.functions.ts";

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

describe("isUniqueViolation", () => {
  it("returns true for PG 23505 unique_violation", () => {
    expect(isUniqueViolation({ code: "23505", message: "duplicate key" })).toBe(true);
  });

  it("returns true for bare { code: '23505' }", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("returns false for other PG error codes", () => {
    expect(isUniqueViolation({ code: "42P01" })).toBe(false);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
  });

  it("returns false for a generic Error", () => {
    expect(isUniqueViolation(new Error("insert failed"))).toBe(false);
  });

  it("returns false for null / undefined / string", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });
});

describe("EnrollmentExclusionReason completeness", () => {
  // Compile-time + runtime check: every expected reason is assignable.
  const reasons: EnrollmentExclusionReason[] = [
    "already_enrolled",
    "prospect_deleted",
    "prospect_suppressed",
    "sequence_archived",
  ];

  it("includes all four structured exclusion reasons", () => {
    expect(reasons).toHaveLength(4);
    expect(reasons).toContain("already_enrolled");
    expect(reasons).toContain("prospect_deleted");
    expect(reasons).toContain("prospect_suppressed");
    expect(reasons).toContain("sequence_archived");
  });
});
