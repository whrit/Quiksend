import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { processInboundMessage, type ParsedInbound } from "./mailbox-poll.ts";

const WIDE_WINDOW = {
  timezone: "UTC",
  business_days_only: false,
  send_window: {
    sun: [[0, 24]],
    mon: [[0, 24]],
    tue: [[0, 24]],
    wed: [[0, 24]],
    thu: [[0, 24]],
    fri: [[0, 24]],
    sat: [[0, 24]],
  },
};

function makeParsedInbound(overrides: Partial<ParsedInbound> = {}): ParsedInbound {
  return {
    providerMessageId: overrides.providerMessageId ?? `prov-${randomUUID()}`,
    providerThreadId: null,
    messageIdHeader: null,
    inReplyTo: null,
    references: null,
    subject: "test",
    bodyHtml: null,
    bodyText: "test body",
    fromEmail: "sender@test.local",
    rawMime: "From: sender@test.local\r\nTo: rcpt@test.local\r\nSubject: test\r\n\r\ntest body",
    receivedAt: new Date("2026-08-01T12:00:00Z"),
    headers: {},
    bounceType: null,
    ...overrides,
  };
}

/** Shared helper: create mailbox, prospect, sequence, step, enrollment. */
async function setupEnrollment(orgId: string, userId: string, mailboxId: string) {
  const [prospect] = await db
    .insert(tables.prospect)
    .values({
      organizationId: orgId,
      email: `prospect-${randomUUID()}@test.local`,
      status: "active",
    })
    .returning();
  const [sequence] = await db
    .insert(tables.sequence)
    .values({
      organizationId: orgId,
      name: `seq-${randomUUID()}`,
      status: "active",
      createdByUserId: userId,
      settings: WIDE_WINDOW,
    })
    .returning();
  await db.insert(tables.sequenceStep).values({
    organizationId: orgId,
    sequenceId: sequence!.id,
    stepIndex: 0,
    stepType: "auto_email",
    delayMinutes: 0,
    config: { subject: "Hi", body_template: "<p>Hi</p>", ai_generate: false },
  });
  const [enrollment] = await db
    .insert(tables.enrollment)
    .values({
      organizationId: orgId,
      sequenceId: sequence!.id,
      prospectId: prospect!.id,
      mailboxId,
      state: "active",
      currentStepIndex: 0,
      createdByUserId: userId,
    })
    .returning();
  return { prospect: prospect!, sequence: sequence!, enrollment: enrollment! };
}

describe("processInboundMessage", () => {
  it("completes ingestion on success, keeps status received, and returns enrichment", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "gmail",
          address: "inbox@test.local",
          dailyCap: 50,
          throttleSeconds: 0,
          status: "active",
        })
        .returning();
      if (!mailbox) throw new Error("setup failed");

      const providerMsgId = `prov-${randomUUID()}`;
      const inbound = makeParsedInbound({ providerMessageId: providerMsgId });

      const result = await db.transaction(async (tx) => {
        return processInboundMessage(tx, mailbox, inbound, { stop_on_ooo: false });
      });
      expect(result.status).toBe("ok");
      expect(result.enrichment).toBeDefined();

      const msg = await db.query.message.findFirst({
        where: eq(tables.message.providerMessageId, providerMsgId),
      });
      expect(msg!.ingestionAttempts).toBe(1);
      expect(msg!.status).toBe("received");
      expect(msg!.ingestionComplete).toBe(true);
    });
  });

  it("concurrent pollers produce one message and one enrollment transition", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "gmail",
          address: "inbox@concurrent.local",
          dailyCap: 50,
          throttleSeconds: 0,
          status: "active",
        })
        .returning();
      if (!mailbox) throw new Error("setup failed");

      // Set up enrollment so the inbound reply triggers a real transition
      const { enrollment } = await setupEnrollment(orgA.id, orgA.userId, mailbox.id);
      const outboundMsgId = `<outbound-concurrent-${randomUUID()}@test.local>`;
      await db.insert(tables.message).values({
        organizationId: orgA.id,
        mailboxId: mailbox.id,
        direction: "outbound",
        messageIdHeader: outboundMsgId,
        enrollmentId: enrollment.id,
        prospectId: enrollment.prospectId,
        status: "sent",
      });

      const providerMsgId = `prov-concurrent-${randomUUID()}`;
      const inbound = makeParsedInbound({
        providerMessageId: providerMsgId,
        inReplyTo: outboundMsgId,
      });

      // Run two concurrent transactions with advisory lock + processInboundMessage
      const [r1, r2] = await Promise.all([
        db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${mailbox.id}))`);
          return processInboundMessage(tx, mailbox, inbound, { stop_on_ooo: false });
        }),
        db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${mailbox.id}))`);
          return processInboundMessage(tx, mailbox, inbound, { stop_on_ooo: false });
        }),
      ]);

      // Both succeed
      expect(r1.status).toBe("ok");
      expect(r2.status).toBe("ok");

      // Only one message row exists
      const msgs = await db.query.message.findMany({
        where: eq(tables.message.providerMessageId, providerMsgId),
      });
      expect(msgs).toHaveLength(1);

      // First poller completed ingestion, second saw ingestionComplete and skipped:
      // ingestionAttempts stays at 1 (completed rows don't increment)
      expect(msgs[0]!.ingestionAttempts).toBe(1);
      expect(msgs[0]!.status).toBe("received");
      expect(msgs[0]!.ingestionComplete).toBe(true);

      // Enrollment transitioned exactly once (active → replied)
      const updatedEnrollment = await db.query.enrollment.findFirst({
        where: eq(tables.enrollment.id, enrollment.id),
      });
      expect(updatedEnrollment!.state).toBe("replied");
    });
  });

  it("resumes processing for duplicate after prior failure instead of returning early", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: "inbox@resume.local",
          dailyCap: 50,
          throttleSeconds: 0,
          status: "active",
        })
        .returning();
      if (!mailbox) throw new Error("setup failed");

      const providerMsgId = `prov-resume-${randomUUID()}`;

      // Simulate a prior failed attempt: message row exists with ingestionAttempts=1
      await db.insert(tables.message).values({
        organizationId: orgA.id,
        mailboxId: mailbox.id,
        direction: "inbound",
        providerMessageId: providerMsgId,
        status: "received",
        ingestionAttempts: 1,
        receivedAt: new Date("2026-08-01T12:00:00Z"),
      });

      const inbound = makeParsedInbound({ providerMessageId: providerMsgId });

      // Resume: processInboundMessage should NOT skip, should increment and re-process
      const result = await db.transaction(async (tx) => {
        return processInboundMessage(tx, mailbox, inbound, { stop_on_ooo: false });
      });
      expect(result.status).toBe("ok");

      // ingestionAttempts was incremented (proves no early return on duplicate)
      const msg = await db.query.message.findFirst({
        where: eq(tables.message.providerMessageId, providerMsgId),
      });
      expect(msg!.ingestionAttempts).toBe(2);
      expect(msg!.status).toBe("received");
      expect(msg!.ingestionComplete).toBe(true);
    });
  });
});
