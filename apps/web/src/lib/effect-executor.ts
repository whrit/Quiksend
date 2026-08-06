import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";
import { logger } from "@quiksend/config";
import { computeSchedule } from "@quiksend/core/schedule";
import type { MailboxSchedule, SendingWindow, StepKind, Weekday } from "@quiksend/core/schedule";
import type { Effect, EnrollmentState } from "@quiksend/core/state-machine";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import type * as schema from "@quiksend/db/schema";
import { enqueue } from "@quiksend/queue";
import { and, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { fanoutWebhookEvent } from "./api/v1/helpers.ts";

export type DrizzleTransaction = PostgresJsDatabase<typeof schema>;

const WORKER_ONLY_EFFECTS = new Set([
  "send_auto",
  "create_compose_task",
  "create_task",
  "increment_attempt",
]);

/**
 * Engine events we materialize as analytics rows. Keep aligned with
 * `apps/worker/src/sequence/execute-effects.ts`.
 */
const TRACKED_ENGINE_EVENTS = new Set([
  "message.sent",
  "enrollment.completed",
  "enrollment.replied",
  "enrollment.bounced",
  "enrollment.paused",
  "enrollment.resumed",
  "enrollment.stopped",
  "enrollment.failed",
  "task.completed",
  "task.skipped",
]);

const DELIVERABILITY_EVENTS = new Set([
  "deliverability.delivered_at_risk",
  "deliverability.mailbox_auto_swapped",
  "deliverability.anchor_threading_preserved",
  "enrollment.no_safe_mailbox_for_gateway",
  "mailbox.enterprise_safe_toggled",
  "workspace.deliverability_policy_changed",
]);

const WEBHOOK_FANOUT_EVENTS = new Set([
  "message.sent",
  "enrollment.completed",
  "enrollment.replied",
  "enrollment.bounced",
  "enrollment.paused",
  "enrollment.resumed",
  "enrollment.stopped",
  "enrollment.failed",
  "enrollment.no_safe_mailbox_for_gateway",
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

function normalizeAnalyticsType(engineType: string): string {
  if (engineType === "enrollment.replied") return "reply.received";
  if (engineType === "enrollment.bounced") return "bounce.received";
  return engineType;
}

function writebackJobEventType(engineType: string): "send" | "reply" | "status" | null {
  if (engineType === "message.sent") return "send";
  if (
    engineType === "enrollment.replied" ||
    engineType === "enrollment.bounced" ||
    engineType === "enrollment.completed"
  ) {
    return "status";
  }
  return null;
}

function makeWritebackIdempotencyKey(
  organizationId: string,
  engineType: string,
  entityType: string,
  entityId: string,
): string {
  const raw = `${organizationId}:${engineType}:${entityType}:${entityId}`;
  return createHash("sha256").update(raw).digest("hex");
}

async function resolveEntityId(
  tx: DrizzleTransaction,
  organizationId: string,
  engineType: string,
  enrollmentId: string,
): Promise<{ entityType: "message" | "enrollment"; entityId: string }> {
  if (engineType === "message.sent") {
    const latest = await tx.query.message.findFirst({
      where: and(
        eq(tables.message.enrollmentId, enrollmentId),
        eq(tables.message.organizationId, organizationId),
        eq(tables.message.direction, "outbound"),
      ),
      orderBy: [desc(tables.message.sentAt)],
    });
    if (latest) return { entityType: "message", entityId: latest.id };
  }
  return { entityType: "enrollment", entityId: enrollmentId };
}

async function findActiveCrmConnection(organizationId: string) {
  return db.query.crmConnection.findFirst({
    where: and(
      eq(tables.crmConnection.organizationId, organizationId),
      eq(tables.crmConnection.status, "active"),
    ),
  });
}

async function insertWritebackLog(
  dbOrTx: DrizzleTransaction,
  organizationId: string,
  connectionId: string,
  engineType: string,
  entityType: string,
  entityId: string,
  jobEventType: "send" | "reply" | "status",
): Promise<string | null> {
  const idempotencyKey = makeWritebackIdempotencyKey(
    organizationId,
    engineType,
    entityType,
    entityId,
  );

  const writebackEventType =
    jobEventType === "status" ? ("status_update" as const) : ("activity_log" as const);

  await dbOrTx
    .insert(tables.crmWritebackLog)
    .values({
      organizationId,
      crmConnectionId: connectionId,
      eventType: writebackEventType,
      entityType,
      entityId,
      idempotencyKey,
      status: "pending",
      payload: { engineType, jobEventType },
    })
    .onConflictDoNothing({ target: tables.crmWritebackLog.idempotencyKey });

  return idempotencyKey;
}

async function scheduleWriteback(
  dbOrTx: DrizzleTransaction,
  organizationId: string,
  engineType: string,
  entityType: string,
  entityId: string,
  jobEventType: "send" | "reply" | "status",
): Promise<void> {
  const connection = await findActiveCrmConnection(organizationId);
  if (!connection) return;

  const idempotencyKey = await insertWritebackLog(
    dbOrTx,
    organizationId,
    connection.id,
    engineType,
    entityType,
    entityId,
    jobEventType,
  );
  if (!idempotencyKey) return;

  await enqueue("crm.writeback", {
    connectionId: connection.id,
    eventType: jobEventType,
    entityId,
    idempotencyKey,
    organizationId,
  });
}

/**
 * Web-side mirror of the worker's `handleEmitEvent` in
 * `apps/worker/src/sequence/execute-effects.ts`.
 */
async function handleWebEmitEvent(
  tx: DrizzleTransaction,
  enrollmentId: string,
  organizationId: string,
  engineType: string,
  emitContext?: WebEffectEmitContext,
): Promise<void> {
  logger.info(
    {
      organizationId,
      enrollmentId,
      event: engineType,
    },
    "enrollment event",
  );

  if (!TRACKED_ENGINE_EVENTS.has(engineType) && !DELIVERABILITY_EVENTS.has(engineType)) return;

  const enrollment = await tx.query.enrollment.findFirst({
    where: enrollmentWhere(enrollmentId, organizationId),
    with: {
      prospect: true,
      mailbox: true,
    },
  });
  if (!enrollment) throw new Error("Enrollment not found");

  const sequenceId = emitContext?.sequenceId ?? enrollment.sequenceId;
  const prospectId = emitContext?.prospectId ?? enrollment.prospectId;

  const { entityType, entityId } = await resolveEntityId(
    tx,
    organizationId,
    engineType,
    enrollmentId,
  );
  const analyticsType = normalizeAnalyticsType(engineType);

  const eventPayload = {
    enrollmentId,
    prospectId,
    sequenceId,
    engineType,
  };

  await tx.insert(tables.event).values({
    organizationId,
    type: analyticsType,
    entityType,
    entityId,
    payload: eventPayload,
  });

  if (WEBHOOK_FANOUT_EVENTS.has(engineType)) {
    const payload: Record<string, unknown> = {
      enrollmentId,
      prospectId,
      sequenceId,
      mailboxId: enrollment.mailboxId,
      recipientGateway: enrollment.prospect?.emailGateway,
    };
    if (engineType === "enrollment.no_safe_mailbox_for_gateway") {
      payload.reason = "no_safe_mailbox_for_gateway";
    }
    await fanoutWebhookEvent({
      organizationId,
      eventType: engineType,
      payload,
    });
  }

  const jobEventType = writebackJobEventType(engineType);
  if (!jobEventType) return;

  await scheduleWriteback(tx, organizationId, engineType, entityType, entityId, jobEventType);
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
        await handleWebEmitEvent(
          tx,
          enrollmentId,
          organizationId,
          effect.type,
          options.emitContext,
        );
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
