import { addMinutes, addSeconds, differenceInSeconds } from "date-fns";
import { nextOpenSlot } from "./sending-window.ts";
import type {
  MailboxSchedule,
  ScheduleDeferral,
  ScheduledStep,
  SequenceStepSpec,
} from "./types.ts";

/**
 * Pure schedule math: given the sequence steps + mailbox schedule + a starting
 * anchor (usually the manual-first send time), compute every step's earliest
 * legal send time.
 *
 * This function is imported by BOTH the sequence-builder preview (Phase 5) and
 * the worker executor (Phase 6). Same fn, same answer — no drift.
 *
 * Guarantees:
 *   • strictly monotonic times across steps
 *   • per-mailbox `dailyCap` respected within a rolling 24h window
 *   • `minGapSeconds` respected between consecutive sends
 *   • sending window + business-days honored
 *
 * `manual_email` and `task` steps are placeholders — their `scheduledAt` is the
 * moment the user *may* act on them, not a send time. The engine transitions to
 * `waiting_manual` and holds until the human sends.
 */
export function computeSchedule(
  steps: readonly SequenceStepSpec[],
  mailbox: MailboxSchedule,
  anchor: Date,
): readonly ScheduledStep[] {
  const out: ScheduledStep[] = [];
  const sendHistory: Date[] = [];
  let cursor = anchor;

  for (const step of steps) {
    const rawAt = addMinutes(cursor, step.delayMinutes);
    const isSend = step.kind === "auto_email";

    if (!isSend) {
      out.push({ index: step.index, kind: step.kind, scheduledAt: rawAt, deferredBy: [] });
      cursor = rawAt;
      continue;
    }

    const [scheduledAt, deferrals] = deferForSendConstraints(rawAt, mailbox, step, sendHistory);
    sendHistory.push(scheduledAt);
    out.push({ index: step.index, kind: step.kind, scheduledAt, deferredBy: deferrals });
    cursor = scheduledAt;
  }
  return out;
}

function deferForSendConstraints(
  rawAt: Date,
  mailbox: MailboxSchedule,
  step: SequenceStepSpec,
  history: readonly Date[],
): [Date, ScheduleDeferral[]] {
  const deferrals: ScheduleDeferral[] = [];

  // 1. Window + business-day. This is the largest jump; do it first.
  let at = nextOpenSlot(rawAt, mailbox, step.businessDaysOnly);
  if (at.getTime() !== rawAt.getTime()) {
    deferrals.push({ kind: "outside_window", nextOpen: at });
  }

  // 2. Inter-send throttle relative to the last successful send.
  const last = history.at(-1);
  if (last) {
    const gap = differenceInSeconds(at, last);
    if (gap < mailbox.minGapSeconds) {
      at = addSeconds(last, mailbox.minGapSeconds);
      // Recheck window after bumping.
      const bumped = nextOpenSlot(at, mailbox, step.businessDaysOnly);
      if (bumped.getTime() !== at.getTime())
        deferrals.push({ kind: "outside_window", nextOpen: bumped });
      at = bumped;
      deferrals.push({ kind: "throttle", gapSeconds: mailbox.minGapSeconds });
    }
  }

  // 3. Daily cap over a rolling 24h window.
  const windowStart = new Date(at.getTime() - 24 * 60 * 60 * 1000);
  const usedInWindow = history.filter((h) => h > windowStart).length;
  if (usedInWindow >= mailbox.dailyCap) {
    const oldestInWindow = history.filter((h) => h > windowStart)[0];
    if (oldestInWindow) {
      const resetAt = new Date(oldestInWindow.getTime() + 24 * 60 * 60 * 1000);
      const bumped = nextOpenSlot(resetAt, mailbox, step.businessDaysOnly);
      deferrals.push({ kind: "daily_cap", resetAt });
      at = bumped;
    }
  }

  return [at, deferrals];
}
