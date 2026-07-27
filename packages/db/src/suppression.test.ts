import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./client.ts";
import * as tables from "./schema/index.ts";
import { isSendSuppressed } from "./suppression.ts";
import { truncateAppTables, withTestOrgs } from "./testing.ts";

/**
 * Guards the rule that every outbound path shares: the sequence engine, manual
 * compose, and inbox replies must all refuse a suppressed recipient. Before
 * this guard existed the two manual paths sent anyway.
 */
describe("isSendSuppressed", () => {
  beforeEach(async () => {
    await truncateAppTables();
  });

  it("blocks an address on the org suppression list", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      await db.insert(tables.suppression).values({
        organizationId: orgA.id,
        valueType: "email",
        value: "gone@example.com",
        reason: "unsubscribe",
      });

      expect(await isSendSuppressed({ organizationId: orgA.id, email: "gone@example.com" })).toBe(
        true,
      );
      // Suppression is per-tenant: org B never suppressed this address.
      expect(await isSendSuppressed({ organizationId: orgB.id, email: "gone@example.com" })).toBe(
        false,
      );
    });
  });

  it("blocks the whole domain when a domain rule is listed", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db.insert(tables.suppression).values({
        organizationId: orgA.id,
        valueType: "domain",
        value: "blocked.com",
        reason: "manual",
      });

      expect(await isSendSuppressed({ organizationId: orgA.id, email: "anyone@blocked.com" })).toBe(
        true,
      );
      expect(await isSendSuppressed({ organizationId: orgA.id, email: "ok@allowed.com" })).toBe(
        false,
      );
    });
  });

  it("matches case-insensitively", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db.insert(tables.suppression).values({
        organizationId: orgA.id,
        valueType: "email",
        value: "mixed@example.com",
        reason: "unsubscribe",
      });

      expect(await isSendSuppressed({ organizationId: orgA.id, email: "MiXeD@Example.COM" })).toBe(
        true,
      );
    });
  });

  it("blocks on prospect status even with an empty suppression list", async () => {
    await withTestOrgs(async ({ orgA }) => {
      for (const status of ["unsubscribed", "do_not_contact", "bounced"]) {
        expect(
          await isSendSuppressed({
            organizationId: orgA.id,
            email: "someone@example.com",
            prospectStatus: status,
          }),
        ).toBe(true);
      }

      expect(
        await isSendSuppressed({
          organizationId: orgA.id,
          email: "someone@example.com",
          prospectStatus: "active",
        }),
      ).toBe(false);
    });
  });
});
