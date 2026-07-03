import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";

describe("deliverability snapshot rollup math", () => {
  it("computes deliverability_pct from mixed canary_send arrival_status rows", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const userId = orgA.userId;
      const now = new Date();

      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: userId,
          provider: "smtp",
          address: `mb-${randomUUID().slice(0, 6)}@test.local`,
          dailyCap: 50,
          throttleSeconds: 0,
          sendWindow: {
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
          },
          status: "active",
        })
        .returning();

      const [sequence] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "Snapshot test",
          status: "active",
          settings: { timezone: "UTC", throttle_seconds: 0, mailbox_ids: [mailbox!.id] },
          createdByUserId: userId,
        })
        .returning();

      const [seed] = await db
        .insert(tables.seedInbox)
        .values({
          organizationId: orgA.id,
          email: `seed-${randomUUID().slice(0, 6)}@test.local`,
          gateway: "proofpoint",
          provider: "google_workspace",
          imapConfig: "cipher-placeholder",
          active: true,
        })
        .returning();

      const statuses = [
        "arrived_inbox",
        "arrived_inbox",
        "arrived_spam",
        "silent_drop",
        "arrived_quarantine",
      ] as const;

      for (const status of statuses) {
        await db.insert(tables.canarySend).values({
          organizationId: orgA.id,
          sequenceId: sequence!.id,
          mailboxId: mailbox!.id,
          seedInboxId: seed!.id,
          canaryToken: randomUUID(),
          subject: "Canary",
          sentAt: now,
          expectedArrivalAt: now,
          arrivalStatus: status,
          arrivedAt: now,
        });
      }

      const [rollup] = await db.execute<{
        canary_total: number;
        canary_delivered: number;
        canary_spam: number;
        canary_quarantine: number;
        canary_silent_dropped: number;
        deliverability_pct: string;
      }>(sql`
        SELECT
          count(*)::int AS canary_total,
          count(*) FILTER (WHERE cs.arrival_status = 'arrived_inbox')::int AS canary_delivered,
          count(*) FILTER (WHERE cs.arrival_status = 'arrived_spam')::int AS canary_spam,
          count(*) FILTER (WHERE cs.arrival_status = 'arrived_quarantine')::int AS canary_quarantine,
          count(*) FILTER (WHERE cs.arrival_status IN ('silent_drop', 'bounced'))::int AS canary_silent_dropped,
          round(
            100.0 * count(*) FILTER (WHERE cs.arrival_status = 'arrived_inbox') / nullif(count(*), 0),
            2
          )::text AS deliverability_pct
        FROM canary_send cs
        WHERE cs.organization_id = ${orgA.id}
          AND cs.arrival_status <> 'pending'
      `);

      expect(Number(rollup?.canary_total)).toBe(5);
      expect(Number(rollup?.canary_delivered)).toBe(2);
      expect(Number(rollup?.canary_spam)).toBe(1);
      expect(Number(rollup?.canary_quarantine)).toBe(1);
      expect(Number(rollup?.canary_silent_dropped)).toBe(1);
      expect(Number(rollup?.deliverability_pct)).toBe(40);
    });
  });
});
