import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";

function cursorValueFromProspect(
  row: typeof tables.prospect.$inferSelect,
  field: "createdAt" | "email" | "lastName" | "status",
): string {
  switch (field) {
    case "email":
      return row.email;
    case "lastName":
      return row.lastName ?? "";
    case "status":
      return row.status;
    default:
      return row.createdAt.toISOString();
  }
}

async function listProspectsByEmail(
  organizationId: string,
  cursor?: { id: string; field: "email"; value: string },
  limit = 3,
) {
  const sortField = "email" as const;
  const conditions = [
    eq(tables.prospect.organizationId, organizationId),
    isNull(tables.prospect.deletedAt),
  ];

  if (cursor) {
    conditions.push(
      or(
        lt(tables.prospect.email, cursor.value),
        and(eq(tables.prospect.email, cursor.value), lt(tables.prospect.id, cursor.id)),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(tables.prospect)
    .where(and(...conditions))
    .orderBy(desc(tables.prospect.email), desc(tables.prospect.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);

  return {
    items: page,
    nextCursor:
      hasMore && last
        ? {
            id: last.id,
            field: sortField,
            value: cursorValueFromProspect(last, sortField),
          }
        : null,
  };
}

describe("prospect list keyset pagination", () => {
  it("pages by email without duplicates or missed rows", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const emails = Array.from(
        { length: 10 },
        (_, i) => `user-${String(i).padStart(2, "0")}@acme.io`,
      );
      for (const email of emails) {
        await db.insert(tables.prospect).values({ organizationId: orgA.id, email });
      }

      const seen = new Set<string>();
      let cursor: { id: string; field: "email"; value: string } | null | undefined = undefined;

      for (let page = 0; page < 5; page += 1) {
        const result = await listProspectsByEmail(orgA.id, cursor ?? undefined, 3);
        for (const row of result.items) {
          expect(seen.has(row.id)).toBe(false);
          seen.add(row.id);
        }
        cursor = result.nextCursor;
        if (!cursor) break;
      }

      expect(seen.size).toBe(10);
    });
  });
});
