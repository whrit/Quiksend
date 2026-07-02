export type EntryCondition = { kind: "if_no_reply" };

export interface EnrollmentContextForCondition {
  hasReplyOnThread: boolean;
  hasBounceOnThread: boolean;
  currentStepIndex: number;
  lastReplyAt: Date | null;
}

export function evaluateEntryCondition(
  condition: EntryCondition | null,
  ctx: EnrollmentContextForCondition,
): { proceed: boolean; skipReason?: string } {
  if (!condition) return { proceed: true };

  switch (condition.kind) {
    case "if_no_reply": {
      if (ctx.hasReplyOnThread) {
        return { proceed: false, skipReason: "if_no_reply: thread has a reply" };
      }
      return { proceed: true };
    }
    default: {
      return { proceed: true };
    }
  }
}
