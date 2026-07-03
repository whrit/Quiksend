import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";
import { refreshDeliverabilitySnapshot } from "./deliverability-snapshot.ts";

describe("refreshDeliverabilitySnapshot", () => {
  it("upserts snapshots with window_days column for 7/14/30 day windows", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const member = await db.query.member.findFirst({
        where: eq(tables.member.organizationId, orgA.id),
      });
      if (!member) throw new Error("member missing");

      const mailboxRows = await db.execute<{ id: string }>(sql`
        INSERT INTO mailbox (
          organization_id, owner_user_id, provider, address, status
        )
        VALUES (${orgA.id}, ${member.userId}, 'smtp', ${`snap-${Date.now()}@test.local`}, 'active')
        RETURNING id
      `);
      const mailboxId = mailboxRows[0]?.id;
      if (!mailboxId) throw new Error("mailbox fixture missing");

      const seedRows = await db.execute<{ id: string }>(sql`
        INSERT INTO seed_inbox (email, gateway, provider, imap_config, active)
        VALUES (${`seed-snap-${Date.now()}@test.local`}, 'proofpoint', 'test', 'enc', true)
        RETURNING id
      `);
      const seedId = seedRows[0]?.id;
      if (!seedId) throw new Error("seed fixture missing");

      const sequenceRows = await db.execute<{ id: string }>(sql`
        INSERT INTO sequence (organization_id, name, status, created_by_user_id)
        VALUES (${orgA.id}, 'snap-seq', 'active', ${member.userId})
        RETURNING id
      `);
      const sequenceId = sequenceRows[0]?.id;
      if (!sequenceId) throw new Error("sequence fixture missing");

      await db.execute(sql`
        INSERT INTO canary_send (
          organization_id, sequence_id, mailbox_id, seed_inbox_id,
          canary_token, subject, sent_at, arrival_status
        )
        VALUES (
          ${orgA.id}, ${sequenceId}, ${mailboxId}, ${seedId},
          gen_random_uuid(), 'snap test', now() - interval '2 days', 'arrived_inbox'
        )
      `);

      await refreshDeliverabilitySnapshot(7);
      await refreshDeliverabilitySnapshot(14);

      const rows = await db.execute<{ window_days: number; canary_total: string }>(sql`
        SELECT window_days, canary_total
        FROM deliverability_snapshot
        WHERE organization_id = ${orgA.id}
          AND mailbox_id = ${mailboxId}
          AND gateway = 'proofpoint'
        ORDER BY window_days
      `);

      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.some((r) => Number(r.window_days) === 7)).toBe(true);
      expect(rows.some((r) => Number(r.window_days) === 14)).toBe(true);
      expect(rows.every((r) => Number(r.canary_total) >= 1)).toBe(true);
    });
  });
});
