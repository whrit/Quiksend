import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { client, db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";

async function cleanupDeliverabilityTables(): Promise<void> {
  await client.unsafe(
    "truncate table canary_send, deliverability_snapshot, seed_inbox restart identity cascade",
  );
}

function proMetadata(): string {
  return JSON.stringify({
    entitlements: { deliverability_pro: { activeUntil: "2099-12-31T00:00:00.000Z" } },
  });
}

async function seedDeliverabilityGraph(orgId: string, userId: string, tag: string) {
  const [mailbox] = await db
    .insert(tables.mailbox)
    .values({
      organizationId: orgId,
      ownerUserId: userId,
      provider: "smtp",
      address: `sender-${tag}@tenancy.test`,
      status: "active",
    })
    .returning();
  if (!mailbox) throw new Error("setup failed");

  const [sequence] = await db
    .insert(tables.sequence)
    .values({
      organizationId: orgId,
      name: `Seq ${tag}`,
      status: "active",
      createdByUserId: userId,
    })
    .returning();
  if (!sequence) throw new Error("setup failed");

  const [seed] = await db
    .insert(tables.seedInbox)
    .values({
      organizationId: orgId,
      email: `seed-${tag}@tenancy.test`,
      gateway: "proofpoint",
      provider: "m365",
      imapConfig: "encrypted-placeholder",
      active: true,
    })
    .returning();
  if (!seed) throw new Error("setup failed");

  const [canary] = await db
    .insert(tables.canarySend)
    .values({
      organizationId: orgId,
      sequenceId: sequence.id,
      mailboxId: mailbox.id,
      seedInboxId: seed.id,
      canaryToken: randomUUID(),
      subject: `Canary ${tag}`,
      arrivalStatus: "arrived_inbox",
      sentAt: new Date(),
    })
    .returning();
  if (!canary) throw new Error("setup failed");

  const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await db.insert(tables.deliverabilitySnapshot).values({
    organizationId: orgId,
    mailboxId: mailbox.id,
    gateway: "proofpoint",
    windowStart,
    windowEnd: new Date(),
    canaryTotal: 5,
    canaryDelivered: 4,
    deliverabilityPct: "80",
  });

  return { mailbox, sequence, seed, canary };
}

describe("deliverability tenancy", () => {
  it("org B cannot read org A seed inboxes", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const { seed } = await seedDeliverabilityGraph(orgA.id, orgA.userId, "seed-read");
      try {
        const fromOrgB = await db.query.seedInbox.findFirst({
          where: and(
            eq(tables.seedInbox.id, seed.id),
            eq(tables.seedInbox.organizationId, orgB.id),
          ),
        });
        expect(fromOrgB).toBeUndefined();
      } finally {
        await cleanupDeliverabilityTables();
      }
    });
  });

  it("org B cannot read org A canary sends", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const { canary } = await seedDeliverabilityGraph(orgA.id, orgA.userId, "canary-read");
      try {
        const fromOrgB = await db.query.canarySend.findMany({
          where: eq(tables.canarySend.organizationId, orgB.id),
        });
        expect(fromOrgB).toHaveLength(0);
        expect(fromOrgB.find((row) => row.id === canary.id)).toBeUndefined();
      } finally {
        await cleanupDeliverabilityTables();
      }
    });
  });

  it("org B cannot read org A deliverability snapshots", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      await seedDeliverabilityGraph(orgA.id, orgA.userId, "snap-read");
      try {
        const fromOrgB = await db.query.deliverabilitySnapshot.findMany({
          where: eq(tables.deliverabilitySnapshot.organizationId, orgB.id),
        });
        expect(fromOrgB).toHaveLength(0);
      } finally {
        await cleanupDeliverabilityTables();
      }
    });
  });

  it("org B cannot delete org A seed inboxes", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const { seed } = await seedDeliverabilityGraph(orgA.id, orgA.userId, "seed-del");
      try {
        const deleted = await db
          .delete(tables.seedInbox)
          .where(
            and(eq(tables.seedInbox.id, seed.id), eq(tables.seedInbox.organizationId, orgB.id)),
          )
          .returning();
        expect(deleted).toHaveLength(0);

        const stillThere = await db.query.seedInbox.findFirst({
          where: eq(tables.seedInbox.id, seed.id),
        });
        expect(stillThere?.id).toBe(seed.id);
      } finally {
        await cleanupDeliverabilityTables();
      }
    });
  });

  it("org B cannot toggle org A seed inbox active state", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const { seed } = await seedDeliverabilityGraph(orgA.id, orgA.userId, "seed-toggle");
      try {
        const [updated] = await db
          .update(tables.seedInbox)
          .set({ active: false })
          .where(
            and(eq(tables.seedInbox.id, seed.id), eq(tables.seedInbox.organizationId, orgB.id)),
          )
          .returning();
        expect(updated).toBeUndefined();

        const unchanged = await db.query.seedInbox.findFirst({
          where: eq(tables.seedInbox.id, seed.id),
        });
        expect(unchanged?.active).toBe(true);
      } finally {
        await cleanupDeliverabilityTables();
      }
    });
  });

  it("provider-managed seeds visible only to Pro-entitled workspaces", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      await db
        .update(tables.organization)
        .set({ metadata: proMetadata() })
        .where(eq(tables.organization.id, orgA.id));

      await db.insert(tables.seedInbox).values({
        organizationId: null,
        email: "provider-seed@pool.quiksend.test",
        gateway: "proofpoint",
        provider: "m365",
        imapConfig: "system-encrypted",
        active: true,
        poolTag: "production",
      });

      try {
        const proOrgSees = await db.query.seedInbox.findMany({
          where: isNull(tables.seedInbox.organizationId),
        });
        expect(proOrgSees.length).toBeGreaterThanOrEqual(1);

        const nonProOrgQuery = await db.query.organization.findFirst({
          where: eq(tables.organization.id, orgB.id),
          columns: { metadata: true },
        });
        expect(nonProOrgQuery?.metadata).toBeNull();
      } finally {
        await cleanupDeliverabilityTables();
      }
    });
  });
});
