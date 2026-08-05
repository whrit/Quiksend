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
  readonly variantB: (EmailStepConfig | TaskStepConfig) | null;
}

export function effectiveStepConfig(
  ctx: EnrollmentContext,
  step: StepContext,
): EmailStepConfig | TaskStepConfig | { minutes: number } {
  if (ctx.enrollment.abBucket === "B" && step.variantB) {
    return step.variantB;
  }
  return step.config;
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
    readonly emailGateway: import("@quiksend/mail/gateway-detect").EmailGateway | null;
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
  readonly deliverabilityPolicy: import("@quiksend/core/deliverability").DeliverabilityPolicy;
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
  const json = (sendWindow ?? {}) as SendWindowJson;
  const merged = {
    timezone: json.timezone ?? settings.timezone,
    window: json.window,
  };
  return computeSchedule(merged, { dailyCap: mailbox.dailyCap, throttleSeconds: mailbox.throttleSeconds });
}

export function toSnapshot(ctx: EnrollmentContext): EnrollmentSnapshot {
  return {
    id: ctx.enrollment.id,
    createdAt: ctx.enrollment.createdAt,
    organizationId: ctx.organizationId,
    prospectId: ctx.enrollment.prospectId,
    sequenceId: ctx.sequence.id,
    currentStepIndex: ctx.enrollment.currentStepIndex,
    status: ctx.enrollment.terminatedAt
      ? ("terminated" as const)
      : ctx.enrollment.pausedAt
        ? ("paused" as const)
        : ("active" as const),
    abBucket: ctx.enrollment.abBucket,
  };
}

export function computeNextRunAt(ctx: EnrollmentContext, stepIndex: number): Date | null {
  const step = ctx.steps.find((s) => s.stepIndex === stepIndex);
  if (!step) return null;
  
  if (step.stepType === "manual_email" || step.stepType === "manual_task") return null;

  const delayMs = step.delayMinutes * 60_000;
  const anchor = ctx.anchorMessage?.sentAt ?? ctx.enrollment.createdAt;
  
  const scheduled = new Date(anchor.getTime() + delayMs);
  const mailboxSchedule = toMailboxSchedule(ctx.sequence.settings, ctx.mailbox, ctx.settings);
  
  const allowed = mailboxSchedule.isAllowed(scheduled, step.businessDaysOnly);
  
  return allowed ? scheduled : mailboxSchedule.nextAllowed(scheduled, step.businessDaysOnly);
}

export function currentStep(ctx: EnrollmentContext): StepContext | null {
  return ctx.steps.find((s) => s.stepIndex === ctx.enrollment.currentStepIndex) ?? null;
}
