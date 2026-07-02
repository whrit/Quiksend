import { computeSchedule } from "@quiksend/core/schedule";
import type { MailboxSchedule, SendingWindow, StepKind, Weekday } from "@quiksend/core/schedule";
import {
  transition,
  type EnrollmentSnapshot,
  type EnrollmentState,
} from "@quiksend/core/state-machine";
import { db, tables } from "@quiksend/db";
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { orgFn } from "./org-fn.ts";
import { applyWebEffects } from "./effect-executor.ts";
import { validateTemplate } from "./sequence-templates.ts";

class SequenceError extends Error {
  readonly code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "CONFLICT" | "INVALID_STATE";
  constructor(code: SequenceError["code"], message: string) {
    super(message);
    this.name = "SequenceError";
    this.code = code;
  }
}

export type SequenceSettings = {
  timezone: string;
  throttle_seconds: number;
  mailbox_ids: string[];
  stop_on_reply: boolean;
  business_days_only: boolean;
};

type SequenceRow = typeof tables.sequence.$inferSelect;
type SequenceStepRow = typeof tables.sequenceStep.$inferSelect;
type EnrollmentRow = typeof tables.enrollment.$inferSelect;

export type EmailStepConfig = {
  subject: string;
  body_template: string;
  ai_generate: boolean;
};

export type WaitStepConfig = { minutes: number };

export type TaskStepConfig = { title: string; instructions: string };

export type StepConfig = EmailStepConfig | WaitStepConfig | TaskStepConfig;

export type EntryCondition = {
  kind?: "if_no_reply";
  recipientGatewayIn?: string[];
  recipientGatewayNotIn?: string[];
};

const sequenceSettingsSchema = z.object({
  timezone: z.string().min(1).max(100),
  throttle_seconds: z.number().int().min(0).max(86400),
  mailbox_ids: z.array(z.string().uuid()),
  stop_on_reply: z.boolean(),
  business_days_only: z.boolean(),
});

const emailConfigSchema = z.object({
  subject: z.string().max(500),
  body_template: z.string().max(50000),
  ai_generate: z.boolean(),
});

const waitConfigSchema = z.object({
  minutes: z.number().int().min(0).max(525600),
});

const taskConfigSchema = z.object({
  title: z.string().max(500),
  instructions: z.string().max(10000),
});

const entryConditionSchema = z
  .object({
    kind: z.literal("if_no_reply").optional(),
    recipientGatewayIn: z.array(z.string()).optional(),
    recipientGatewayNotIn: z.array(z.string()).optional(),
  })
  .strict();

const stepInputBase = z.object({
  id: z.string().uuid().optional(),
  index: z.number().int().min(0),
  delayMinutes: z.number().int().min(0).max(525600).default(0),
  businessDaysOnly: z.boolean().default(true),
  variantB: emailConfigSchema.optional(),
  entryCondition: entryConditionSchema.optional(),
});

const stepInputSchema = z.discriminatedUnion("type", [
  stepInputBase.extend({
    type: z.literal("manual_email"),
    config: emailConfigSchema,
  }),
  stepInputBase.extend({
    type: z.literal("auto_email"),
    config: emailConfigSchema,
  }),
  stepInputBase.extend({
    type: z.literal("wait"),
    config: waitConfigSchema,
  }),
  stepInputBase.extend({
    type: z.literal("task"),
    config: taskConfigSchema,
  }),
]);

function parseSettings(raw: unknown): SequenceSettings {
  return sequenceSettingsSchema.parse(raw ?? {});
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : email.toLowerCase();
}

async function loadSuppressedEmails(
  organizationId: string,
  emails: string[],
): Promise<Set<string>> {
  if (emails.length === 0) return new Set();

  const normalized = emails.map((e) => e.toLowerCase());
  const domains = [...new Set(normalized.map(emailDomain))];

  const rows = await db.query.suppression.findMany({
    where: and(
      eq(tables.suppression.organizationId, organizationId),
      inArray(tables.suppression.value, [...normalized, ...domains]),
    ),
  });

  const suppressed = new Set<string>();
  for (const row of rows) {
    if (row.valueType === "email") {
      suppressed.add(row.value);
    } else if (row.valueType === "domain") {
      for (const email of normalized) {
        if (emailDomain(email) === row.value) suppressed.add(email);
      }
    }
  }
  return suppressed;
}

function serializeSequence(row: SequenceRow, extras?: { stepCount?: number }) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    status: row.status,
    settings: parseSettings(row.settings),
    createdByUserId: row.createdByUserId,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    stepCount: extras?.stepCount,
  };
}

function serializeStep(row: SequenceStepRow) {
  return {
    id: row.id,
    sequenceId: row.sequenceId,
    organizationId: row.organizationId,
    index: row.stepIndex,
    type: row.stepType,
    delayMinutes: row.delayMinutes,
    businessDaysOnly: row.businessDaysOnly,
    config: row.config as StepConfig,
    variantB: (row.variantB ?? null) as EmailStepConfig | null,
    entryCondition: (row.entryCondition ?? null) as EntryCondition | null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeEnrollment(row: EnrollmentRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    sequenceId: row.sequenceId,
    prospectId: row.prospectId,
    mailboxId: row.mailboxId,
    state: row.state as EnrollmentState,
    currentStepIndex: row.currentStepIndex,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    anchorMessageId: row.anchorMessageId,
    anchorThreadId: row.anchorThreadId,
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    idempotencyKey: row.idempotencyKey,
    abBucket: row.abBucket as "A" | "B" | null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadSequenceOrThrow(id: string, organizationId: string): Promise<SequenceRow> {
  const row = await db.query.sequence.findFirst({
    where: and(
      eq(tables.sequence.id, id),
      eq(tables.sequence.organizationId, organizationId),
      isNull(tables.sequence.deletedAt),
    ),
  });
  if (!row) throw new SequenceError("NOT_FOUND", "Sequence not found");
  return row;
}

async function loadSteps(sequenceId: string, organizationId: string): Promise<SequenceStepRow[]> {
  return db.query.sequenceStep.findMany({
    where: and(
      eq(tables.sequenceStep.sequenceId, sequenceId),
      eq(tables.sequenceStep.organizationId, organizationId),
    ),
    orderBy: asc(tables.sequenceStep.stepIndex),
  });
}

function validateEmailTemplates(config: z.infer<typeof emailConfigSchema>): void {
  for (const field of [config.subject, config.body_template]) {
    const result = validateTemplate(field);
    if (!result.valid) {
      throw new SequenceError(
        "VALIDATION",
        `Unknown template tokens: ${result.unknown.join(", ")}`,
      );
    }
  }
}

function validateStepTemplates(step: z.infer<typeof stepInputSchema>): void {
  if (step.type === "manual_email" || step.type === "auto_email") {
    validateEmailTemplates(step.config);
    if (step.variantB) validateEmailTemplates(step.variantB);
  }
}

function assertDraft(seq: SequenceRow, action: string): void {
  if (seq.status !== "draft") {
    throw new SequenceError("INVALID_STATE", `Cannot ${action} on a non-draft sequence`);
  }
}

type SendWindowJson = {
  timezone?: string;
  window: Record<string, [number, number][]>;
};

function toMailboxSchedule(
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

function stepsToScheduleSpecs(
  steps: SequenceStepRow[],
  settings: SequenceSettings,
): { index: number; kind: StepKind; delayMinutes: number; businessDaysOnly: boolean }[] {
  return steps.map((s) => ({
    index: s.stepIndex,
    kind: s.stepType as StepKind,
    delayMinutes: s.delayMinutes,
    businessDaysOnly: s.businessDaysOnly && settings.business_days_only,
  }));
}

function computeNextRunAt(
  steps: SequenceStepRow[],
  settings: SequenceSettings,
  mailboxRow: typeof tables.mailbox.$inferSelect,
  currentStepIndex: number,
  anchor: Date,
): Date | null {
  if (steps.length === 0) return null;
  const schedule = computeSchedule(
    stepsToScheduleSpecs(steps, settings),
    toMailboxSchedule(mailboxRow.sendWindow, mailboxRow, settings),
    anchor,
  );
  const current = schedule.find((s) => s.index === currentStepIndex);
  return current?.scheduledAt ?? schedule[0]?.scheduledAt ?? null;
}

function buildEnrollmentSnapshot(
  enrollment: EnrollmentRow,
  steps: SequenceStepRow[],
): EnrollmentSnapshot {
  const nextStep = steps.find((s) => s.stepIndex === enrollment.currentStepIndex);
  const hasNext = steps.some((s) => s.stepIndex > enrollment.currentStepIndex);
  return {
    state: enrollment.state as EnrollmentSnapshot["state"],
    currentStepIndex: enrollment.currentStepIndex,
    hasNextStep: hasNext,
    nextStepKind: (nextStep?.stepType as EnrollmentSnapshot["nextStepKind"]) ?? null,
    anchorMessageId: enrollment.anchorMessageId,
    attemptCount: enrollment.attemptCount,
  };
}

export const listSequences = orgFn({ method: "GET" })
  .validator((data: unknown) =>
    z
      .object({
        status: z.enum(["draft", "active", "archived"]).optional(),
        search: z.string().max(200).optional(),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const conditions = [
      eq(tables.sequence.organizationId, organizationId),
      isNull(tables.sequence.deletedAt),
    ];
    if (data.status) conditions.push(eq(tables.sequence.status, data.status));
    if (data.search?.trim()) {
      conditions.push(ilike(tables.sequence.name, `%${data.search.trim()}%`));
    }

    const rows = await db.query.sequence.findMany({
      where: and(...conditions),
      orderBy: desc(tables.sequence.updatedAt),
    });

    const counts = await db
      .select({
        sequenceId: tables.sequenceStep.sequenceId,
        count: sql<number>`count(*)::int`,
      })
      .from(tables.sequenceStep)
      .where(eq(tables.sequenceStep.organizationId, organizationId))
      .groupBy(tables.sequenceStep.sequenceId);

    const enrollmentCounts = await db
      .select({
        sequenceId: tables.enrollment.sequenceId,
        state: tables.enrollment.state,
        count: sql<number>`count(*)::int`,
      })
      .from(tables.enrollment)
      .where(eq(tables.enrollment.organizationId, organizationId))
      .groupBy(tables.enrollment.sequenceId, tables.enrollment.state);

    const stepCountBySeq = new Map(counts.map((c) => [c.sequenceId, c.count]));
    const enrollBySeq = new Map<string, Record<string, number>>();
    for (const row of enrollmentCounts) {
      const existing = enrollBySeq.get(row.sequenceId) ?? {};
      existing[row.state] = row.count;
      enrollBySeq.set(row.sequenceId, existing);
    }

    return rows.map((row) => ({
      ...serializeSequence(row, { stepCount: stepCountBySeq.get(row.id) ?? 0 }),
      enrollmentCounts: enrollBySeq.get(row.id) ?? {},
    }));
  });

export const getSequence = orgFn({ method: "GET" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const seq = await loadSequenceOrThrow(data.id, organizationId);
    const steps = await loadSteps(seq.id, organizationId);

    const enrollmentCounts = await db
      .select({
        state: tables.enrollment.state,
        count: sql<number>`count(*)::int`,
      })
      .from(tables.enrollment)
      .where(
        and(
          eq(tables.enrollment.sequenceId, seq.id),
          eq(tables.enrollment.organizationId, organizationId),
        ),
      )
      .groupBy(tables.enrollment.state);

    const counts: Record<string, number> = {};
    for (const row of enrollmentCounts) counts[row.state] = row.count;

    return {
      ...serializeSequence(seq, { stepCount: steps.length }),
      steps: steps.map(serializeStep),
      enrollmentCounts: counts,
    };
  });

export const createSequence = orgFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        name: z.string().min(1).max(200),
        settings: sequenceSettingsSchema.optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, userId } = context.orgContext;
    const [row] = await db
      .insert(tables.sequence)
      .values({
        organizationId,
        name: data.name.trim(),
        status: "draft",
        settings: data.settings ?? {
          timezone: "UTC",
          throttle_seconds: 90,
          mailbox_ids: [],
          stop_on_reply: true,
          business_days_only: true,
        },
        createdByUserId: userId,
      })
      .returning();
    if (!row) throw new SequenceError("VALIDATION", "Failed to create sequence");
    return serializeSequence(row, { stepCount: 0 });
  });

export const updateSequence = orgFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        patch: z
          .object({
            name: z.string().min(1).max(200).optional(),
            settings: sequenceSettingsSchema.partial().optional(),
          })
          .strict(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const seq = await loadSequenceOrThrow(data.id, organizationId);

    if (seq.status === "archived") {
      throw new SequenceError("INVALID_STATE", "Cannot update an archived sequence");
    }

    const patch: Partial<{ name: string; settings: SequenceSettings }> = {};
    if (data.patch.name !== undefined) {
      if (seq.status !== "draft") {
        throw new SequenceError("INVALID_STATE", "Name can only be changed on draft sequences");
      }
      patch.name = data.patch.name.trim();
    }

    if (data.patch.settings !== undefined) {
      const current = parseSettings(seq.settings);
      if (seq.status === "draft") {
        patch.settings = { ...current, ...data.patch.settings };
      } else if (seq.status === "active") {
        const allowed = sequenceSettingsSchema
          .pick({
            timezone: true,
            throttle_seconds: true,
            stop_on_reply: true,
            business_days_only: true,
          })
          .partial()
          .parse(data.patch.settings);
        patch.settings = { ...current, ...allowed };
      }
    }

    if (Object.keys(patch).length === 0) return serializeSequence(seq);

    const [row] = await db
      .update(tables.sequence)
      .set(patch)
      .where(
        and(eq(tables.sequence.id, seq.id), eq(tables.sequence.organizationId, organizationId)),
      )
      .returning();
    if (!row) throw new SequenceError("NOT_FOUND", "Sequence not found");
    const steps = await loadSteps(row.id, organizationId);
    return serializeSequence(row, { stepCount: steps.length });
  });

export const reorderSteps = orgFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        sequenceId: z.string().uuid(),
        orderedIds: z.array(z.string().uuid()).min(1),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const seq = await loadSequenceOrThrow(data.sequenceId, organizationId);
    assertDraft(seq, "reorder steps");

    const steps = await loadSteps(seq.id, organizationId);
    const stepIds = new Set(steps.map((s) => s.id));
    const orderedSet = new Set(data.orderedIds);

    if (orderedSet.size !== data.orderedIds.length) {
      throw new SequenceError("VALIDATION", "Duplicate step ids in order");
    }
    if (orderedSet.size !== stepIds.size) {
      throw new SequenceError("VALIDATION", "Ordered ids must match all sequence steps");
    }
    for (const id of data.orderedIds) {
      if (!stepIds.has(id)) {
        throw new SequenceError("VALIDATION", `Step ${id} does not belong to this sequence`);
      }
    }

    await db.transaction(async (tx) => {
      for (let i = 0; i < data.orderedIds.length; i++) {
        const stepId = data.orderedIds[i];
        if (!stepId) continue;
        await tx
          .update(tables.sequenceStep)
          .set({ stepIndex: i })
          .where(
            and(
              eq(tables.sequenceStep.id, stepId),
              eq(tables.sequenceStep.organizationId, organizationId),
            ),
          );
      }
    });

    const updated = await loadSteps(seq.id, organizationId);
    return updated.map(serializeStep);
  });

export const upsertStep = orgFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        sequenceId: z.string().uuid(),
        step: stepInputSchema,
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const seq = await loadSequenceOrThrow(data.sequenceId, organizationId);
    assertDraft(seq, "modify steps");
    validateStepTemplates(data.step);

    const { step } = data;

    if (step.id) {
      const existing = await db.query.sequenceStep.findFirst({
        where: and(
          eq(tables.sequenceStep.id, step.id),
          eq(tables.sequenceStep.sequenceId, seq.id),
          eq(tables.sequenceStep.organizationId, organizationId),
        ),
      });
      if (!existing) throw new SequenceError("NOT_FOUND", "Step not found");

      const [row] = await db
        .update(tables.sequenceStep)
        .set({
          stepIndex: step.index,
          stepType: step.type,
          delayMinutes: step.delayMinutes,
          businessDaysOnly: step.businessDaysOnly,
          config: step.config,
          variantB: step.variantB ?? null,
          entryCondition: step.entryCondition ?? null,
        })
        .where(
          and(
            eq(tables.sequenceStep.id, step.id),
            eq(tables.sequenceStep.organizationId, organizationId),
          ),
        )
        .returning();
      if (!row) throw new SequenceError("VALIDATION", "Failed to update step");
      return serializeStep(row);
    }

    const [row] = await db
      .insert(tables.sequenceStep)
      .values({
        sequenceId: seq.id,
        organizationId,
        stepIndex: step.index,
        stepType: step.type,
        delayMinutes: step.delayMinutes,
        businessDaysOnly: step.businessDaysOnly,
        config: step.config,
        variantB: step.variantB ?? null,
        entryCondition: step.entryCondition ?? null,
      })
      .returning();
    if (!row) throw new SequenceError("VALIDATION", "Failed to create step");
    return serializeStep(row);
  });

export const deleteStep = orgFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const step = await db.query.sequenceStep.findFirst({
      where: and(
        eq(tables.sequenceStep.id, data.id),
        eq(tables.sequenceStep.organizationId, organizationId),
      ),
    });
    if (!step) throw new SequenceError("NOT_FOUND", "Step not found");

    const seq = await loadSequenceOrThrow(step.sequenceId, organizationId);
    assertDraft(seq, "delete steps");

    await db
      .delete(tables.sequenceStep)
      .where(
        and(
          eq(tables.sequenceStep.id, data.id),
          eq(tables.sequenceStep.organizationId, organizationId),
        ),
      );

    const remaining = await loadSteps(seq.id, organizationId);
    await db.transaction(async (tx) => {
      for (let i = 0; i < remaining.length; i++) {
        const s = remaining[i];
        if (!s || s.stepIndex === i) continue;
        await tx
          .update(tables.sequenceStep)
          .set({ stepIndex: i })
          .where(eq(tables.sequenceStep.id, s.id));
      }
    });

    return { ok: true as const };
  });

export const activateSequence = orgFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const seq = await loadSequenceOrThrow(data.id, organizationId);
    if (seq.status !== "draft") {
      throw new SequenceError("INVALID_STATE", "Only draft sequences can be activated");
    }

    const steps = await loadSteps(seq.id, organizationId);
    if (steps.length === 0) {
      throw new SequenceError("VALIDATION", "Sequence must have at least one step");
    }

    for (const step of steps) {
      if (step.stepType === "manual_email" || step.stepType === "auto_email") {
        const config = emailConfigSchema.parse(step.config);
        if (!config.ai_generate) {
          if (!config.subject.trim() || !config.body_template.trim()) {
            throw new SequenceError(
              "VALIDATION",
              `Step ${step.stepIndex + 1} requires subject and body (or enable AI generate)`,
            );
          }
        }
      }
    }

    const settings = parseSettings(seq.settings);
    if (settings.mailbox_ids.length === 0) {
      throw new SequenceError("VALIDATION", "At least one mailbox must be selected");
    }

    const mailboxes = await db.query.mailbox.findMany({
      where: and(
        eq(tables.mailbox.organizationId, organizationId),
        inArray(tables.mailbox.id, settings.mailbox_ids),
      ),
    });
    if (mailboxes.length !== settings.mailbox_ids.length) {
      throw new SequenceError("VALIDATION", "One or more selected mailboxes do not exist");
    }

    const [row] = await db
      .update(tables.sequence)
      .set({ status: "active" })
      .where(
        and(eq(tables.sequence.id, seq.id), eq(tables.sequence.organizationId, organizationId)),
      )
      .returning();
    if (!row) throw new SequenceError("NOT_FOUND", "Sequence not found");
    return serializeSequence(row, { stepCount: steps.length });
  });

export const archiveSequence = orgFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const seq = await loadSequenceOrThrow(data.id, organizationId);
    if (seq.status === "archived") return serializeSequence(seq);

    const [row] = await db
      .update(tables.sequence)
      .set({ status: "archived" })
      .where(
        and(eq(tables.sequence.id, seq.id), eq(tables.sequence.organizationId, organizationId)),
      )
      .returning();
    if (!row) throw new SequenceError("NOT_FOUND", "Sequence not found");
    const steps = await loadSteps(row.id, organizationId);
    return serializeSequence(row, { stepCount: steps.length });
  });

export const enrollProspects = orgFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        sequenceId: z.string().uuid(),
        prospectIds: z.array(z.string().uuid()).min(1).max(500),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, userId } = context.orgContext;
    const seq = await loadSequenceOrThrow(data.sequenceId, organizationId);
    if (seq.status !== "active") {
      throw new SequenceError("INVALID_STATE", "Can only enroll into active sequences");
    }

    const settings = parseSettings(seq.settings);
    if (settings.mailbox_ids.length === 0) {
      throw new SequenceError("VALIDATION", "Sequence has no mailboxes configured");
    }

    const steps = await loadSteps(seq.id, organizationId);
    const mailboxes = await db.query.mailbox.findMany({
      where: and(
        eq(tables.mailbox.organizationId, organizationId),
        inArray(tables.mailbox.id, settings.mailbox_ids),
      ),
    });
    if (mailboxes.length === 0) {
      throw new SequenceError("VALIDATION", "No valid mailboxes found");
    }

    const prospects = await db.query.prospect.findMany({
      where: and(
        eq(tables.prospect.organizationId, organizationId),
        inArray(tables.prospect.id, data.prospectIds),
        isNull(tables.prospect.deletedAt),
      ),
    });
    const prospectSet = new Set(prospects.map((p) => p.id));
    const prospectById = new Map(prospects.map((p) => [p.id, p]));

    const suppressedEmails = await loadSuppressedEmails(
      organizationId,
      prospects.map((p) => p.email),
    );

    const existing = await db.query.enrollment.findMany({
      where: and(
        eq(tables.enrollment.sequenceId, seq.id),
        eq(tables.enrollment.organizationId, organizationId),
        inArray(tables.enrollment.prospectId, data.prospectIds),
      ),
    });
    const alreadyEnrolled = new Set(existing.map((e) => e.prospectId));

    const skipped: string[] = [];
    const enrolled: string[] = [];
    const anchor = new Date();
    let mailboxIndex = 0;

    for (const prospectId of data.prospectIds) {
      if (!prospectSet.has(prospectId)) {
        skipped.push(prospectId);
        continue;
      }
      if (alreadyEnrolled.has(prospectId)) {
        skipped.push(prospectId);
        continue;
      }

      const prospect = prospectById.get(prospectId);
      if (prospect) {
        const email = prospect.email.toLowerCase();
        if (
          suppressedEmails.has(email) ||
          prospect.status === "unsubscribed" ||
          prospect.status === "do_not_contact" ||
          prospect.status === "bounced"
        ) {
          skipped.push(prospectId);
          continue;
        }
      }

      const mailbox = mailboxes[mailboxIndex % mailboxes.length];
      if (!mailbox) continue;
      mailboxIndex++;

      const nextRunAt = computeNextRunAt(steps, settings, mailbox, 0, anchor);

      try {
        await db.insert(tables.enrollment).values({
          organizationId,
          sequenceId: seq.id,
          prospectId,
          mailboxId: mailbox.id,
          state: "active",
          currentStepIndex: 0,
          nextRunAt,
          abBucket: Math.random() < 0.5 ? "A" : "B",
          createdByUserId: userId,
        });
        enrolled.push(prospectId);
        alreadyEnrolled.add(prospectId);
      } catch {
        skipped.push(prospectId);
      }
    }

    return { enrolled: enrolled.length, skipped: skipped.length, skippedIds: skipped };
  });

export const previewSchedule = orgFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        sequenceId: z.string().uuid(),
        prospectId: z.string().uuid().optional(),
        mailboxId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const seq = await loadSequenceOrThrow(data.sequenceId, organizationId);
    const settings = parseSettings(seq.settings);
    const steps = await loadSteps(seq.id, organizationId);

    const mailbox = await db.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, data.mailboxId),
        eq(tables.mailbox.organizationId, organizationId),
      ),
    });
    if (!mailbox) throw new SequenceError("NOT_FOUND", "Mailbox not found");

    const anchor = new Date();
    const schedule = computeSchedule(
      stepsToScheduleSpecs(steps, settings),
      toMailboxSchedule(mailbox.sendWindow, mailbox, settings),
      anchor,
    );

    return schedule.map((s) => ({
      index: s.index,
      kind: s.kind,
      scheduledAt: s.scheduledAt.toISOString(),
      deferredBy: s.deferredBy.map((d) => {
        if (d.kind === "outside_window") {
          return { kind: d.kind, nextOpen: d.nextOpen.toISOString() };
        }
        if (d.kind === "business_day") {
          return { kind: d.kind, nextBusinessDay: d.nextBusinessDay.toISOString() };
        }
        if (d.kind === "throttle") {
          return { kind: d.kind, gapSeconds: d.gapSeconds };
        }
        return { kind: d.kind, resetAt: d.resetAt.toISOString() };
      }),
    }));
  });

async function transitionEnrollment(
  enrollmentId: string,
  organizationId: string,
  event: { kind: "pause" } | { kind: "resume" } | { kind: "stop"; reason?: string },
) {
  const row = await db.query.enrollment.findFirst({
    where: and(
      eq(tables.enrollment.id, enrollmentId),
      eq(tables.enrollment.organizationId, organizationId),
    ),
  });
  if (!row) throw new SequenceError("NOT_FOUND", "Enrollment not found");

  const steps = await loadSteps(row.sequenceId, organizationId);
  const snapshot = buildEnrollmentSnapshot(row, steps);
  const result = transition(snapshot, event);

  await db.transaction(async (tx) => {
    await applyWebEffects(tx, enrollmentId, organizationId, result.effects, {
      nextState: result.nextState,
      emitContext: {
        sequenceId: row.sequenceId,
        prospectId: row.prospectId,
      },
    });
  });

  const updated = await db.query.enrollment.findFirst({
    where: and(
      eq(tables.enrollment.id, enrollmentId),
      eq(tables.enrollment.organizationId, organizationId),
    ),
  });
  if (!updated) throw new SequenceError("NOT_FOUND", "Enrollment not found");
  return { enrollment: serializeEnrollment(updated), effects: result.effects };
}

export const pauseEnrollment = orgFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) =>
    transitionEnrollment(data.id, context.orgContext.organizationId, { kind: "pause" }),
  );

export const resumeEnrollment = orgFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) =>
    transitionEnrollment(data.id, context.orgContext.organizationId, { kind: "resume" }),
  );

export const stopEnrollment = orgFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) =>
    transitionEnrollment(data.id, context.orgContext.organizationId, { kind: "stop" }),
  );

export const listEnrollments = orgFn({ method: "GET" })
  .validator((data: unknown) => z.object({ sequenceId: z.string().uuid() }).parse(data ?? {}))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    await loadSequenceOrThrow(data.sequenceId, organizationId);

    const rows = await db.query.enrollment.findMany({
      where: and(
        eq(tables.enrollment.sequenceId, data.sequenceId),
        eq(tables.enrollment.organizationId, organizationId),
      ),
      orderBy: desc(tables.enrollment.createdAt),
    });

    const prospectIds = [...new Set(rows.map((r) => r.prospectId))];
    const prospects =
      prospectIds.length > 0
        ? await db.query.prospect.findMany({
            where: and(
              eq(tables.prospect.organizationId, organizationId),
              inArray(tables.prospect.id, prospectIds),
            ),
          })
        : [];
    const prospectById = new Map(prospects.map((p) => [p.id, p]));

    return rows.map((row) => {
      const prospect = prospectById.get(row.prospectId);
      return {
        ...serializeEnrollment(row),
        prospect: prospect
          ? {
              id: prospect.id,
              email: prospect.email,
              firstName: prospect.firstName,
              lastName: prospect.lastName,
            }
          : null,
      };
    });
  });
