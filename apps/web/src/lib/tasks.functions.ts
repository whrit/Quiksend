import {
  transition,
  type EnrollmentSnapshot,
} from "@quiksend/core/state-machine";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, eq, inArray, asc } from "drizzle-orm";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./org-fn.ts";
import { applyWebEffects } from "./effect-executor.ts";

// ---------------------------------------------------------------------------
// Core logic (exported for direct testing without auth middleware)
// ---------------------------------------------------------------------------

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
  // Lock + read the task row inside a transaction
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(tables.task)
      .where(and(eq(tables.task.id, taskId), eq(tables.task.organizationId, organizationId)))
      .for("update");

    if (!locked) throw new Error("Task not found");

    // Idempotent: already in a terminal state → return it
    if (locked.status === "done" || locked.status === "skipped") {
      return { status: locked.status, alreadyTerminal: true };
    }

    // Only open/in_progress tasks can be completed/skipped
    if (locked.status !== "open" && locked.status !== "in_progress") {
      return { status: locked.status, alreadyTerminal: true };
    }

    // Mark the task
    await tx
      .update(tables.task)
      .set({ status: targetStatus, completedAt: new Date() })
      .where(eq(tables.task.id, taskId));

    // Load the enrollment and its sequence steps for the state machine
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

      const result = transition(snapshot, { kind: "manual_skipped", at: new Date() });

      if (result.effects.length > 0) {
        await applyWebEffects(tx, enrollment.id, organizationId, result.effects, {
          nextState: result.nextState,
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

// ---------------------------------------------------------------------------
// Server functions (RPC boundary — authMiddleware provides org scope)
// ---------------------------------------------------------------------------

export const listTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { organizationId } = context.orgContext;
    return listTasksCore(organizationId);
  });

export const getTaskContext = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ taskId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return getTaskContextCore(data.taskId, organizationId);
  });

export const completeGenericTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ taskId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return completeGenericTaskCore(data.taskId, organizationId);
  });

export const skipTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ taskId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return skipTaskCore(data.taskId, organizationId);
  });
