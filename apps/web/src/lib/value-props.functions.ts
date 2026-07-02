import { db, tables } from "@quiksend/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { orgFn } from "./org-fn.ts";

class ValuePropError extends Error {
  readonly code: "NOT_FOUND" | "VALIDATION";
  constructor(code: ValuePropError["code"], message: string) {
    super(message);
    this.name = "ValuePropError";
    this.code = code;
  }
}

const createValuePropSchema = z.object({
  title: z.string().min(1).max(500),
  body: z.string().min(1),
  tags: z.array(z.string().min(1).max(100)).optional(),
});

const updateValuePropSchema = z.object({
  id: z.string().uuid(),
  patch: z
    .object({
      title: z.string().min(1).max(500).optional(),
      body: z.string().min(1).optional(),
      tags: z.array(z.string().min(1).max(100)).optional(),
    })
    .strict(),
});

type ValuePropRow = typeof tables.valueProp.$inferSelect;

export type PublicValueProp = {
  id: string;
  organizationId: string;
  title: string;
  body: string;
  tags: string[];
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

function toPublicValueProp(row: ValuePropRow): PublicValueProp {
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    body: row.body,
    tags: row.tags,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const listValueProps = orgFn({ method: "GET" }).handler(async ({ context }) => {
  const { organizationId } = context.orgContext;
  const rows = await db.query.valueProp.findMany({
    where: eq(tables.valueProp.organizationId, organizationId),
    orderBy: desc(tables.valueProp.createdAt),
  });
  return rows.map(toPublicValueProp);
});

export const getValueProp = orgFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const row = await db.query.valueProp.findFirst({
      where: and(
        eq(tables.valueProp.id, data.id),
        eq(tables.valueProp.organizationId, context.orgContext.organizationId),
      ),
    });
    if (!row) throw new ValuePropError("NOT_FOUND", "Value prop not found");
    return toPublicValueProp(row);
  });

export const createValueProp = orgFn({ method: "POST" })
  .validator((data: unknown) => createValuePropSchema.parse(data))
  .handler(async ({ data, context }) => {
    const [row] = await db
      .insert(tables.valueProp)
      .values({
        organizationId: context.orgContext.organizationId,
        title: data.title,
        body: data.body,
        tags: data.tags ?? [],
        createdByUserId: context.orgContext.userId,
      })
      .returning();
    if (!row) throw new ValuePropError("VALIDATION", "Failed to create value prop");
    return toPublicValueProp(row);
  });

export const updateValueProp = orgFn({ method: "POST" })
  .validator((data: unknown) => updateValuePropSchema.parse(data))
  .handler(async ({ data, context }) => {
    const [row] = await db
      .update(tables.valueProp)
      .set(data.patch)
      .where(
        and(
          eq(tables.valueProp.id, data.id),
          eq(tables.valueProp.organizationId, context.orgContext.organizationId),
        ),
      )
      .returning();
    if (!row) throw new ValuePropError("NOT_FOUND", "Value prop not found");
    return toPublicValueProp(row);
  });

export const deleteValueProp = orgFn({ method: "POST" })
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const deleted = await db
      .delete(tables.valueProp)
      .where(
        and(
          eq(tables.valueProp.id, data.id),
          eq(tables.valueProp.organizationId, context.orgContext.organizationId),
        ),
      )
      .returning({ id: tables.valueProp.id });
    if (deleted.length === 0) throw new ValuePropError("NOT_FOUND", "Value prop not found");
    return { ok: true as const };
  });
