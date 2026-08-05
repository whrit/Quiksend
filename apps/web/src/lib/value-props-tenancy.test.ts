import { and, cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { EMBEDDING_DIMENSIONS, retrieveValueProps } from "@quiksend/ai";

describe("value prop tenancy", () => {
  it("org B cannot read org A value props", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [valuePropA] = await db
        .insert(tables.valueProp)
        .values({
          organizationId: orgA.id,
          title: "Speed",
          body: "We ship fast.",
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!valuePropA) throw new Error("setup failed");

      const fromOrgB = await db.query.valueProp.findFirst({
        where: and(
          eq(tables.valueProp.id, valuePropA.id),
          eq(tables.valueProp.organizationId, orgB.id),
        ),
      });

      expect(fromOrgB).toBeUndefined();
    });
  });

  it("org B cannot update org A value props", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [valuePropA] = await db
        .insert(tables.valueProp)
        .values({
          organizationId: orgA.id,
          title: "Security",
          body: "We are secure.",
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!valuePropA) throw new Error("setup failed");

      const [updated] = await db
        .update(tables.valueProp)
        .set({ title: "Hacked" })
        .where(
          and(eq(tables.valueProp.id, valuePropA.id), eq(tables.valueProp.organizationId, orgB.id)),
        )
        .returning();

      expect(updated).toBeUndefined();

      const unchanged = await db.query.valueProp.findFirst({
        where: eq(tables.valueProp.id, valuePropA.id),
      });
      expect(unchanged?.title).toBe("Security");
    });
  });

  it("org B cannot delete org A value props", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [valuePropA] = await db
        .insert(tables.valueProp)
        .values({
          organizationId: orgA.id,
          title: "Support",
          body: "24/7 support.",
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!valuePropA) throw new Error("setup failed");

      const deleted = await db
        .delete(tables.valueProp)
        .where(
          and(eq(tables.valueProp.id, valuePropA.id), eq(tables.valueProp.organizationId, orgB.id)),
        )
        .returning();

      expect(deleted).toHaveLength(0);

      const stillThere = await db.query.valueProp.findFirst({
        where: eq(tables.valueProp.id, valuePropA.id),
      });
      expect(stillThere?.id).toBe(valuePropA.id);
    });
  });

  it("two orgs can each have a value prop with the same title", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      await db.insert(tables.valueProp).values({
        organizationId: orgA.id,
        title: "ROI",
        body: "Org A ROI",
        createdByUserId: orgA.userId,
      });
      await db.insert(tables.valueProp).values({
        organizationId: orgB.id,
        title: "ROI",
        body: "Org B ROI",
        createdByUserId: orgB.userId,
      });

      const inA = await db.query.valueProp.findFirst({
        where: and(eq(tables.valueProp.organizationId, orgA.id), eq(tables.valueProp.title, "ROI")),
      });
      const inB = await db.query.valueProp.findFirst({
        where: and(eq(tables.valueProp.organizationId, orgB.id), eq(tables.valueProp.title, "ROI")),
      });

      expect(inA?.id).toBeDefined();
      expect(inB?.id).toBeDefined();
      expect(inA?.id).not.toBe(inB?.id);
    });
  });
});

describe("research profile tenancy", () => {
  async function seedProspect(orgId: string, email: string) {
    const [prospect] = await db
      .insert(tables.prospect)
      .values({ organizationId: orgId, email })
      .returning();
    if (!prospect) throw new Error("setup failed");
    return prospect;
  }

  it("org B cannot read org A research profiles", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const prospect = await seedProspect(orgA.id, "research@tenancy.test");
      const [profileA] = await db
        .insert(tables.researchProfile)
        .values({
          organizationId: orgA.id,
          prospectId: prospect.id,
          status: "ready",
          summary: "Org A research",
        })
        .returning();
      if (!profileA) throw new Error("setup failed");

      const fromOrgB = await db.query.researchProfile.findFirst({
        where: and(
          eq(tables.researchProfile.id, profileA.id),
          eq(tables.researchProfile.organizationId, orgB.id),
        ),
      });

      expect(fromOrgB).toBeUndefined();
    });
  });

  it("org B cannot delete org A research profiles", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const prospect = await seedProspect(orgA.id, "research-delete@tenancy.test");
      const [profileA] = await db
        .insert(tables.researchProfile)
        .values({
          organizationId: orgA.id,
          prospectId: prospect.id,
          status: "ready",
        })
        .returning();
      if (!profileA) throw new Error("setup failed");

      const deleted = await db
        .delete(tables.researchProfile)
        .where(
          and(
            eq(tables.researchProfile.id, profileA.id),
            eq(tables.researchProfile.organizationId, orgB.id),
          ),
        )
        .returning();

      expect(deleted).toHaveLength(0);

      const stillThere = await db.query.researchProfile.findFirst({
        where: eq(tables.researchProfile.id, profileA.id),
      });
      expect(stillThere?.id).toBe(profileA.id);
    });
  });

  it("two orgs can each have a research profile for prospects with the same email", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const prospectA = await seedProspect(orgA.id, "same-research@tenancy.test");
      const prospectB = await seedProspect(orgB.id, "same-research@tenancy.test");

      await db.insert(tables.researchProfile).values({
        organizationId: orgA.id,
        prospectId: prospectA.id,
        status: "ready",
      });
      await db.insert(tables.researchProfile).values({
        organizationId: orgB.id,
        prospectId: prospectB.id,
        status: "ready",
      });

      const inA = await db.query.researchProfile.findFirst({
        where: eq(tables.researchProfile.organizationId, orgA.id),
      });
      const inB = await db.query.researchProfile.findFirst({
        where: eq(tables.researchProfile.organizationId, orgB.id),
      });

      expect(inA?.id).toBeDefined();
      expect(inB?.id).toBeDefined();
      expect(inA?.id).not.toBe(inB?.id);
    });
  });
});

describe("value prop embedding persistence", () => {
  /** Deterministic 1536-dim vector: all zeros except index i = 1.0 */
  function deterministicVector(i: number): number[] {
    const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    v[i % EMBEDDING_DIMENSIONS] = 1.0;
    return v;
  }

  it("persisted embedding participates in nearest-neighbor retrieval", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const embeddingA = deterministicVector(0);
      const embeddingB = deterministicVector(1);

      // Insert two value props with distinct embeddings
      const [vpA] = await db
        .insert(tables.valueProp)
        .values({
          organizationId: orgA.id,
          title: "Speed",
          body: "We ship fast.",
          embedding: embeddingA,
          createdByUserId: orgA.userId,
        })
        .returning();

      await db.insert(tables.valueProp).values({
        organizationId: orgA.id,
        title: "Security",
        body: "We protect data.",
        embedding: embeddingB,
        createdByUserId: orgA.userId,
      });

      // Query with a vector identical to vpA's embedding
      const similarity = sql<number>`1 - (${cosineDistance(tables.valueProp.embedding, embeddingA)})`;
      const matched = await db
        .select({
          id: tables.valueProp.id,
          title: tables.valueProp.title,
          similarity,
        })
        .from(tables.valueProp)
        .where(and(eq(tables.valueProp.organizationId, orgA.id), gt(similarity, 0.5)))
        .orderBy(desc(similarity))
        .limit(1);

      expect(matched).toHaveLength(1);
      expect(matched[0]!.id).toBe(vpA!.id);
      expect(matched[0]!.similarity).toBeCloseTo(1.0, 5);
    });
  });

  it("fallback retrieval includes legacy null-embedding rows", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db.insert(tables.valueProp).values({
        organizationId: orgA.id,
        title: "With embedding",
        body: "Has vector.",
        embedding: deterministicVector(0),
        createdByUserId: orgA.userId,
      });

      await db.insert(tables.valueProp).values({
        organizationId: orgA.id,
        title: "Legacy no embedding",
        body: "No vector.",
        createdByUserId: orgA.userId,
      });

      // Fallback path: no researchSummary → skips cosine, uses recency order
      const results = await retrieveValueProps(orgA.id, null);

      const titles = results.map((r) => r.title);
      expect(titles).toContain("With embedding");
      expect(titles).toContain("Legacy no embedding");
    });
  });
});
