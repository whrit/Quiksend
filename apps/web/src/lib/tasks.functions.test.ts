import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import {
  listTasksCore,
  completeGenericTaskCore,
  skipTaskCore,
  getTaskContextCore,
} from "./tasks.functions.ts";

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
      const { task, enrollment, prospect } = await seedTaskGraph(orgA.id, orgA.userId);

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
      expect(ctx).toBeNull();
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
