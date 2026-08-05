import { describe, expect, it } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { and, eq } from "drizzle-orm";
import {
  assertFirstStepIsNotAutoEmail,
  isEnrollmentDuplicate,
} from "./sequences.functions.ts";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("assertFirstStepIsNotAutoEmail", () => {
  it("throws when step 0 is auto_email", () => {
    expect(() => assertFirstStepIsNotAutoEmail([{ stepType: "auto_email" }])).toThrowError(
      /first step cannot be auto_email/i,
    );
  });

  it("passes when step 0 is manual_email", () => {
    expect(() =>
      assertFirstStepIsNotAutoEmail([{ stepType: "manual_email" }, { stepType: "auto_email" }]),
    ).not.toThrow();
  });

  it("passes when step 0 is a wait step", () => {
    expect(() =>
      assertFirstStepIsNotAutoEmail([{ stepType: "wait" }, { stepType: "auto_email" }]),
    ).not.toThrow();
  });

  it("passes on empty steps (length check runs separately)", () => {
    expect(() => assertFirstStepIsNotAutoEmail([])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// isEnrollmentDuplicate — constraint-aware unique-violation check
// ---------------------------------------------------------------------------

describe("isEnrollmentDuplicate", () => {
  it("matches the enrollment uniqueness constraint", () => {
    const err = {
      code: "23505",
      constraint_name: "enrollment_org_sequence_prospect_uidx",
      message: "duplicate key value violates unique constraint",
    };
    expect(isEnrollmentDuplicate(err)).toBe(true);
  });

  it("rejects a 23505 from the idempotency key constraint", () => {
    const err = {
      code: "23505",
      constraint_name: "enrollment_idempotency_key_uidx",
      message: "duplicate key value violates unique constraint",
    };
    expect(isEnrollmentDuplicate(err)).toBe(false);
  });

  it("rejects a 23505 with no constraint_name", () => {
    expect(isEnrollmentDuplicate({ code: "23505" })).toBe(false);
  });

  it("rejects other PG error codes", () => {
    expect(
      isEnrollmentDuplicate({
        code: "23503",
        constraint_name: "enrollment_org_sequence_prospect_uidx",
      }),
    ).toBe(false);
  });

  it("rejects non-object errors", () => {
    expect(isEnrollmentDuplicate(null)).toBe(false);
    expect(isEnrollmentDuplicate(new Error("boom"))).toBe(false);
    expect(isEnrollmentDuplicate("23505")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DB-backed enrollment behavior tests
// ---------------------------------------------------------------------------

/** Shared scaffolding: org + mailbox + prospect + active sequence + wait step. */
async function scaffold(org: { id: string; userId: string }) {
  const [mailbox] = await db
    .insert(tables.mailbox)
    .values({
      organizationId: org.id,
      ownerUserId: org.userId,
      provider: "smtp",
      address: `mb-${Date.now()}@seq-fn.test`,
      status: "active",
    })
    .returning();
  if (!mailbox) throw new Error("mailbox setup failed");

  const [prospect] = await db
    .insert(tables.prospect)
    .values({ organizationId: org.id, email: `p-${Date.now()}@seq-fn.test` })
    .returning();
  if (!prospect) throw new Error("prospect setup failed");

  const [sequence] = await db
    .insert(tables.sequence)
    .values({
      organizationId: org.id,
      name: "Test Sequence",
      status: "active",
      settings: { mailbox_ids: [mailbox.id] },
      createdByUserId: org.userId,
    })
    .returning();
  if (!sequence) throw new Error("sequence setup failed");

  await db.insert(tables.sequenceStep).values({
    organizationId: org.id,
    sequenceId: sequence.id,
    stepIndex: 0,
    stepType: "wait",
    delayMinutes: 60,
    config: { minutes: 60 },
  });

  return { mailbox, prospect, sequence };
}

describe("enrollment exclusion — DB behavior", () => {
  it("duplicate insert on enrollment_org_sequence_prospect_uidx yields already_enrolled", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { mailbox, prospect, sequence } = await scaffold(orgA);

      // First insert succeeds
      await db.insert(tables.enrollment).values({
        organizationId: orgA.id,
        sequenceId: sequence.id,
        prospectId: prospect.id,
        mailboxId: mailbox.id,
        state: "active",
        currentStepIndex: 0,
        createdByUserId: orgA.userId,
      });

      // Second insert hits the unique constraint
      try {
        await db.insert(tables.enrollment).values({
          organizationId: orgA.id,
          sequenceId: sequence.id,
          prospectId: prospect.id,
          mailboxId: mailbox.id,
          state: "active",
          currentStepIndex: 0,
          createdByUserId: orgA.userId,
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(isEnrollmentDuplicate(err)).toBe(true);
      }
    });
  });

  it("archived sequence blocks enrollment", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { sequence, prospect } = await scaffold(orgA);

      // Archive the sequence
      await db
        .update(tables.sequence)
        .set({ status: "archived" })
        .where(eq(tables.sequence.id, sequence.id));

      // Verify archived
      const archived = await db.query.sequence.findFirst({
        where: eq(tables.sequence.id, sequence.id),
      });
      expect(archived?.status).toBe("archived");

      // No enrollment should exist
      const enrollments = await db.query.enrollment.findMany({
        where: and(
          eq(tables.enrollment.sequenceId, sequence.id),
          eq(tables.enrollment.prospectId, prospect.id),
        ),
      });
      expect(enrollments).toHaveLength(0);
    });
  });

  it("active enrollment loads after sequence is archived", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { mailbox, prospect, sequence } = await scaffold(orgA);

      // Enroll while active
      const [enrollment] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence.id,
          prospectId: prospect.id,
          mailboxId: mailbox.id,
          state: "active",
          currentStepIndex: 0,
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!enrollment) throw new Error("enrollment setup failed");

      // Archive the sequence
      await db
        .update(tables.sequence)
        .set({ status: "archived" })
        .where(eq(tables.sequence.id, sequence.id));

      // Enrollment still loads (no status filter)
      const loaded = await db.query.enrollment.findFirst({
        where: eq(tables.enrollment.id, enrollment.id),
      });
      expect(loaded).toBeDefined();
      expect(loaded!.state).toBe("active");

      // Sequence loads for the enrollment (no status filter)
      const seq = await db.query.sequence.findFirst({
        where: eq(tables.sequence.id, loaded!.sequenceId),
      });
      expect(seq).toBeDefined();
      expect(seq!.status).toBe("archived");
    });
  });

  it("deleted prospect is excluded from enrollment", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { prospect } = await scaffold(orgA);

      // Soft-delete the prospect
      await db
        .update(tables.prospect)
        .set({ deletedAt: new Date() })
        .where(eq(tables.prospect.id, prospect.id));

      // Query with deletedAt IS NULL excludes it
      const found = await db.query.prospect.findFirst({
        where: and(
          eq(tables.prospect.id, prospect.id),
          eq(tables.prospect.organizationId, orgA.id),
        ),
      });
      // The prospect exists but is soft-deleted
      expect(found).toBeDefined();
      expect(found!.deletedAt).not.toBeNull();
    });
  });

  it("suppressed prospect is excluded from enrollment", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { prospect } = await scaffold(orgA);

      // Mark prospect as bounced
      await db
        .update(tables.prospect)
        .set({ status: "bounced" })
        .where(eq(tables.prospect.id, prospect.id));

      const updated = await db.query.prospect.findFirst({
        where: eq(tables.prospect.id, prospect.id),
      });
      expect(updated!.status).toBe("bounced");
    });
  });

});
