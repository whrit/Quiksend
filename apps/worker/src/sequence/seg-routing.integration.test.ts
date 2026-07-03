import { randomUUID } from "node:crypto";
import { mergeDeliverabilityPolicy } from "@quiksend/core/deliverability";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";
import { executeStep } from "./execute-step.ts";
import { selectMailboxForSend } from "./mailbox-router.ts";

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

describe("SEG routing integration", () => {
  beforeEach(() => {
    process.env.QUIKSEND_ENGINE_FAKE_MAIL = "1";
    process.env.UNSUBSCRIBE_TOKEN_SECRET = "test-unsubscribe-secret";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
  });

  afterEach(() => {
    delete process.env.QUIKSEND_ENGINE_FAKE_MAIL;
  });

  it("enforce policy pauses SEG enrollments without safe mailboxes, then routes after resume", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db
        .update(tables.organization)
        .set({
          metadata: mergeDeliverabilityPolicy(null, {
            routingPolicy: "enforce",
            changedBy: orgA.userId,
          }),
        })
        .where(eq(tables.organization.id, orgA.id));

      const [unsafeMailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "gmail",
          address: `unsafe-${randomUUID().slice(0, 6)}@integration.test`,
          dailyCap: 50,
          throttleSeconds: 0,
          sendWindow: WIDE_WINDOW,
          status: "active",
        })
        .returning();
      if (!unsafeMailbox) throw new Error("setup failed");

      const [sequence] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "SEG integration",
          status: "active",
          settings: {
            timezone: "UTC",
            throttle_seconds: 0,
            mailbox_ids: [unsafeMailbox.id],
            stop_on_reply: false,
            business_days_only: false,
          },
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!sequence) throw new Error("setup failed");

      await db.insert(tables.sequenceStep).values({
        organizationId: orgA.id,
        sequenceId: sequence.id,
        stepIndex: 0,
        stepType: "auto_email",
        delayMinutes: 0,
        config: {
          subject: "Hello",
          body_template: "<p>Hi</p>",
          ai_generate: false,
        },
      });

      const enrollmentIds: string[] = [];
      for (let i = 0; i < 20; i++) {
        const [prospect] = await db
          .insert(tables.prospect)
          .values({
            organizationId: orgA.id,
            email: `pp-${i}-${randomUUID().slice(0, 4)}@proofpoint.test`,
            emailGateway: "proofpoint",
          })
          .returning();
        const anchorId = `<anchor-${i}@integration.test>`;
        await db.insert(tables.message).values({
          organizationId: orgA.id,
          mailboxId: unsafeMailbox.id,
          prospectId: prospect!.id,
          direction: "outbound",
          subject: "Anchor",
          bodyHtml: "<p>a</p>",
          bodyText: "a",
          messageIdHeader: anchorId,
          providerMessageId: randomUUID(),
          providerThreadId: `thread-${i}`,
          status: "sent",
          sentAt: new Date(),
        });
        const [enrollment] = await db
          .insert(tables.enrollment)
          .values({
            organizationId: orgA.id,
            sequenceId: sequence.id,
            prospectId: prospect!.id,
            mailboxId: unsafeMailbox.id,
            state: "active",
            currentStepIndex: 0,
            nextRunAt: new Date(Date.now() - 1000),
            anchorMessageId: anchorId,
            anchorThreadId: `thread-${i}`,
            createdByUserId: orgA.userId,
          })
          .returning();
        if (enrollment) enrollmentIds.push(enrollment.id);
      }

      for (const enrollmentId of enrollmentIds) {
        await executeStep({ enrollmentId, retryCount: 0, retryLimit: 3 });
      }

      const paused = await db.query.enrollment.findMany({
        where: and(
          eq(tables.enrollment.organizationId, orgA.id),
          eq(tables.enrollment.sequenceId, sequence.id),
        ),
      });
      expect(paused.every((e) => e.state === "paused")).toBe(true);

      const events = await db.query.event.findMany({
        where: and(
          eq(tables.event.organizationId, orgA.id),
          eq(tables.event.type, "enrollment.no_safe_mailbox_for_gateway"),
        ),
      });
      expect(events.length).toBe(20);

      const [safeMailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "microsoft",
          address: `safe-${randomUUID().slice(0, 6)}@integration.test`,
          enterpriseSafe: true,
          dailyCap: 50,
          throttleSeconds: 0,
          sendWindow: WIDE_WINDOW,
          status: "active",
        })
        .returning();
      if (!safeMailbox) throw new Error("safe mailbox setup failed");

      const [swapProspect] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgA.id,
          email: `swap-${randomUUID().slice(0, 6)}@proofpoint.test`,
          emailGateway: "proofpoint",
        })
        .returning();
      const [swapEnrollment] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence.id,
          prospectId: swapProspect!.id,
          mailboxId: unsafeMailbox.id,
          state: "active",
          currentStepIndex: 0,
          nextRunAt: new Date(Date.now() - 1000),
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!swapEnrollment) throw new Error("swap enrollment setup failed");

      const routing = await db.transaction((tx) =>
        selectMailboxForSend(tx, orgA.id, swapEnrollment, unsafeMailbox, "proofpoint", {
          routingPolicy: "enforce",
          contentSanitizerEnabled: true,
        }),
      );
      expect(routing).toMatchObject({
        kind: "route",
        mailboxId: safeMailbox.id,
        autoSwapped: true,
      });
    });
  });
});
