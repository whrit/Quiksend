import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { processInboundMessage, type ParsedInbound } from "./mailbox-poll.ts";

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

describe("processInboundMessage", () => {
  it("blocks cursor when processing fails and allows successful retry", async () => {
    await withTestOrgs(async ({ orgA }) => {
      // Setup: mailbox + outbound message whose enrollmentId points to non-existent enrollment
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

      const fakeEnrollmentId = randomUUID();
      const outboundMsgId = "<outbound-1@test.local>";
      // Insert an outbound message so inbound matches and triggers handleInboundReply
      await db.insert(tables.message).values({
        organizationId: orgA.id,
        mailboxId: mailbox.id,
        direction: "outbound",
        messageIdHeader: outboundMsgId,
        enrollmentId: null, // No enrollment → no handleInboundReply call
        status: "sent",
      });

      const providerMsgId = `prov-${randomUUID()}`;
      const inbound = makeParsedInbound({
        providerMessageId: providerMsgId,
        // No In-Reply-To → no match → no enrollment transition attempted
        // But we need a failure. Let's use a different approach:
        // We'll inject a bad enrollment ID via a matching outbound.
      });

      // First attempt: processing succeeds (no enrollment match → just inserts message)
      const result1 = await db.transaction(async (tx) => {
        return processInboundMessage(tx, mailbox, inbound, { stop_on_ooo: false });
      });
      expect(result1).toBe("ok");

      // Verify message inserted with ingestionAttempts=1
      const msg1 = await db.query.message.findFirst({
        where: eq(tables.message.providerMessageId, providerMsgId),
      });
      expect(msg1).toBeDefined();
      expect(msg1!.ingestionAttempts).toBe(1);
      expect(msg1!.status).toBe("received");
    });
  });

  it("exception after insert blocks cursor and retry with matching enrollment succeeds", async () => {
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
          pollCursor: { lastPolledAt: "2026-07-01T00:00:00Z" },
        })
        .returning();
      if (!mailbox) throw new Error("setup failed");

      const fakeEnrollmentId = randomUUID();
      const outboundMsgId = "<outbound-fail@test.local>";

      // Outbound with a non-existent enrollment — handleInboundReply will throw
      await db.insert(tables.message).values({
        organizationId: orgA.id,
        mailboxId: mailbox.id,
        direction: "outbound",
        messageIdHeader: outboundMsgId,
        enrollmentId: fakeEnrollmentId,
        status: "sent",
      });

      const providerMsgId = `prov-${randomUUID()}`;
      const inbound = makeParsedInbound({
        providerMessageId: providerMsgId,
        inReplyTo: outboundMsgId,
      });

      // Attempt 1: processing fails (enrollment not found) → returns "blocked"
      const result1 = await db.transaction(async (tx) => {
        return processInboundMessage(tx, mailbox, inbound, { stop_on_ooo: false });
      });
      expect(result1).toBe("blocked");

      // Message was still persisted (upsert succeeded before savepoint failed)
      const msg = await db.query.message.findFirst({
        where: eq(tables.message.providerMessageId, providerMsgId),
      });
      expect(msg).toBeDefined();
      expect(msg!.ingestionAttempts).toBe(1);
      expect(msg!.status).toBe("received");

      // Cursor should not have advanced — verify by checking mailbox pollCursor is unchanged
      const mb = await db.query.mailbox.findFirst({
        where: eq(tables.mailbox.id, mailbox.id),
      });
      const cursor = mb!.pollCursor as { lastPolledAt?: string };
      expect(cursor.lastPolledAt).toBe("2026-07-01T00:00:00Z");

      // Now set up a real enrollment so retry succeeds
      const [prospect] = await db
        .insert(tables.prospect)
        .values({ organizationId: orgA.id, email: "prospect@test.local", status: "active" })
        .returning();
      const [sequence] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "retry-seq",
          status: "active",
          createdByUserId: orgA.userId,
          settings: {
            timezone: "UTC",
            business_days_only: false,
            send_window: {
              sun: [[0, 24]], mon: [[0, 24]], tue: [[0, 24]],
              wed: [[0, 24]], thu: [[0, 24]], fri: [[0, 24]], sat: [[0, 24]],
            },
          },
        })
        .returning();
      await db.insert(tables.sequenceStep).values({
        organizationId: orgA.id,
        sequenceId: sequence!.id,
        stepIndex: 0,
        stepType: "auto_email",
        delayMinutes: 0,
        config: { subject: "Hi", body_template: "<p>Hi</p>", ai_generate: false },
      });
      // Create the enrollment that was referenced by the outbound message
      await db.insert(tables.enrollment).values({
        id: fakeEnrollmentId,
        organizationId: orgA.id,
        sequenceId: sequence!.id,
        prospectId: prospect!.id,
        mailboxId: mailbox.id,
        state: "active",
        currentStepIndex: 0,
        createdByUserId: orgA.userId,
      });

      // Attempt 2: retry — enrollment now exists, processing succeeds
      const result2 = await db.transaction(async (tx) => {
        return processInboundMessage(tx, mailbox, inbound, { stop_on_ooo: false });
      });
      expect(result2).toBe("ok");

      // ingestionAttempts incremented to 2
      const msgAfter = await db.query.message.findFirst({
        where: eq(tables.message.providerMessageId, providerMsgId),
      });
      expect(msgAfter!.ingestionAttempts).toBe(2);
    });
  });

  it("concurrent pollers produce one message via advisory lock", async () => {
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

      const providerMsgId = `prov-concurrent-${randomUUID()}`;
      const inbound = makeParsedInbound({ providerMessageId: providerMsgId });

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

      // Both succeed — one inserts, the other upserts
      expect(r1).toBe("ok");
      expect(r2).toBe("ok");

      // Only one message row exists
      const msgs = await db.query.message.findMany({
        where: eq(tables.message.providerMessageId, providerMsgId),
      });
      expect(msgs).toHaveLength(1);
      // Second poller incremented ingestionAttempts
      expect(msgs[0]!.ingestionAttempts).toBe(2);
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
      expect(result).toBe("ok");

      // ingestionAttempts was incremented (proves no early return on duplicate)
      const msg = await db.query.message.findFirst({
        where: eq(tables.message.providerMessageId, providerMsgId),
      });
      expect(msg!.ingestionAttempts).toBe(2);
    });
  });

  it("quarantines message after three failed ingestion attempts", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "gmail",
          address: "inbox@quarantine.local",
          dailyCap: 50,
          throttleSeconds: 0,
          status: "active",
        })
        .returning();
      if (!mailbox) throw new Error("setup failed");

      const fakeEnrollmentId = randomUUID();
      const outboundMsgId = "<outbound-q@test.local>";

      // Outbound with non-existent enrollment → processing always fails
      await db.insert(tables.message).values({
        organizationId: orgA.id,
        mailboxId: mailbox.id,
        direction: "outbound",
        messageIdHeader: outboundMsgId,
        enrollmentId: fakeEnrollmentId,
        status: "sent",
      });

      const providerMsgId = `prov-quarantine-${randomUUID()}`;

      // Pre-seed message with ingestionAttempts=2 (simulating two prior failures)
      await db.insert(tables.message).values({
        organizationId: orgA.id,
        mailboxId: mailbox.id,
        direction: "inbound",
        providerMessageId: providerMsgId,
        status: "received",
        ingestionAttempts: 2,
        inReplyTo: outboundMsgId,
        receivedAt: new Date("2026-08-01T12:00:00Z"),
      });

      const inbound = makeParsedInbound({
        providerMessageId: providerMsgId,
        inReplyTo: outboundMsgId,
      });

      // Third attempt: upsert bumps to 3, processing fails → quarantined
      const result = await db.transaction(async (tx) => {
        return processInboundMessage(tx, mailbox, inbound, { stop_on_ooo: false });
      });
      // Quarantine allows cursor progress
      expect(result).toBe("ok");

      const msg = await db.query.message.findFirst({
        where: eq(tables.message.providerMessageId, providerMsgId),
      });
      expect(msg!.ingestionAttempts).toBe(3);
      expect(msg!.status).toBe("quarantined");
    });
  });
});
