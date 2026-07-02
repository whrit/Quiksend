/**
 * Enrollment state machine — pure data. The `transition(state, event)` function
 * (transition.ts) is the ONLY place a state change is decided. The worker
 * interprets the resulting `effects[]`; it never mutates state directly.
 *
 * States are drawn from Phases-2-10.md §Phase 6 verbatim.
 */
export type EnrollmentState =
  | "active"
  | "waiting"
  | "waiting_manual"
  | "paused"
  | "stopped"
  | "completed"
  | "replied"
  | "bounced"
  | "failed";

export type TerminalState = "stopped" | "completed" | "replied" | "bounced" | "failed";

export const TERMINAL_STATES: readonly TerminalState[] = [
  "stopped",
  "completed",
  "replied",
  "bounced",
  "failed",
] as const;

export function isTerminal(state: EnrollmentState): state is TerminalState {
  return (TERMINAL_STATES as readonly EnrollmentState[]).includes(state);
}

export type StepKind = "manual_email" | "auto_email" | "wait" | "task";

/** Minimal shape the state machine needs — hydrated from `enrollment` + `sequence_step`. */
export interface EnrollmentSnapshot {
  readonly state: EnrollmentState;
  readonly currentStepIndex: number;
  readonly hasNextStep: boolean;
  readonly nextStepKind: StepKind | null;
  readonly anchorMessageId: string | null;
  readonly attemptCount: number;
}

export type Event =
  | { readonly kind: "tick"; readonly at: Date }
  | {
      readonly kind: "manual_sent";
      readonly anchorMessageId: string;
      readonly anchorThreadId: string;
      readonly at: Date;
    }
  | { readonly kind: "auto_sent"; readonly providerMessageId: string; readonly at: Date }
  | { readonly kind: "reply_received"; readonly at: Date; readonly stopOnReply: boolean }
  | { readonly kind: "bounce_received"; readonly bounceType: "hard" | "soft"; readonly at: Date }
  | { readonly kind: "suppressed"; readonly at: Date }
  | {
      readonly kind: "step_failed";
      readonly error: string;
      readonly at: Date;
      readonly maxAttempts: number;
      readonly retryAt?: Date;
    }
  | { readonly kind: "pause" }
  | { readonly kind: "resume" }
  | { readonly kind: "stop"; readonly reason?: string };

export type Effect =
  | { readonly kind: "schedule_at"; readonly at: Date }
  | { readonly kind: "create_compose_task"; readonly stepIndex: number }
  | { readonly kind: "create_task"; readonly stepIndex: number }
  | { readonly kind: "send_auto"; readonly stepIndex: number }
  | { readonly kind: "advance_step" }
  | { readonly kind: "capture_anchor"; readonly messageId: string; readonly threadId: string }
  | { readonly kind: "emit_event"; readonly type: string }
  | { readonly kind: "terminate"; readonly reason: TerminalState }
  | { readonly kind: "increment_attempt" };

export interface TransitionResult {
  readonly nextState: EnrollmentState;
  readonly effects: readonly Effect[];
}
