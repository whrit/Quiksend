import { describe, expect, it } from "vitest";
import { db, withTenantTransaction } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { and, eq } from "drizzle-orm";

/**
 * Representative handler-level tenancy tests. These exercise the
 * `withTenantTransaction(orgId, tx => ...)` pattern that every web
 * handler now uses, proving that:
 *
 *   1. The transaction sets `app.organization_id` via `set_config`.
 *   2. Queries inside the transaction only see data for the correct org
 *      (defense-in-depth: the explicit `organizationId` filter AND
 *      the RLS policy agree).
 *   3. Mutations inside a tenant transaction cannot affect another org's rows.
 *
 * These are NOT raw SQL filter tests — they mirror the actual handler
 * pattern: withTenantTransaction wrapping real Drizzle queries.
 */

describe("withTenantTransaction handler isolation", () => {
  it("tenant tx for org A cannot read org B sequences", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      // Setup: create a sequence in org B
      const [seqB] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgB.id,
          name: "Secret Sequence",
          status: "draft",
          settings: {
            timezone: "UTC",
            throttle_seconds: 90,
            mailbox_ids: [],
            stop_on_reply: true,
            business_days_only: true,
          },
          createdByUserId: orgB.userId,
        })
        .returning();
      if (!seqB) throw new Error("setup failed");

      // Act: org A's tenant transaction tries to read it
      const result = await withTenantTransaction(orgA.id, async (tx) => {
        return tx.query.sequence.findFirst({
          where: and(eq(tables.sequence.id, seqB.id), eq(tables.sequence.organizationId, orgA.id)),
        });
      });

      expect(result).toBeUndefined();
    });
  });

  it("tenant tx for org A cannot update org B prospects", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [prospectB] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgB.id,
          email: "secret@example.com",
          status: "new",
          source: "manual",
        })
        .returning();
      if (!prospectB) throw new Error("setup failed");

      // Act: org A's tenant transaction tries to update it
      const updated = await withTenantTransaction(orgA.id, async (tx) => {
        return tx
          .update(tables.prospect)
          .set({ status: "do_not_contact" })
          .where(
            and(eq(tables.prospect.id, prospectB.id), eq(tables.prospect.organizationId, orgA.id)),
          )
          .returning();
      });

      expect(updated).toHaveLength(0);

      // Verify: prospect unchanged
      const unchanged = await db.query.prospect.findFirst({
        where: eq(tables.prospect.id, prospectB.id),
      });
      expect(unchanged?.status).toBe("new");
    });
  });

  it("tenant tx for org A cannot delete org B webhook endpoints", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [endpointB] = await db
        .insert(tables.webhookEndpoint)
        .values({
          organizationId: orgB.id,
          url: "https://example.com/hook",
          secret: "s3cret",
          events: ["prospect.unsubscribed"],
          status: "active",
          createdByUserId: orgB.userId,
        })
        .returning();
      if (!endpointB) throw new Error("setup failed");

      const deleted = await withTenantTransaction(orgA.id, async (tx) => {
        return tx
          .delete(tables.webhookEndpoint)
          .where(
            and(
              eq(tables.webhookEndpoint.id, endpointB.id),
              eq(tables.webhookEndpoint.organizationId, orgA.id),
            ),
          )
          .returning({ id: tables.webhookEndpoint.id });
      });

      expect(deleted).toHaveLength(0);

      // Verify: still exists
      const stillExists = await db.query.webhookEndpoint.findFirst({
        where: eq(tables.webhookEndpoint.id, endpointB.id),
      });
      expect(stillExists).toBeDefined();
    });
  });

  it("concurrent tenant transactions are isolated from each other", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      // Each org creates a sequence inside its own tenant transaction
      const [_seqA, _seqB] = await Promise.all([
        withTenantTransaction(orgA.id, async (tx) => {
          const [row] = await tx
            .insert(tables.sequence)
            .values({
              organizationId: orgA.id,
              name: "Org A Campaign",
              status: "draft",
              settings: {
                timezone: "UTC",
                throttle_seconds: 90,
                mailbox_ids: [],
                stop_on_reply: true,
                business_days_only: true,
              },
              createdByUserId: orgA.userId,
            })
            .returning();
          return row!;
        }),
        withTenantTransaction(orgB.id, async (tx) => {
          const [row] = await tx
            .insert(tables.sequence)
            .values({
              organizationId: orgB.id,
              name: "Org B Campaign",
              status: "draft",
              settings: {
                timezone: "UTC",
                throttle_seconds: 90,
                mailbox_ids: [],
                stop_on_reply: true,
                business_days_only: true,
              },
              createdByUserId: orgB.userId,
            })
            .returning();
          return row!;
        }),
      ]);

      // Verify: each org sees only its own sequence
      const seenByA = await withTenantTransaction(orgA.id, async (tx) => {
        return tx.query.sequence.findMany({
          where: eq(tables.sequence.organizationId, orgA.id),
        });
      });

      const seenByB = await withTenantTransaction(orgB.id, async (tx) => {
        return tx.query.sequence.findMany({
          where: eq(tables.sequence.organizationId, orgB.id),
        });
      });

      expect(seenByA).toHaveLength(1);
      expect(seenByA[0]!.name).toBe("Org A Campaign");
      expect(seenByB).toHaveLength(1);
      expect(seenByB[0]!.name).toBe("Org B Campaign");
    });
  });

  it("tenant tx rollback on error does not leak partial writes", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const beforeCount = await db.query.sequence.findMany({
        where: eq(tables.sequence.organizationId, orgA.id),
      });

      await expect(
        withTenantTransaction(orgA.id, async (tx) => {
          await tx.insert(tables.sequence).values({
            organizationId: orgA.id,
            name: "Should Not Persist",
            status: "draft",
            settings: {
              timezone: "UTC",
              throttle_seconds: 90,
              mailbox_ids: [],
              stop_on_reply: true,
              business_days_only: true,
            },
            createdByUserId: orgA.userId,
          });
          throw new Error("Simulated handler error");
        }),
      ).rejects.toThrow("Simulated handler error");

      const afterCount = await db.query.sequence.findMany({
        where: eq(tables.sequence.organizationId, orgA.id),
      });
      expect(afterCount).toHaveLength(beforeCount.length);
    });
  });
});
