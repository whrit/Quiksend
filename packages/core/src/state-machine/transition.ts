import type { EnrollmentSnapshot, Event, TransitionResult, Effect } from "./types.ts";
import { isTerminal } from "./types.ts";

/**
 * Pure state-machine transition. `snapshot` is what the DB row looks like right
 * now; `event` is what just happened; the return value tells the worker what to
 * do about it. NEVER performs I/O.
 *
 * Invariants:
 *   • terminal states absorb everything except `resume`, which resurrects from
 *     `paused` only. Terminal → non-terminal is impossible.
 *   • `manual_sent` is only meaningful in `waiting_manual`. Elsewhere it is a
 *     no-op (double-delivery of the same event on retry MUST be safe).
 *   • `tick` in `active` decides based on the CURRENT step's kind, which the
 *     snapshot carries as `nextStepKind` (the step at `currentStepIndex`).
 */
export function transition(snapshot: EnrollmentSnapshot, event: Event): TransitionResult {
  if (isTerminal(snapshot.state)) return handleTerminal(snapshot, event);

  switch (event.kind) {
    case "pause":
      if (snapshot.state === "paused") return same(snapshot);
      return { nextState: "paused", effects: [{ kind: "emit_event", type: "enrollment.paused" }] };

    case "resume":
      if (snapshot.state !== "paused") return same(snapshot);
      return { nextState: "active", effects: [{ kind: "emit_event", type: "enrollment.resumed" }] };

    case "stop":
      return {
        nextState: "stopped",
        effects: [
          { kind: "terminate", reason: "stopped" },
          { kind: "emit_event", type: "enrollment.stopped" },
        ],
      };

    case "reply_received":
      if (!event.stopOnReply) return same(snapshot);
      return {
        nextState: "replied",
        effects: [
          { kind: "terminate", reason: "replied" },
          { kind: "emit_event", type: "enrollment.replied" },
        ],
      };

    case "bounce_received":
      if (event.bounceType === "soft") return same(snapshot);
      return {
        nextState: "bounced",
        effects: [
          { kind: "terminate", reason: "bounced" },
          { kind: "emit_event", type: "enrollment.bounced" },
        ],
      };

    case "suppressed":
      return {
        nextState: "stopped",
        effects: [
          { kind: "terminate", reason: "stopped" },
          { kind: "emit_event", type: "enrollment.stopped" },
        ],
      };

    case "step_failed": {
      const nextAttempt = snapshot.attemptCount + 1;
      if (nextAttempt >= event.maxAttempts) {
        return {
          nextState: "failed",
          effects: [
            { kind: "terminate", reason: "failed" },
            { kind: "emit_event", type: "enrollment.failed" },
          ],
        };
      }
      const effects: Effect[] = [{ kind: "increment_attempt" }];
      if (event.retryAt) {
        effects.push({ kind: "schedule_at", at: event.retryAt });
      }
      return { nextState: snapshot.state, effects };
    }

    case "manual_sent":
      if (snapshot.state !== "waiting_manual") return same(snapshot);
      return {
        nextState: "active",
        effects: [
          {
            kind: "capture_anchor",
            messageId: event.anchorMessageId,
            threadId: event.anchorThreadId,
          },
          { kind: "advance_step" },
          { kind: "emit_event", type: "message.sent" },
        ],
      };

    case "auto_sent":
      return {
        nextState: snapshot.hasNextStep ? "active" : "completed",
        effects: snapshot.hasNextStep
          ? [{ kind: "advance_step" }, { kind: "emit_event", type: "message.sent" }]
          : [
              { kind: "emit_event", type: "message.sent" },
              { kind: "terminate", reason: "completed" },
              { kind: "emit_event", type: "enrollment.completed" },
            ],
      };

    case "tick":
      return handleTick(snapshot);
  }
}

function handleTick(snapshot: EnrollmentSnapshot): TransitionResult {
  if (snapshot.state === "paused") return same(snapshot);
  if (snapshot.state === "waiting_manual") return same(snapshot);

  if (!snapshot.hasNextStep) {
    return {
      nextState: "completed",
      effects: [
        { kind: "terminate", reason: "completed" },
        { kind: "emit_event", type: "enrollment.completed" },
      ],
    };
  }

  switch (snapshot.nextStepKind) {
    case "manual_email":
      return {
        nextState: "waiting_manual",
        effects: [{ kind: "create_compose_task", stepIndex: snapshot.currentStepIndex }],
      };
    case "task":
      return {
        nextState: "waiting",
        effects: [{ kind: "create_task", stepIndex: snapshot.currentStepIndex }],
      };
    case "auto_email":
      return {
        nextState: "active",
        effects: [{ kind: "send_auto", stepIndex: snapshot.currentStepIndex }],
      };
    case "wait":
      // A wait step is a delay only — advance without acting.
      return { nextState: "active", effects: [{ kind: "advance_step" }] };
    case null:
      return same(snapshot);
  }
}

function handleTerminal(snapshot: EnrollmentSnapshot, event: Event): TransitionResult {
  if (event.kind === "resume" && snapshot.state === "paused") {
    return { nextState: "active", effects: [{ kind: "emit_event", type: "enrollment.resumed" }] };
  }
  return same(snapshot);
}

function same(snapshot: EnrollmentSnapshot): TransitionResult {
  return { nextState: snapshot.state, effects: [] };
}
