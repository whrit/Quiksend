import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { resolvePostalAddress, ComplianceConfigurationError } from "@quiksend/mail";

describe("organization compliance – postal address", () => {
  it("reads postal_address from organization metadata", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db
        .update(tables.organization)
        .set({ metadata: JSON.stringify({ postal_address: "742 Evergreen Terrace, Springfield" }) })
        .where(eq(tables.organization.id, orgA.id));

      const org = await db.query.organization.findFirst({
        where: eq(tables.organization.id, orgA.id),
        columns: { metadata: true },
      });

      const address = resolvePostalAddress({
        organizationId: orgA.id,
        metadata: org?.metadata ?? null,
      });
      expect(address).toBe("742 Evergreen Terrace, Springfield");
    });
  });

  it("throws ComplianceConfigurationError for workspace without postal address", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const org = await db.query.organization.findFirst({
        where: eq(tables.organization.id, orgA.id),
        columns: { metadata: true },
      });
      expect(org?.metadata).toBeNull();

      expect(() =>
        resolvePostalAddress({ organizationId: orgA.id, metadata: org?.metadata ?? null }),
      ).toThrow(ComplianceConfigurationError);
    });
  });

  it("persists postal_address without clobbering other metadata", async () => {
    await withTestOrgs(async ({ orgA }) => {
      // Set initial metadata with entitlements
      await db
        .update(tables.organization)
        .set({
          metadata: JSON.stringify({
            entitlements: { deliverability_pro: { activeUntil: "2099-12-31" } },
          }),
        })
        .where(eq(tables.organization.id, orgA.id));

      // Merge postal_address
      const raw = await db.query.organization.findFirst({
        where: eq(tables.organization.id, orgA.id),
        columns: { metadata: true },
      });
      const existing =
        typeof raw?.metadata === "string"
          ? (JSON.parse(raw.metadata) as Record<string, unknown>)
          : {};
      const next = { ...existing, postal_address: "100 Main St, Boston, MA 02101" };
      await db
        .update(tables.organization)
        .set({ metadata: JSON.stringify(next) })
        .where(eq(tables.organization.id, orgA.id));

      // Verify both fields survive
      const updated = await db.query.organization.findFirst({
        where: eq(tables.organization.id, orgA.id),
        columns: { metadata: true },
      });
      const parsed = JSON.parse(updated!.metadata!) as Record<string, unknown>;
      expect(parsed.postal_address).toBe("100 Main St, Boston, MA 02101");
      expect(parsed.entitlements).toBeDefined();

      // Resolver works
      const address = resolvePostalAddress({
        organizationId: orgA.id,
        metadata: updated!.metadata,
      });
      expect(address).toBe("100 Main St, Boston, MA 02101");
    });
  });

  it("scopes postal_address to the correct organization", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      await db
        .update(tables.organization)
        .set({ metadata: JSON.stringify({ postal_address: "Org A Address" }) })
        .where(eq(tables.organization.id, orgA.id));

      // orgB has no address
      const orgBRow = await db.query.organization.findFirst({
        where: eq(tables.organization.id, orgB.id),
        columns: { metadata: true },
      });
      expect(() =>
        resolvePostalAddress({ organizationId: orgB.id, metadata: orgBRow?.metadata ?? null }),
      ).toThrow(ComplianceConfigurationError);

      // orgA has address
      const orgARow = await db.query.organization.findFirst({
        where: eq(tables.organization.id, orgA.id),
        columns: { metadata: true },
      });
      expect(
        resolvePostalAddress({ organizationId: orgA.id, metadata: orgARow?.metadata ?? null }),
      ).toBe("Org A Address");
    });
  });
});
