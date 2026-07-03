import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";
import { reserveSendSlotInTx } from "./reserve-slot.ts";

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

const settings = {
  timezone: "UTC",
  throttle_seconds: 0,
  mailbox_ids: [],
  stop_on_reply: false,
  business_days_only: false,
};

describe("reserveSendSlotInTx SEG throttles", () => {
  beforeEach(() => {
    process.env.QUIKSEND_ENGINE_FAKE_MAIL = "1";
    process.env.SEG_DAILY_CAP_PER_MAILBOX = "2";
  });

  afterEach(() => {
    delete process.env.QUIKSEND_ENGINE_FAKE_MAIL;
    delete process.env.SEG_DAILY_CAP_PER_MAILBOX;
  });

  it("applies SEG sub-cap lower than mailbox daily cap", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: `cap-${randomUUID().slice(0, 6)}@test.local`,
          dailyCap: 50,
          throttleSeconds: 0,
          sendWindow: WIDE_WINDOW,
          status: "active",
        })
        .returning();
      if (!mailbox) throw new Error("setup failed");
      const mailboxRow = mailbox;

      const [sequence] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "Cap test",
          status: "active",
          settings: { mailbox_ids: [mailbox.id] },
          createdByUserId: orgA.userId,
        })
        .returning();

      async function enrollOne(i: number) {
        const [prospect] = await db
          .insert(tables.prospect)
          .values({
            organizationId: orgA.id,
            email: `p${i}-${randomUUID().slice(0, 4)}@seg.test`,
            emailGateway: "proofpoint",
          })
          .returning();
        return db
          .insert(tables.enrollment)
          .values({
            organizationId: orgA.id,
            sequenceId: sequence!.id,
            prospectId: prospect!.id,
            mailboxId: mailboxRow.id,
            state: "active",
            createdByUserId: orgA.userId,
          })
          .returning();
      }

      const at = new Date();
      const firstEnrollment = await enrollOne(1);
      const secondEnrollment = await enrollOne(2);
      const thirdEnrollment = await enrollOne(3);

      const first = await db.transaction((tx) =>
        reserveSendSlotInTx(tx, mailboxRow.id, firstEnrollment[0]!.id, orgA.id, at, settings, {
          recipientEmail: "a@seg1.test",
          recipientGateway: "proofpoint",
        }),
      );
      const second = await db.transaction((tx) =>
        reserveSendSlotInTx(tx, mailboxRow.id, secondEnrollment[0]!.id, orgA.id, at, settings, {
          recipientEmail: "b@seg2.test",
          recipientGateway: "proofpoint",
        }),
      );
      const third = await db.transaction((tx) =>
        reserveSendSlotInTx(tx, mailboxRow.id, thirdEnrollment[0]!.id, orgA.id, at, settings, {
          recipientEmail: "c@seg3.test",
          recipientGateway: "proofpoint",
        }),
      );

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(third).toMatchObject({ ok: false, deferUntil: expect.any(Date) });
      const deferred = third as { ok: false; deferUntil: Date };
      expect(deferred.deferUntil.getTime()).toBeGreaterThan(at.getTime());
    });
  });

  it("enforces 5-minute gap for same recipient domain", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: `gap-${randomUUID().slice(0, 6)}@test.local`,
          dailyCap: 50,
          throttleSeconds: 0,
          sendWindow: WIDE_WINDOW,
          status: "active",
        })
        .returning();
      if (!mailbox) throw new Error("setup failed");
      const mailboxRow = mailbox;

      const [sequence] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "Gap test",
          status: "active",
          settings: { mailbox_ids: [mailbox.id] },
          createdByUserId: orgA.userId,
        })
        .returning();

      async function enroll(email: string) {
        const [prospect] = await db
          .insert(tables.prospect)
          .values({ organizationId: orgA.id, email })
          .returning();
        return db
          .insert(tables.enrollment)
          .values({
            organizationId: orgA.id,
            sequenceId: sequence!.id,
            prospectId: prospect!.id,
            mailboxId: mailboxRow.id,
            state: "active",
            createdByUserId: orgA.userId,
          })
          .returning();
      }

      const at = new Date();
      const e1 = await enroll("one@same-domain.test");
      const e2 = await enroll("two@same-domain.test");

      const first = await db.transaction((tx) =>
        reserveSendSlotInTx(tx, mailboxRow.id, e1[0]!.id, orgA.id, at, settings, {
          recipientEmail: "one@same-domain.test",
        }),
      );
      const second = await db.transaction((tx) =>
        reserveSendSlotInTx(tx, mailboxRow.id, e2[0]!.id, orgA.id, at, settings, {
          recipientEmail: "two@same-domain.test",
        }),
      );

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(false);

      const reservations = await db.query.sendReservation.findMany({
        where: eq(tables.sendReservation.mailboxId, mailboxRow.id),
      });
      expect(reservations.some((r) => r.recipientDomain === "same-domain.test")).toBe(true);
    });
  });
});
