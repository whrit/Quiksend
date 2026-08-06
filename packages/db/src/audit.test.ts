import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listAuditLog, recordAudit, redactAuditMetadata } from "./audit.ts";
import { db } from "./client.ts";
import * as tables from "./schema/index.ts";
import { truncateAppTables, withTestOrgs } from "./testing.ts";

describe("redactAuditMetadata", () => {
  it("strips secret-shaped keys but keeps safe fields", () => {
    const redacted = redactAuditMetadata({
      name: "Prod key",
      password: "hunter2",
      apiKey: "qsk_live_abc123",
      smtpConfig: { host: "smtp.example.com", pass: "secret" },
      accessToken: "abc.def.ghi",
    });

    expect(redacted).toEqual({
      name: "Prod key",
      password: "[redacted]",
      apiKey: "[redacted]",
      smtpConfig: "[redacted]",
      accessToken: "[redacted]",
    });
  });

  it("returns null for empty input", () => {
    expect(redactAuditMetadata(null)).toBeNull();
    expect(redactAuditMetadata(undefined)).toBeNull();
  });

  it("bounds oversized metadata instead of storing it unbounded", () => {
    const huge = { blob: "x".repeat(10_000) };
    const redacted = redactAuditMetadata(huge);
    expect(redacted).toEqual({ truncated: true, keys: ["blob"] });
  });
});

describe("recordAudit / listAuditLog", () => {
  beforeEach(async () => {
    await truncateAppTables();
  });

  it("writes a redacted, organization-scoped row", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await recordAudit({
        organizationId: orgA.id,
        actorType: "user",
        actorId: orgA.userId,
        action: "api_key.create",
        entityType: "api_key",
        entityId: "key_123",
        metadata: { name: "CI key", key: "qsk_live_should_not_persist" },
      });

      const rows = await listAuditLog({ organizationId: orgA.id });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        organizationId: orgA.id,
        actorType: "user",
        actorId: orgA.userId,
        action: "api_key.create",
        entityType: "api_key",
        entityId: "key_123",
      });
      expect(rows[0]!.metadata).toEqual({ name: "CI key", key: "[redacted]" });
    });
  });

  it("is append-only across concurrent-looking writes and never touched by callers", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await recordAudit({
        organizationId: orgA.id,
        actorType: "system",
        action: "organization.purge_completed",
        entityType: "organization",
        entityId: orgA.id,
      });
      const before = await listAuditLog({ organizationId: orgA.id });
      expect(before).toHaveLength(1);

      // No update/delete API exists on the module — the only way rows change
      // is another insert. Confirm a second privileged mutation appends
      // rather than mutating the first row.
      await recordAudit({
        organizationId: orgA.id,
        actorType: "user",
        actorId: orgA.userId,
        action: "mailbox.delete",
        entityType: "mailbox",
        entityId: "mailbox_1",
      });
      const after = await listAuditLog({ organizationId: orgA.id });
      expect(after).toHaveLength(2);
      expect(after.map((r) => r.id)).toContain(before[0]!.id);
    });
  });

  it("scopes reads to the caller's organization — org B never sees org A's audit trail", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      await recordAudit({
        organizationId: orgA.id,
        actorType: "user",
        actorId: orgA.userId,
        action: "organization.delete_requested",
        entityType: "organization",
        entityId: orgA.id,
      });

      expect(await listAuditLog({ organizationId: orgA.id })).toHaveLength(1);
      expect(await listAuditLog({ organizationId: orgB.id })).toHaveLength(0);
    });
  });

  it("paginates newest-first with a keyset cursor", async () => {
    await withTestOrgs(async ({ orgA }) => {
      for (let i = 0; i < 3; i++) {
        await recordAudit({
          organizationId: orgA.id,
          actorType: "system",
          action: `event.${i}`,
          entityType: "test",
        });
      }

      const page1 = await listAuditLog({ organizationId: orgA.id, limit: 2 });
      expect(page1).toHaveLength(2);
      const last = page1.at(-1)!;
      const page2 = await listAuditLog({
        organizationId: orgA.id,
        limit: 2,
        before: { id: last.id, createdAt: last.createdAt },
      });
      expect(page2.length).toBeGreaterThanOrEqual(1);
      const seenIds = new Set([...page1, ...page2].map((r) => r.id));
      expect(seenIds.size).toBe(page1.length + page2.length);
    });
  });
});

describe("audit_log schema", () => {
  beforeEach(async () => {
    await truncateAppTables();
  });

  it("cascades delete with its organization (no orphaned rows)", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await recordAudit({
        organizationId: orgA.id,
        actorType: "user",
        actorId: orgA.userId,
        action: "invitation.create",
        entityType: "invitation",
        entityId: "inv_1",
      });
      expect(await listAuditLog({ organizationId: orgA.id })).toHaveLength(1);

      await db.delete(tables.organization).where(eq(tables.organization.id, orgA.id));
      expect(await listAuditLog({ organizationId: orgA.id })).toHaveLength(0);
    });
  });
});
