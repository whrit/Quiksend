import { computeSchedule } from "@quiksend/core/schedule";
import type { MailboxSchedule, SendingWindow, StepKind, Weekday } from "@quiksend/core/schedule";
import type { Effect, EnrollmentState } from "@quiksend/core/state-machine";
import { tables } from "@quiksend/db";
import type * as schema from "@quiksend/db/schema";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export type DrizzleTransaction = PostgresJsDatabase<typeof schema>;

const WORKER_ONLY_EFFECTS = new Set([
  "send_auto",
  "create_compose_task",
  "create_task",
  "increment_attempt",
]);

export class WebOnlyEffectError extends Error {
  readonly effectKind: string;
  constructor(effectKind: string) {
    super(`Effect '${effectKind}' cannot be applied in the web app`);
    this.name = "WebOnlyEffectError";
    this.effectKind = effectKind;
  }
}

type SequenceSettings = {
  timezone: string;
  throttle_seconds: number;
  mailbox_ids: string[];
  stop_on_reply: boolean;
  business_days_only: boolean;
};

export interface WebEffectAdvanceContext {
  readonly steps: {
    stepIndex: number;
    stepType: string;
    delayMinutes: number;
    businessDaysOnly: boolean;
  }[];
  readonly settings: SequenceSettings;
  readonly mailbox: typeof tables.mailbox.$inferSelect;
  readonly anchor: Date;
}

export interface WebEffectEmitContext {
  readonly sequenceId?: string;
  readonly prospectId?: string;
}

export interface ApplyWebEffectsOptions {
  readonly nextState?: EnrollmentState;
  readonly advanceContext?: WebEffectAdvanceContext;
  readonly emitContext?: WebEffectEmitContext;
}

function toMailboxSchedule(
  sendWindow: unknown,
  mailbox: { dailyCap: number; throttleSeconds: number },
  settings: SequenceSettings,
): MailboxSchedule {
  const sw = (sendWindow ?? { window: {} }) as {
    timezone?: string;
    window: Record<string, [number, number][]>;
  };
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

function computeNextRunAtForStep(
  steps: WebEffectAdvanceContext["steps"],
  settings: SequenceSettings,
  mailbox: typeof tables.mailbox.$inferSelect,
  stepIndex: number,
  anchor: Date,
): Date | null {
  const specs = steps.map((s) => ({
    index: s.stepIndex,
    kind: s.stepType as StepKind,
    delayMinutes: s.delayMinutes,
    businessDaysOnly: s.businessDaysOnly && settings.business_days_only,
  }));
  const schedule = computeSchedule(
    specs,
    toMailboxSchedule(mailbox.sendWindow, mailbox, settings),
    anchor,
  );
  return schedule.find((s) => s.index === stepIndex)?.scheduledAt ?? null;
}

function enrollmentWhere(enrollmentId: string, organizationId: string) {
  return and(
    eq(tables.enrollment.id, enrollmentId),
    eq(tables.enrollment.organizationId, organizationId),
  );
}

/**
 * Web-side interpreter for state-machine `Effect[]`. Mirrors the worker's
 * `applyTransitionEffects` for effects the web app can emit (manual compose,
 * pause/resume/stop). Worker-only effects throw `WebOnlyEffectError`.
 */
export async function applyWebEffects(
  tx: DrizzleTransaction,
  enrollmentId: string,
  organizationId: string,
  effects: readonly Effect[],
  options: ApplyWebEffectsOptions = {},
): Promise<void> {
  for (const effect of effects) {
    if (WORKER_ONLY_EFFECTS.has(effect.kind)) {
      throw new WebOnlyEffectError(effect.kind);
    }

    switch (effect.kind) {
      case "capture_anchor":
        await tx
          .update(tables.enrollment)
          .set({
            anchorMessageId: effect.messageId,
            anchorThreadId: effect.threadId,
          })
          .where(enrollmentWhere(enrollmentId, organizationId));
        break;

      case "advance_step": {
        const row = await tx.query.enrollment.findFirst({
          where: enrollmentWhere(enrollmentId, organizationId),
        });
        if (!row) throw new Error("Enrollment not found");

        const nextIndex = row.currentStepIndex + 1;
        const updates: {
          currentStepIndex: number;
          attemptCount: number;
          lastError: null;
          nextRunAt?: Date | null;
        } = {
          currentStepIndex: nextIndex,
          attemptCount: 0,
          lastError: null,
        };

        if (options.advanceContext) {
          updates.nextRunAt = computeNextRunAtForStep(
            options.advanceContext.steps,
            options.advanceContext.settings,
            options.advanceContext.mailbox,
            nextIndex,
            options.advanceContext.anchor,
          );
        }

        await tx
          .update(tables.enrollment)
          .set(updates)
          .where(enrollmentWhere(enrollmentId, organizationId));
        break;
      }

      case "schedule_at":
        await tx
          .update(tables.enrollment)
          .set({ nextRunAt: effect.at })
          .where(enrollmentWhere(enrollmentId, organizationId));
        break;

      case "emit_event":
        await tx.insert(tables.event).values({
          organizationId,
          type: effect.type,
          entityType: "enrollment",
          entityId: enrollmentId,
          payload: {
            enrollmentId,
            sequenceId: options.emitContext?.sequenceId,
            prospectId: options.emitContext?.prospectId,
            engineType: effect.type,
          },
        });
        break;

      case "terminate":
        await tx
          .update(tables.enrollment)
          .set({
            state: effect.reason,
            nextRunAt: null,
          })
          .where(enrollmentWhere(enrollmentId, organizationId));
        break;
    }
  }

  if (options.nextState !== undefined) {
    const row = await tx.query.enrollment.findFirst({
      where: enrollmentWhere(enrollmentId, organizationId),
      columns: { state: true },
    });
    if (row && row.state !== options.nextState) {
      await tx
        .update(tables.enrollment)
        .set({ state: options.nextState })
        .where(enrollmentWhere(enrollmentId, organizationId));
    }
  }
}
