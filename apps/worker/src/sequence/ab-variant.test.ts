import { describe, expect, it } from "vitest";
import type { EnrollmentContext, StepContext } from "./context.ts";
import { effectiveStepConfig } from "./context.ts";

describe("effectiveStepConfig", () => {
  const mockConfigA = {
    subject: "Subject A",
    body_template: "Body A",
    ai_generate: false,
  };

  const mockConfigB = {
    subject: "Subject B",
    body_template: "Body B",
    ai_generate: false,
  };

  const createMockStep = (variantB: typeof mockConfigB | null = null): StepContext => ({
    id: "step-1",
    stepIndex: 0,
    stepType: "auto_email",
    delayMinutes: 0,
    businessDaysOnly: false,
    config: mockConfigA,
    variantB,
  });

  const createMockEnrollmentContext = (abBucket: "A" | "B"): Partial<EnrollmentContext> => ({
    enrollment: {
      id: "enrollment-1",
      abBucket,
    } as any,
  });

  it("returns config when abBucket is A", () => {
    const ctx = createMockEnrollmentContext("A") as EnrollmentContext;
    const step = createMockStep();

    const result = effectiveStepConfig(ctx, step);

    expect(result).toEqual(mockConfigA);
    expect(result.subject).toBe("Subject A");
  });

  it("returns variantB when abBucket is B and variantB exists", () => {
    const ctx = createMockEnrollmentContext("B") as EnrollmentContext;
    const step = createMockStep(mockConfigB);

    const result = effectiveStepConfig(ctx, step);

    expect(result).toEqual(mockConfigB);
    expect(result.subject).toBe("Subject B");
  });

  it("returns config as fallback when abBucket is B but variantB is null", () => {
    const ctx = createMockEnrollmentContext("B") as EnrollmentContext;
    const step = createMockStep(null);

    const result = effectiveStepConfig(ctx, step);

    expect(result).toEqual(mockConfigA);
    expect(result.subject).toBe("Subject A");
  });

  it("maintains config identity across multiple calls (retry stability)", () => {
    const ctx = createMockEnrollmentContext("B") as EnrollmentContext;
    const step = createMockStep(mockConfigB);

    const result1 = effectiveStepConfig(ctx, step);
    const result2 = effectiveStepConfig(ctx, step);

    expect(result1).toEqual(result2);
    expect(result1.subject).toBe(result2.subject);
    expect(result1.subject).toBe("Subject B");
  });
});
