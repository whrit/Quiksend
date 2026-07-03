import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { maybePauseCampaigns } from "../handlers/canary-check.ts";

describe("maybePauseCampaigns per-group auto-pause", () => {
  it("pauses only the breaching sequence/mailbox/gateway tuple", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const userId = orgA.userId;
      const now = new Date();

      const mailboxes = [];
      for (let i = 0; i < 2; i++) {
        const [mb] = await db
          .insert(tables.mailbox)
          .values({
            organizationId: orgA.id,
            ownerUserId: userId,
            provider: "smtp",
            address: `mb${i}-${randomUUID().slice(0, 4)}@test.local`,
            enterpriseSafe: true,
            dailyCap: 50,
            throttleSeconds: 0,
            sendWindow: { timezone: "UTC", window: {} },
            status: "active",
          })
          .returning();
        if (mb) mailboxes.push(mb);
      }

      const sequences = [];
      for (let i = 0; i < 2; i++) {
        const [seq] = await db
          .insert(tables.sequence)
          .values({
            organizationId: orgA.id,
            name: `Seq ${i}`,
            status: "active",
            settings: {
              timezone: "UTC",
              throttle_seconds: 0,
              mailbox_ids: mailboxes.map((m) => m.id),
            },
            canaryConfig: { pauseThresholdPct: 80 },
            createdByUserId: userId,
          })
          .returning();
        if (seq) sequences.push(seq);
      }

      const [seedPp] = await db
        .insert(tables.seedInbox)
        .values({
          organizationId: orgA.id,
          email: `pp-${randomUUID().slice(0, 4)}@seed.test`,
          gateway: "proofpoint",
          provider: "google_workspace",
          imapConfig: "cipher",
          active: true,
        })
        .returning();

      const [seedMc] = await db
        .insert(tables.seedInbox)
        .values({
          organizationId: orgA.id,
          email: `mc-${randomUUID().slice(0, 4)}@seed.test`,
          gateway: "mimecast",
          provider: "google_workspace",
          imapConfig: "cipher",
          active: true,
        })
        .returning();

      for (const [prospectEmail, enrollmentState] of [
        ["p1@test.local", "active"],
        ["p2@test.local", "active"],
      ] as const) {
        const [p] = await db
          .insert(tables.prospect)
          .values({ organizationId: orgA.id, email: prospectEmail, source: "api" })
          .returning();
        await db.insert(tables.enrollment).values({
          organizationId: orgA.id,
          sequenceId: sequences[1]!.id,
          prospectId: p!.id,
          mailboxId: mailboxes[1]!.id,
          state: enrollmentState,
          createdByUserId: userId,
        });
      }

      const breachSequence = sequences[0]!;
      const breachMailbox = mailboxes[0]!;

      for (let i = 0; i < 4; i++) {
        await db.insert(tables.canarySend).values({
          organizationId: orgA.id,
          sequenceId: breachSequence.id,
          mailboxId: breachMailbox.id,
          seedInboxId: seedPp!.id,
          canaryToken: randomUUID(),
          subject: "Canary",
          sentAt: now,
          expectedArrivalAt: now,
          arrivalStatus: i === 0 ? "arrived_inbox" : "silent_drop",
          arrivedAt: now,
        });
      }

      for (let i = 0; i < 4; i++) {
        await db.insert(tables.canarySend).values({
          organizationId: orgA.id,
          sequenceId: sequences[1]!.id,
          mailboxId: mailboxes[1]!.id,
          seedInboxId: seedMc!.id,
          canaryToken: randomUUID(),
          subject: "Canary",
          sentAt: now,
          expectedArrivalAt: now,
          arrivalStatus: "arrived_inbox",
          arrivedAt: now,
        });
      }

      await maybePauseCampaigns();

      const breachEnrollments = await db.query.enrollment.findMany({
        where: eq(tables.enrollment.sequenceId, breachSequence.id),
      });
      const healthyEnrollments = await db.query.enrollment.findMany({
        where: eq(tables.enrollment.sequenceId, sequences[1]!.id),
      });

      expect(breachEnrollments.every((e) => e.state === "paused")).toBe(true);
      expect(healthyEnrollments.every((e) => e.state === "active")).toBe(true);

      const events = await db.query.event.findMany({
        where: eq(tables.event.type, "canary.silent_drop_detected"),
      });
      expect(events.some((e) => e.entityId === breachSequence.id)).toBe(true);
    });
  });
});
