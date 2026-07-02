import { describe, expect, it } from "vitest";
import { transition } from "./transition.ts";
import type { EnrollmentSnapshot } from "./types.ts";
import { TERMINAL_STATES, isTerminal } from "./types.ts";

const activeSnapshot = (overrides: Partial<EnrollmentSnapshot> = {}): EnrollmentSnapshot => ({
  state: "active",
  currentStepIndex: 0,
  hasNextStep: true,
  nextStepKind: "auto_email",
  anchorMessageId: null,
  attemptCount: 0,
  ...overrides,
});

describe("transition", () => {
  it("tick on an auto_email step emits a send_auto effect", () => {
    const result = transition(activeSnapshot(), { kind: "tick", at: new Date() });
    expect(result.nextState).toBe("active");
    expect(result.effects[0]?.kind).toBe("send_auto");
  });

  it("tick on a manual_email step parks in waiting_manual and creates a compose task", () => {
    const result = transition(activeSnapshot({ nextStepKind: "manual_email" }), {
      kind: "tick",
      at: new Date(),
    });
    expect(result.nextState).toBe("waiting_manual");
    expect(result.effects.map((e) => e.kind)).toEqual(["create_compose_task"]);
  });

  it("manual_sent captures the anchor and advances the step", () => {
    const snap = activeSnapshot({ state: "waiting_manual", nextStepKind: "manual_email" });
    const result = transition(snap, {
      kind: "manual_sent",
      anchorMessageId: "<abc@quiksend>",
      anchorThreadId: "thread-1",
      at: new Date(),
    });
    expect(result.nextState).toBe("active");
    const kinds = result.effects.map((e) => e.kind);
    expect(kinds).toContain("capture_anchor");
    expect(kinds).toContain("advance_step");
  });

  it("manual_sent outside waiting_manual is idempotent (no-op)", () => {
    const result = transition(activeSnapshot(), {
      kind: "manual_sent",
      anchorMessageId: "<abc@quiksend>",
      anchorThreadId: "thread-1",
      at: new Date(),
    });
    expect(result.nextState).toBe("active");
    expect(result.effects).toEqual([]);
  });

  it("auto_sent on the last step transitions to completed", () => {
    const snap = activeSnapshot({ hasNextStep: false });
    const result = transition(snap, {
      kind: "auto_sent",
      providerMessageId: "provider-1",
      at: new Date(),
    });
    expect(result.nextState).toBe("completed");
    expect(result.effects.some((e) => e.kind === "terminate")).toBe(true);
  });

  it("reply_received with stopOnReply terminates as replied", () => {
    const result = transition(activeSnapshot(), {
      kind: "reply_received",
      at: new Date(),
      stopOnReply: true,
    });
    expect(result.nextState).toBe("replied");
    expect(isTerminal(result.nextState)).toBe(true);
  });

  it("reply_received with stopOnReply=false is a no-op", () => {
    const result = transition(activeSnapshot(), {
      kind: "reply_received",
      at: new Date(),
      stopOnReply: false,
    });
    expect(result.nextState).toBe("active");
    expect(result.effects).toEqual([]);
  });

  it("hard bounce terminates; soft bounce does not", () => {
    const hard = transition(activeSnapshot(), {
      kind: "bounce_received",
      bounceType: "hard",
      at: new Date(),
    });
    expect(hard.nextState).toBe("bounced");

    const soft = transition(activeSnapshot(), {
      kind: "bounce_received",
      bounceType: "soft",
      at: new Date(),
    });
    expect(soft.nextState).toBe("active");
    expect(soft.effects).toEqual([]);
  });

  it("step_failed increments attempt until max, then terminates as failed", () => {
    const first = transition(activeSnapshot({ attemptCount: 0 }), {
      kind: "step_failed",
      error: "boom",
      at: new Date(),
      maxAttempts: 3,
    });
    expect(first.nextState).toBe("active");
    expect(first.effects[0]?.kind).toBe("increment_attempt");

    const terminal = transition(activeSnapshot({ attemptCount: 2 }), {
      kind: "step_failed",
      error: "boom",
      at: new Date(),
      maxAttempts: 3,
    });
    expect(terminal.nextState).toBe("failed");
  });

  it("pause and resume round-trip cleanly", () => {
    const paused = transition(activeSnapshot(), { kind: "pause" });
    expect(paused.nextState).toBe("paused");

    const resumed = transition(activeSnapshot({ state: "paused" }), { kind: "resume" });
    expect(resumed.nextState).toBe("active");
  });

  it("terminal states absorb every event except resume (from paused)", () => {
    for (const state of TERMINAL_STATES) {
      const result = transition(activeSnapshot({ state }), { kind: "tick", at: new Date() });
      expect(result.nextState).toBe(state);
      expect(result.effects).toEqual([]);
    }
  });

  it("tick on wait step just advances", () => {
    const result = transition(activeSnapshot({ nextStepKind: "wait" }), {
      kind: "tick",
      at: new Date(),
    });
    expect(result.effects).toEqual([{ kind: "advance_step" }]);
  });

  it("stop from any non-terminal state terminates", () => {
    for (const state of ["active", "waiting", "waiting_manual", "paused"] as const) {
      const result = transition(activeSnapshot({ state }), { kind: "stop" });
      expect(result.nextState).toBe("stopped");
      expect(result.effects.some((e) => e.kind === "terminate")).toBe(true);
    }
  });
});
