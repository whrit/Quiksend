import "@tanstack/react-start/server-only";

import {
  transition,
  type EnrollmentSnapshot,
  type Event,
} from "@quiksend/core/state-machine";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, eq, inArray, asc } from "drizzle-orm";
import { applyWebEffects } from "./effect-executor.ts";

type SequenceSettings = {
  timezone: string;
  throttle_seconds: number;
  mailbox_ids: string[];
  stop_on_reply: boolean;
  business_days_only: boolean;
};

export async function listTasksCore(organizationId: string) {
  return db.query.task.findMany({
    where: and(
      eq(tables.task.organizationId, organizationId),
      inArray(tables.task.status, ["open", "in_progress"]),
    ),
    orderBy: asc(tables.task.dueAt),
  });
}

export async function getTaskContextCore(taskId: string, organizationId: string) {
  return db.query.task.findFirst({
    where: and(eq(tables.task.id, taskId), eq(tables.task.organizationId, organizationId)),
  });
}

async function resolveTaskAndTransition(
  taskId: string,
  organizationId: string,
  targetStatus: "done" | "skipped",
) {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(tables.task)
      .where(and(eq(tables.task.id, taskId), eq(tables.task.organizationId, organizationId)))
      .for("update");

    if (!locked) throw new Error("Task not found");

    // Idempotent: already terminal or unrecognized status → no-op
    if (locked.status !== "open" && locked.status !== "in_progress") {
      return { status: locked.status, alreadyTerminal: true };
    }

    await tx
      .update(tables.task)
      .set({ status: targetStatus, completedAt: new Date() })
      .where(eq(tables.task.id, taskId));

    const enrollment = await tx.query.enrollment.findFirst({
      where: and(
        eq(tables.enrollment.id, locked.enrollmentId),
        eq(tables.enrollment.organizationId, organizationId),
      ),
    });

    if (enrollment) {
      const steps = await tx.query.sequenceStep.findMany({
        where: and(
          eq(tables.sequenceStep.sequenceId, enrollment.sequenceId),
          eq(tables.sequenceStep.organizationId, organizationId),
        ),
        orderBy: asc(tables.sequenceStep.stepIndex),
      });

      const sequence = await tx.query.sequence.findFirst({
        where: and(
          eq(tables.sequence.id, enrollment.sequenceId),
          eq(tables.sequence.organizationId, organizationId),
        ),
      });

      const mailbox = await tx.query.mailbox.findFirst({
        where: and(
          eq(tables.mailbox.id, enrollment.mailboxId),
          eq(tables.mailbox.organizationId, organizationId),
        ),
      });

      const nextStep = steps.find((s) => s.stepIndex === enrollment.currentStepIndex);
      const hasNext = steps.some((s) => s.stepIndex > enrollment.currentStepIndex);
      const snapshot: EnrollmentSnapshot = {
        state: enrollment.state as EnrollmentSnapshot["state"],
        currentStepIndex: enrollment.currentStepIndex,
        hasNextStep: hasNext,
        nextStepKind: (nextStep?.stepType as EnrollmentSnapshot["nextStepKind"]) ?? null,
        anchorMessageId: enrollment.anchorMessageId,
        attemptCount: enrollment.attemptCount,
      };

      const event: Event =
        targetStatus === "done"
          ? { kind: "task_completed", at: new Date() }
          : { kind: "manual_skipped", at: new Date() };

      const result = transition(snapshot, event);

      if (result.effects.length > 0) {
        const settings = (sequence?.settings ?? {}) as SequenceSettings;
        await applyWebEffects(tx, enrollment.id, organizationId, result.effects, {
          nextState: result.nextState,
          advanceContext: mailbox
            ? { steps, settings, mailbox, anchor: enrollment.createdAt }
            : undefined,
          emitContext: {
            sequenceId: enrollment.sequenceId,
            prospectId: enrollment.prospectId,
          },
        });
      }
    }

    return { status: targetStatus, alreadyTerminal: false };
  });
}

export async function completeGenericTaskCore(taskId: string, organizationId: string) {
  return resolveTaskAndTransition(taskId, organizationId, "done");
}

export async function skipTaskCore(taskId: string, organizationId: string) {
  return resolveTaskAndTransition(taskId, organizationId, "skipped");
}
