import { computeSchedule } from "@quiksend/core/schedule";
import type { MailboxSchedule, SendingWindow, StepKind, Weekday } from "@quiksend/core/schedule";
import type { EnrollmentSnapshot } from "@quiksend/core/state-machine";
import type { tables } from "@quiksend/db";

export type SequenceSettings = {
  timezone: string;
  throttle_seconds: number;
  mailbox_ids: string[];
  stop_on_reply: boolean;
  business_days_only: boolean;
};

export type EmailStepConfig = {
  subject: string;
  body_template: string;
  ai_generate: boolean;
};

export type TaskStepConfig = {
  title: string;
  instructions: string;
};

export interface StepContext {
  readonly id: string;
  readonly stepIndex: number;
  readonly stepType: StepKind;
  readonly delayMinutes: number;
  readonly businessDaysOnly: boolean;
  readonly config: EmailStepConfig | TaskStepConfig | { minutes: number };
}

export interface EnrollmentContext {
  readonly enrollmentId: string;
  readonly organizationId: string;
  readonly enrollment: typeof tables.enrollment.$inferSelect;
  readonly sequence: typeof tables.sequence.$inferSelect;
  readonly settings: SequenceSettings;
  readonly steps: readonly StepContext[];
  readonly mailbox: typeof tables.mailbox.$inferSelect;
  readonly prospect: {
    readonly id: string;
    readonly email: string;
    readonly firstName: string | null;
    readonly lastName: string | null;
    readonly title: string | null;
    readonly status: string;
  };
  readonly company: {
    readonly name: string | null;
    readonly domain: string | null;
  } | null;
  readonly anchorMessage: {
    readonly id: string;
    readonly messageIdHeader: string;
    readonly subject: string | null;
    readonly providerThreadId: string | null;
    readonly sentAt: Date;
    readonly referencesHeader: string | null;
  } | null;
  readonly priorOutbound: readonly {
    readonly messageIdHeader: string | null;
    readonly sentAt: Date | null;
  }[];
  readonly stopOnReply: boolean;
  readonly senderFirstName: string | null;
  readonly senderSignature: string | null;
}

type SendWindowJson = {
  timezone?: string;
  window: Record<string, [number, number][]>;
};

export function toMailboxSchedule(
  sendWindow: unknown,
  mailbox: { dailyCap: number; throttleSeconds: number },
  settings: SequenceSettings,
): MailboxSchedule {
  const sw = (sendWindow ?? { window: {} }) as SendWindowJson;
  const window: SendingWindow = {};
  for (const [day, ranges] of Object.entries(sw.window ?? {})) {
    window[day as Weekday] = ranges.map(([start, end]) => ({
      startHour: start,
      endHour: end,
    }));
  }
  return {
    timezone: settings.timezone || sw.timezone || "UTC",
    window,
    dailyCap: mailbox.dailyCap,
    minGapSeconds: settings.throttle_seconds ?? mailbox.throttleSeconds,
  };
}

export function toSnapshot(ctx: EnrollmentContext): EnrollmentSnapshot {
  const nextStep = ctx.steps.find((s) => s.stepIndex === ctx.enrollment.currentStepIndex);
  const hasNext = ctx.steps.some((s) => s.stepIndex > ctx.enrollment.currentStepIndex);
  return {
    state: ctx.enrollment.state as EnrollmentSnapshot["state"],
    currentStepIndex: ctx.enrollment.currentStepIndex,
    hasNextStep: hasNext,
    nextStepKind: nextStep?.stepType ?? null,
    anchorMessageId: ctx.enrollment.anchorMessageId,
    attemptCount: ctx.enrollment.attemptCount,
  };
}

export function computeNextRunAt(ctx: EnrollmentContext, stepIndex: number): Date | null {
  if (ctx.steps.length === 0) return null;
  const anchor = ctx.anchorMessage?.sentAt ?? ctx.enrollment.createdAt;
  const specs = ctx.steps.map((s) => ({
    index: s.stepIndex,
    kind: s.stepType,
    delayMinutes: s.delayMinutes,
    businessDaysOnly: s.businessDaysOnly && ctx.settings.business_days_only,
  }));
  if (process.env.QUIKSEND_ENGINE_FAKE_MAIL === "1") {
    const step = specs.find((s) => s.index === stepIndex);
    return new Date(anchor.getTime() + (step?.delayMinutes ?? 0) * 60_000);
  }
  const schedule = computeSchedule(
    specs,
    toMailboxSchedule(ctx.mailbox.sendWindow, ctx.mailbox, ctx.settings),
    anchor,
  );
  const entry = schedule.find((s) => s.index === stepIndex);
  return entry?.scheduledAt ?? null;
}

export function currentStep(ctx: EnrollmentContext): StepContext | null {
  return ctx.steps.find((s) => s.stepIndex === ctx.enrollment.currentStepIndex) ?? null;
}
