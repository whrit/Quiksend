import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";
import { refreshDeliverabilitySnapshots } from "./deliverability-snapshot.ts";
import { maybePauseCampaigns, runCanaryCheck } from "./canary-check.ts";

vi.mock("./deliverability-snapshot.ts", () => ({
  refreshDeliverabilitySnapshots: vi.fn<() => Promise<void>>(async () => undefined),
}));

const MOCK_IMAP_CONFIG = "mock-imap-config-ciphertext";

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

async function seedCanaryFixture(orgId: string, userId: string, count = 5) {
  const [mailbox] = await db
    .insert(tables.mailbox)
    .values({
      organizationId: orgId,
      ownerUserId: userId,
      provider: "smtp",
      address: `mb-${randomUUID().slice(0, 6)}@test.local`,
      dailyCap: 50,
      throttleSeconds: 0,
      sendWindow: WIDE_WINDOW,
      status: "active",
    })
    .returning();

  const [sequence] = await db
    .insert(tables.sequence)
    .values({
      organizationId: orgId,
      name: `Canary seq ${randomUUID().slice(0, 4)}`,
      status: "active",
      settings: { mailbox_ids: [mailbox!.id] },
      createdByUserId: userId,
      canaryConfig: { pauseThresholdPct: 80 },
    })
    .returning();

  const [seedInbox] = await db
    .insert(tables.seedInbox)
    .values({
      organizationId: orgId,
      email: `seed-${randomUUID().slice(0, 6)}@proofpoint.test`,
      gateway: "proofpoint",
      provider: "test",
      imapConfig: MOCK_IMAP_CONFIG,
      active: true,
      verifiedAt: new Date(),
    })
    .returning();

  const sentAt = new Date();
  const expectedArrivalAt = new Date(sentAt.getTime() - 5 * 60 * 1000);

  const canaryIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const [row] = await db
      .insert(tables.canarySend)
      .values({
        organizationId: orgId,
        sequenceId: sequence!.id,
        mailboxId: mailbox!.id,
        seedInboxId: seedInbox!.id,
        canaryToken: randomUUID(),
        subject: `Canary ${i}`,
        sentAt,
        expectedArrivalAt,
        arrivalStatus: "pending",
      })
      .returning({ id: tables.canarySend.id });
    canaryIds.push(row!.id);
  }

  return {
    mailboxId: mailbox!.id,
    sequenceId: sequence!.id,
    seedInboxId: seedInbox!.id,
    canaryIds,
  };
}

describe("runCanaryCheck", () => {
  const previousMock = process.env.QUIKSEND_CANARY_IMAP_MOCK;

  beforeEach(() => {
    delete process.env.QUIKSEND_CANARY_IMAP_MOCK;
    vi.mocked(refreshDeliverabilitySnapshots).mockClear();
  });

  afterEach(() => {
    if (previousMock === undefined) {
      delete process.env.QUIKSEND_CANARY_IMAP_MOCK;
    } else {
      process.env.QUIKSEND_CANARY_IMAP_MOCK = previousMock;
    }
  });

  it("marks org canaries arrived_inbox when IMAP mock reports inbox", async () => {
    process.env.QUIKSEND_CANARY_IMAP_MOCK = "inbox";
    await withTestOrgs(async ({ orgA }) => {
      const fixture = await seedCanaryFixture(orgA.id, orgA.userId, 5);
      await runCanaryCheck();

      const rows = await db.query.canarySend.findMany({
        where: eq(tables.canarySend.organizationId, orgA.id),
      });
      expect(rows.every((r) => r.arrivalStatus === "arrived_inbox")).toBe(true);
      expect(fixture.canaryIds.length).toBe(5);
    });
  });

  it("marks canaries arrived_spam when IMAP mock reports spam", async () => {
    process.env.QUIKSEND_CANARY_IMAP_MOCK = "spam";
    await withTestOrgs(async ({ orgA }) => {
      await seedCanaryFixture(orgA.id, orgA.userId, 3);
      await runCanaryCheck();

      const rows = await db.query.canarySend.findMany({
        where: eq(tables.canarySend.organizationId, orgA.id),
      });
      expect(rows.every((r) => r.arrivalStatus === "arrived_spam")).toBe(true);
    });
  });

  it("marks canaries bounced when IMAP mock reports bounce", async () => {
    process.env.QUIKSEND_CANARY_IMAP_MOCK = "bounce";
    await withTestOrgs(async ({ orgA }) => {
      await seedCanaryFixture(orgA.id, orgA.userId, 2);
      await runCanaryCheck();

      const rows = await db.query.canarySend.findMany({
        where: eq(tables.canarySend.organizationId, orgA.id),
      });
      expect(rows.every((r) => r.arrivalStatus === "bounced")).toBe(true);
    });
  });

  it("sweeps stale pending canaries to silent_drop", async () => {
    process.env.QUIKSEND_CANARY_IMAP_MOCK = "not_found";
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: `old-${randomUUID().slice(0, 6)}@test.local`,
          dailyCap: 50,
          throttleSeconds: 0,
          sendWindow: WIDE_WINDOW,
          status: "active",
        })
        .returning();
      const [sequence] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "Old canary",
          status: "active",
          settings: { mailbox_ids: [mailbox!.id] },
          createdByUserId: orgA.userId,
        })
        .returning();
      const [seedInbox] = await db
        .insert(tables.seedInbox)
        .values({
          organizationId: orgA.id,
          email: `old-seed-${randomUUID().slice(0, 6)}@proofpoint.test`,
          gateway: "proofpoint",
          provider: "test",
          imapConfig: MOCK_IMAP_CONFIG,
          active: true,
        })
        .returning();

      const oldSentAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await db.insert(tables.canarySend).values({
        organizationId: orgA.id,
        sequenceId: sequence!.id,
        mailboxId: mailbox!.id,
        seedInboxId: seedInbox!.id,
        canaryToken: randomUUID(),
        subject: "stale",
        sentAt: oldSentAt,
        expectedArrivalAt: new Date(oldSentAt.getTime() + 15 * 60 * 1000),
        arrivalStatus: "pending",
      });

      await runCanaryCheck();
      const row = await db.query.canarySend.findFirst({
        where: eq(tables.canarySend.organizationId, orgA.id),
      });
      expect(row?.arrivalStatus).toBe("silent_drop");
    });
  });

  it("refreshes deliverability_snapshot rows after check", async () => {
    process.env.QUIKSEND_CANARY_IMAP_MOCK = "inbox";
    await withTestOrgs(async ({ orgA }) => {
      await seedCanaryFixture(orgA.id, orgA.userId, 3);
      await runCanaryCheck();
      expect(refreshDeliverabilitySnapshots).toHaveBeenCalled();
    });
  });

  it("auto-pauses campaigns when threshold is breached", async () => {
    process.env.QUIKSEND_CANARY_IMAP_MOCK = "spam";
    await withTestOrgs(async ({ orgA }) => {
      const fixture = await seedCanaryFixture(orgA.id, orgA.userId, 5);

      const [prospect] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgA.id,
          email: `p-${randomUUID().slice(0, 6)}@seg.test`,
          emailGateway: "proofpoint",
        })
        .returning();

      await db.insert(tables.enrollment).values({
        organizationId: orgA.id,
        sequenceId: fixture.sequenceId,
        prospectId: prospect!.id,
        mailboxId: fixture.mailboxId,
        state: "active",
        createdByUserId: orgA.userId,
      });

      await runCanaryCheck();
      await maybePauseCampaigns();

      const enrollment = await db.query.enrollment.findFirst({
        where: eq(tables.enrollment.organizationId, orgA.id),
      });
      expect(enrollment?.state).toBe("paused");
    });
  });

  it("isolates canary results between two orgs", async () => {
    process.env.QUIKSEND_CANARY_IMAP_MOCK = "inbox";
    await withTestOrgs(async ({ orgA, orgB }) => {
      await seedCanaryFixture(orgA.id, orgA.userId, 2);
      await seedCanaryFixture(orgB.id, orgB.userId, 2);
      await runCanaryCheck();

      const rowsA = await db.query.canarySend.findMany({
        where: eq(tables.canarySend.organizationId, orgA.id),
      });
      const rowsB = await db.query.canarySend.findMany({
        where: eq(tables.canarySend.organizationId, orgB.id),
      });
      expect(rowsA.every((r) => r.arrivalStatus === "arrived_inbox")).toBe(true);
      expect(rowsB.every((r) => r.arrivalStatus === "arrived_inbox")).toBe(true);
    });
  });
});
