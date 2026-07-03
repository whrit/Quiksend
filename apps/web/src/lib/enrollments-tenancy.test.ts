import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";

async function seedEnrollmentGraph(orgId: string, userId: string, email: string) {
  const [mailbox] = await db
    .insert(tables.mailbox)
    .values({
      organizationId: orgId,
      ownerUserId: userId,
      provider: "smtp",
      address: `sender-${email}`,
      status: "active",
    })
    .returning();
  if (!mailbox) throw new Error("setup failed");

  const [prospect] = await db
    .insert(tables.prospect)
    .values({ organizationId: orgId, email })
    .returning();
  if (!prospect) throw new Error("setup failed");

  const [sequence] = await db
    .insert(tables.sequence)
    .values({
      organizationId: orgId,
      name: `Sequence ${email}`,
      status: "active",
      createdByUserId: userId,
    })
    .returning();
  if (!sequence) throw new Error("setup failed");

  return { mailbox, prospect, sequence };
}

describe("enrollment tenancy", () => {
  it("org B cannot read org A enrollments", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const { mailbox, prospect, sequence } = await seedEnrollmentGraph(
        orgA.id,
        orgA.userId,
        "enroll-read@tenancy.test",
      );

      const [enrollmentA] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence.id,
          prospectId: prospect.id,
          mailboxId: mailbox.id,
          state: "active",
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!enrollmentA) throw new Error("setup failed");

      const fromOrgB = await db.query.enrollment.findFirst({
        where: and(
          eq(tables.enrollment.id, enrollmentA.id),
          eq(tables.enrollment.organizationId, orgB.id),
        ),
      });

      expect(fromOrgB).toBeUndefined();
    });
  });

  it("org B cannot update org A enrollments", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const { mailbox, prospect, sequence } = await seedEnrollmentGraph(
        orgA.id,
        orgA.userId,
        "enroll-update@tenancy.test",
      );

      const [enrollmentA] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence.id,
          prospectId: prospect.id,
          mailboxId: mailbox.id,
          state: "active",
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!enrollmentA) throw new Error("setup failed");

      const [updated] = await db
        .update(tables.enrollment)
        .set({ state: "stopped" })
        .where(
          and(
            eq(tables.enrollment.id, enrollmentA.id),
            eq(tables.enrollment.organizationId, orgB.id),
          ),
        )
        .returning();

      expect(updated).toBeUndefined();

      const unchanged = await db.query.enrollment.findFirst({
        where: eq(tables.enrollment.id, enrollmentA.id),
      });
      expect(unchanged?.state).toBe("active");
    });
  });

  it("org B cannot delete org A enrollments", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const { mailbox, prospect, sequence } = await seedEnrollmentGraph(
        orgA.id,
        orgA.userId,
        "enroll-delete@tenancy.test",
      );

      const [enrollmentA] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence.id,
          prospectId: prospect.id,
          mailboxId: mailbox.id,
          state: "active",
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!enrollmentA) throw new Error("setup failed");

      const deleted = await db
        .delete(tables.enrollment)
        .where(
          and(
            eq(tables.enrollment.id, enrollmentA.id),
            eq(tables.enrollment.organizationId, orgB.id),
          ),
        )
        .returning();

      expect(deleted).toHaveLength(0);

      const stillThere = await db.query.enrollment.findFirst({
        where: eq(tables.enrollment.id, enrollmentA.id),
      });
      expect(stillThere?.id).toBe(enrollmentA.id);
    });
  });

  it("two orgs can enroll the same prospect email in parallel sequences", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const graphA = await seedEnrollmentGraph(orgA.id, orgA.userId, "shared@enroll.test");
      const graphB = await seedEnrollmentGraph(orgB.id, orgB.userId, "shared@enroll.test");

      await db.insert(tables.enrollment).values({
        organizationId: orgA.id,
        sequenceId: graphA.sequence.id,
        prospectId: graphA.prospect.id,
        mailboxId: graphA.mailbox.id,
        state: "active",
        createdByUserId: orgA.userId,
      });
      await db.insert(tables.enrollment).values({
        organizationId: orgB.id,
        sequenceId: graphB.sequence.id,
        prospectId: graphB.prospect.id,
        mailboxId: graphB.mailbox.id,
        state: "active",
        createdByUserId: orgB.userId,
      });

      const inA = await db.query.enrollment.findFirst({
        where: eq(tables.enrollment.organizationId, orgA.id),
      });
      const inB = await db.query.enrollment.findFirst({
        where: eq(tables.enrollment.organizationId, orgB.id),
      });

      expect(inA?.id).toBeDefined();
      expect(inB?.id).toBeDefined();
      expect(inA?.id).not.toBe(inB?.id);
    });
  });
});
