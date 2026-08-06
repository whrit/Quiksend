import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { transition } from "@quiksend/core/state-machine";
import {
  listTasksCore,
  completeGenericTaskCore,
  skipTaskCore,
  getTaskContextCore,
} from "./tasks.server.ts";

const WIDE_WINDOW = {
  timezone: "UTC",
  window: {
    sun: [[0, 24]],
    mon: [[0, 24]],
    tue: [[0, 24]],
    wed: [[0, 24]],
    thu: [[0, 24]],
    fri: [[0, 24]],
    sat: [[0, 24]],
  },
};

async function seedTaskGraph(
  orgId: string,
  userId: string,
  opts: { taskType?: "compose" | "generic"; enrollmentState?: string } = {},
) {
  const [mailbox] = await db
    .insert(tables.mailbox)
    .values({
      organizationId: orgId,
      ownerUserId: userId,
      provider: "smtp",
      address: `sender-${userId}@task.test`,
      dailyCap: 50,
      throttleSeconds: 0,
      sendWindow: WIDE_WINDOW,
      status: "active",
    })
    .returning();
  if (!mailbox) throw new Error("setup failed");

  const [prospect] = await db
    .insert(tables.prospect)
    .values({ organizationId: orgId, email: `prospect-${userId}@task.test` })
    .returning();
  if (!prospect) throw new Error("setup failed");

  const [sequence] = await db
    .insert(tables.sequence)
    .values({
      organizationId: orgId,
      name: "Task Sequence",
      status: "active",
      settings: {
        timezone: "UTC",
        throttle_seconds: 0,
        mailbox_ids: [mailbox.id],
        stop_on_reply: true,
        business_days_only: false,
      },
      createdByUserId: userId,
    })
    .returning();
  if (!sequence) throw new Error("setup failed");

  const stepType = opts.taskType === "compose" ? "manual_email" : "task";
  await db.insert(tables.sequenceStep).values({
    organizationId: orgId,
    sequenceId: sequence.id,
    stepIndex: 0,
    stepType,
    delayMinutes: 0,
    config:
      stepType === "task"
        ? { title: "Review prospect", instructions: "Check LinkedIn" }
        : { subject: "Hi", body_template: "<p>Hi</p>", ai_generate: false },
  });

  // Add a second step so hasNextStep is true after advancing
  await db.insert(tables.sequenceStep).values({
    organizationId: orgId,
    sequenceId: sequence.id,
    stepIndex: 1,
    stepType: "auto_email",
    delayMinutes: 60,
    config: { subject: "Follow up", body_template: "<p>Following up</p>", ai_generate: false },
  });

  const [enrollment] = await db
    .insert(tables.enrollment)
    .values({
      organizationId: orgId,
      sequenceId: sequence.id,
      prospectId: prospect.id,
      mailboxId: mailbox.id,
      state: opts.enrollmentState ?? (opts.taskType === "compose" ? "waiting_manual" : "waiting"),
      currentStepIndex: 0,
      createdByUserId: userId,
    })
    .returning();
  if (!enrollment) throw new Error("setup failed");

  const [task] = await db
    .insert(tables.task)
    .values({
      organizationId: orgId,
      enrollmentId: enrollment.id,
      type: opts.taskType ?? "generic",
      title: "Review prospect",
      instructions: "Check LinkedIn",
      dueAt: new Date(),
      status: "open",
      assignedUserId: userId,
    })
    .returning();
  if (!task) throw new Error("setup failed");

  return { mailbox, prospect, sequence, enrollment, task };
}

describe("task server functions", () => {
  it("listTasksCore returns only the caller's organization tasks", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      await seedTaskGraph(orgA.id, orgA.userId);
      await seedTaskGraph(orgB.id, orgB.userId);

      const tasksA = await listTasksCore(orgA.id);
      const tasksB = await listTasksCore(orgB.id);

      expect(tasksA.length).toBe(1);
      expect(tasksB.length).toBe(1);

      // Cross-org isolation: orgA sees only its own
      expect(tasksA.every((t) => t.organizationId === orgA.id)).toBe(true);
      expect(tasksB.every((t) => t.organizationId === orgB.id)).toBe(true);
    });
  });

  it("getTaskContextCore returns task with enrollment and prospect", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { task, enrollment } = await seedTaskGraph(orgA.id, orgA.userId);

      const ctx = await getTaskContextCore(task.id, orgA.id);
      expect(ctx).not.toBeNull();
      expect(ctx!.id).toBe(task.id);
      expect(ctx!.enrollmentId).toBe(enrollment.id);
    });
  });

  it("getTaskContextCore returns null for cross-org access", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const { task } = await seedTaskGraph(orgA.id, orgA.userId);
      const ctx = await getTaskContextCore(task.id, orgB.id);
      expect(ctx).toBeUndefined();
    });
  });

  it("completeGenericTaskCore marks task done and advances enrollment", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { task, enrollment } = await seedTaskGraph(orgA.id, orgA.userId, {
        taskType: "generic",
      });

      const result = await completeGenericTaskCore(task.id, orgA.id);
      expect(result.status).toBe("done");

      const updatedEnrollment = await db.query.enrollment.findFirst({
        where: and(
          eq(tables.enrollment.id, enrollment.id),
          eq(tables.enrollment.organizationId, orgA.id),
        ),
      });
      expect(updatedEnrollment?.state).toBe("active");
      expect(updatedEnrollment?.currentStepIndex).toBe(1);

      // Must emit task.completed, not task.skipped
      const events = await db.query.event.findMany({
        where: and(
          eq(tables.event.organizationId, orgA.id),
          eq(tables.event.entityId, enrollment.id),
        ),
      });
      expect(events.some((e) => e.type === "task.completed")).toBe(true);
      expect(events.some((e) => e.type === "task.skipped")).toBe(false);
    });
  });

  it("skipTaskCore marks task skipped and advances enrollment", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { task, enrollment } = await seedTaskGraph(orgA.id, orgA.userId, {
        taskType: "generic",
      });

      const result = await skipTaskCore(task.id, orgA.id);
      expect(result.status).toBe("skipped");

      const updatedEnrollment = await db.query.enrollment.findFirst({
        where: and(
          eq(tables.enrollment.id, enrollment.id),
          eq(tables.enrollment.organizationId, orgA.id),
        ),
      });
      expect(updatedEnrollment?.state).toBe("active");
      expect(updatedEnrollment?.currentStepIndex).toBe(1);

      // Must emit task.skipped, not task.completed
      const events = await db.query.event.findMany({
        where: and(
          eq(tables.event.organizationId, orgA.id),
          eq(tables.event.entityId, enrollment.id),
        ),
      });
      expect(events.some((e) => e.type === "task.skipped")).toBe(true);
      expect(events.some((e) => e.type === "task.completed")).toBe(false);
    });
  });

  it("skipTaskCore on compose task in waiting_manual advances enrollment", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { task, enrollment } = await seedTaskGraph(orgA.id, orgA.userId, {
        taskType: "compose",
        enrollmentState: "waiting_manual",
      });

      const result = await skipTaskCore(task.id, orgA.id);
      expect(result.status).toBe("skipped");

      const updatedEnrollment = await db.query.enrollment.findFirst({
        where: and(
          eq(tables.enrollment.id, enrollment.id),
          eq(tables.enrollment.organizationId, orgA.id),
        ),
      });
      expect(updatedEnrollment?.state).toBe("active");
      expect(updatedEnrollment?.currentStepIndex).toBe(1);
    });
  });

  it("repeated completeGenericTaskCore is idempotent", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { task } = await seedTaskGraph(orgA.id, orgA.userId, {
        taskType: "generic",
      });

      const first = await completeGenericTaskCore(task.id, orgA.id);
      const second = await completeGenericTaskCore(task.id, orgA.id);

      expect(first.status).toBe("done");
      expect(second.status).toBe("done");
    });
  });

  it("repeated skipTaskCore is idempotent", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { task } = await seedTaskGraph(orgA.id, orgA.userId, {
        taskType: "generic",
      });

      const first = await skipTaskCore(task.id, orgA.id);
      const second = await skipTaskCore(task.id, orgA.id);

      expect(first.status).toBe("skipped");
      expect(second.status).toBe("skipped");
    });
  });

  it("completeGenericTaskCore rejects already-skipped task idempotently", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { task } = await seedTaskGraph(orgA.id, orgA.userId, {
        taskType: "generic",
      });

      await skipTaskCore(task.id, orgA.id);
      // Completing a skipped task returns the existing terminal state
      const result = await completeGenericTaskCore(task.id, orgA.id);
      expect(result.status).toBe("skipped");
    });
  });

  it("completeGenericTaskCore throws for unknown task", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await expect(
        completeGenericTaskCore("00000000-0000-0000-0000-000000000000", orgA.id),
      ).rejects.toThrow("Task not found");
    });
  });
});

describe("compose task done marking (integration)", () => {
  it("compose task is marked done via idempotent status-guarded update", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { task } = await seedTaskGraph(orgA.id, orgA.userId, {
        taskType: "compose",
        enrollmentState: "waiting_manual",
      });

      // Simulate the idempotent update compose.functions.ts performs
      const updated = await db
        .update(tables.task)
        .set({ status: "done", completedAt: new Date() })
        .where(
          and(
            eq(tables.task.id, task.id),
            eq(tables.task.organizationId, orgA.id),
            inArray(tables.task.status, ["open", "in_progress"]),
          ),
        )
        .returning({ id: tables.task.id });

      expect(updated).toHaveLength(1);

      const row = await db.query.task.findFirst({
        where: eq(tables.task.id, task.id),
      });
      expect(row?.status).toBe("done");
      expect(row?.completedAt).not.toBeNull();
    });
  });

  it("second compose-done marking is a no-op (idempotent)", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { task } = await seedTaskGraph(orgA.id, orgA.userId, {
        taskType: "compose",
        enrollmentState: "waiting_manual",
      });

      // First mark
      await db
        .update(tables.task)
        .set({ status: "done", completedAt: new Date() })
        .where(
          and(
            eq(tables.task.id, task.id),
            eq(tables.task.organizationId, orgA.id),
            inArray(tables.task.status, ["open", "in_progress"]),
          ),
        );

      // Second mark — matches nothing because status is already 'done'
      const retry = await db
        .update(tables.task)
        .set({ status: "done", completedAt: new Date() })
        .where(
          and(
            eq(tables.task.id, task.id),
            eq(tables.task.organizationId, orgA.id),
            inArray(tables.task.status, ["open", "in_progress"]),
          ),
        )
        .returning({ id: tables.task.id });

      // No rows matched — idempotent no-op
      expect(retry).toHaveLength(0);

      const row = await db.query.task.findFirst({
        where: eq(tables.task.id, task.id),
      });
      expect(row?.status).toBe("done");
    });
  });

  it("skipped compose task is not overwritten by done marking", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { task } = await seedTaskGraph(orgA.id, orgA.userId, {
        taskType: "compose",
        enrollmentState: "waiting_manual",
      });

      await skipTaskCore(task.id, orgA.id);

      // Compose send arrives after skip — must not overwrite
      const stale = await db
        .update(tables.task)
        .set({ status: "done", completedAt: new Date() })
        .where(
          and(
            eq(tables.task.id, task.id),
            eq(tables.task.organizationId, orgA.id),
            inArray(tables.task.status, ["open", "in_progress"]),
          ),
        )
        .returning({ id: tables.task.id });

      expect(stale).toHaveLength(0);

      const row = await db.query.task.findFirst({
        where: eq(tables.task.id, task.id),
      });
      expect(row?.status).toBe("skipped");
    });
  });
});

describe("enrollment stop through core transition", () => {
  it("prospect delete stops enrollment via core stop transition", async () => {
    const result = transition(
      {
        state: "active",
        currentStepIndex: 0,
        hasNextStep: true,
        nextStepKind: "manual_email",
        anchorMessageId: null,
        attemptCount: 0,
      },
      { kind: "stop", reason: "prospect_deleted" },
    );

    expect(result.nextState).toBe("stopped");
    expect(result.effects).toEqual(
      expect.arrayContaining([
        { kind: "terminate", reason: "stopped" },
        { kind: "emit_event", type: "enrollment.stopped" },
      ]),
    );
  });

  it("mailbox archive stops enrollment via core stop transition", () => {
    const result = transition(
      {
        state: "waiting_manual",
        currentStepIndex: 0,
        hasNextStep: true,
        nextStepKind: "manual_email",
        anchorMessageId: null,
        attemptCount: 0,
      },
      { kind: "stop", reason: "mailbox_archived" },
    );

    expect(result.nextState).toBe("stopped");
    expect(result.effects).toContainEqual({
      kind: "emit_event",
      type: "enrollment.stopped",
    });
  });

  it("terminal enrollment is unaffected by stop transition", () => {
    for (const state of ["stopped", "completed", "replied", "bounced", "failed"] as const) {
      const result = transition(
        {
          state,
          currentStepIndex: 0,
          hasNextStep: false,
          nextStepKind: null,
          anchorMessageId: null,
          attemptCount: 0,
        },
        { kind: "stop", reason: "prospect_deleted" },
      );

      expect(result.nextState).toBe(state);
      expect(result.effects).toEqual([]);
    }
  });
});
