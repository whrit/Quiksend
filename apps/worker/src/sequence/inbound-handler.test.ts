import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";
import { handleInboundBounce, type InboundEmail } from "./inbound-handler.ts";

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

describe("handleInboundBounce integration", () => {
  it("terminates enrollment, suppresses prospect, and records hard bounce on inbound message", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: "sender@bounce.test",
          dailyCap: 50,
          throttleSeconds: 0,
          sendWindow: WIDE_WINDOW,
          status: "active",
        })
        .returning();
      if (!mailbox) throw new Error("setup failed");

      const [prospect] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgA.id,
          email: "bounced@bounce.test",
          status: "active",
        })
        .returning();
      if (!prospect) throw new Error("setup failed");

      const [sequence] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "Bounce Sequence",
          status: "active",
          settings: {
            timezone: "UTC",
            throttle_seconds: 0,
            mailbox_ids: [mailbox.id],
            stop_on_reply: true,
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
        config: { subject: "Hi", body_template: "<p>Hi</p>", ai_generate: false },
      });

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
      if (!enrollment) throw new Error("setup failed");

      const receivedAt = new Date("2026-03-01T10:00:00Z");
      const [bounceMessage] = await db
        .insert(tables.message)
        .values({
          organizationId: orgA.id,
          mailboxId: mailbox.id,
          prospectId: prospect.id,
          enrollmentId: enrollment.id,
          direction: "inbound",
          subject: "Delivery Status Notification (Failure)",
          bodyText: "550 User unknown",
          status: "bounced",
          bounceType: "hard",
          receivedAt,
        })
        .returning();
      if (!bounceMessage) throw new Error("setup failed");

      const inbound: InboundEmail = {
        id: bounceMessage.id,
        organizationId: orgA.id,
        mailboxId: mailbox.id,
        providerMessageId: "bounce-provider-1",
        providerThreadId: null,
        messageIdHeader: "<bounce@mailer-daemon.test>",
        inReplyTo: null,
        references: null,
        subject: bounceMessage.subject,
        bodyHtml: null,
        bodyText: bounceMessage.bodyText,
        fromEmail: prospect.email,
        bounceType: "hard",
        receivedAt,
        enrollmentId: enrollment.id,
      };

      await handleInboundBounce(inbound, enrollment.id);

      const updatedMessage = await db.query.message.findFirst({
        where: eq(tables.message.id, bounceMessage.id),
      });
      expect(updatedMessage?.status).toBe("bounced");
      expect(updatedMessage?.bounceType).toBe("hard");

      const updatedEnrollment = await db.query.enrollment.findFirst({
        where: eq(tables.enrollment.id, enrollment.id),
      });
      expect(updatedEnrollment?.state).toBe("bounced");

      const updatedProspect = await db.query.prospect.findFirst({
        where: eq(tables.prospect.id, prospect.id),
      });
      expect(updatedProspect?.status).toBe("bounced");

      const suppression = await db.query.suppression.findFirst({
        where: and(
          eq(tables.suppression.organizationId, orgA.id),
          eq(tables.suppression.value, prospect.email.toLowerCase()),
        ),
      });
      expect(suppression).toBeDefined();
      expect(suppression?.reason).toBe("bounce");
    });
  });
});
