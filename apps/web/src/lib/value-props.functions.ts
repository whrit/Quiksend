import { embedText } from "@quiksend/ai";
import { withTenantTransaction } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./org-fn.ts";

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

export const listValueProps = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { organizationId } = context.orgContext;
    return withTenantTransaction(organizationId, async (tx) => {
      const rows = await tx.query.valueProp.findMany({
        where: eq(tables.valueProp.organizationId, organizationId),
        orderBy: desc(tables.valueProp.createdAt),
      });
      return rows.map(toPublicValueProp);
    });
  });

export const getValueProp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return withTenantTransaction(organizationId, async (tx) => {
      const row = await tx.query.valueProp.findFirst({
        where: and(
          eq(tables.valueProp.id, data.id),
          eq(tables.valueProp.organizationId, organizationId),
        ),
      });
      if (!row) throw new ValuePropError("NOT_FOUND", "Value prop not found");
      return toPublicValueProp(row);
    });
  });

export const createValueProp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => createValuePropSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId, userId } = context.orgContext;
    const embedding = await embedText(`${data.title} ${data.body}`);
    return withTenantTransaction(organizationId, async (tx) => {
      const [row] = await tx
        .insert(tables.valueProp)
        .values({
          organizationId,
          title: data.title,
          body: data.body,
          tags: data.tags ?? [],
          embedding,
          createdByUserId: userId,
        })
        .returning();
      if (!row) throw new ValuePropError("VALIDATION", "Failed to create value prop");
      return toPublicValueProp(row);
    });
  });

export const updateValueProp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => updateValuePropSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const needsReembed = data.patch.title !== undefined || data.patch.body !== undefined;

    return withTenantTransaction(organizationId, async (tx) => {
      const existing = await tx.query.valueProp.findFirst({
        where: and(
          eq(tables.valueProp.id, data.id),
          eq(tables.valueProp.organizationId, organizationId),
        ),
      });
      if (!existing) throw new ValuePropError("NOT_FOUND", "Value prop not found");

      const embedding = needsReembed
        ? await embedText(
            `${data.patch.title ?? existing.title} ${data.patch.body ?? existing.body}`,
          )
        : undefined;

      const [row] = await tx
        .update(tables.valueProp)
        .set(needsReembed ? { ...data.patch, embedding } : data.patch)
        .where(
          and(
            eq(tables.valueProp.id, data.id),
            eq(tables.valueProp.organizationId, organizationId),
          ),
        )
        .returning();
      if (!row) throw new ValuePropError("NOT_FOUND", "Value prop not found");
      return toPublicValueProp(row);
    });
  });

export const deleteValueProp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return withTenantTransaction(organizationId, async (tx) => {
      const deleted = await tx
        .delete(tables.valueProp)
        .where(
          and(
            eq(tables.valueProp.id, data.id),
            eq(tables.valueProp.organizationId, organizationId),
          ),
        )
        .returning({ id: tables.valueProp.id });
      if (deleted.length === 0) throw new ValuePropError("NOT_FOUND", "Value prop not found");
      return { ok: true as const };
    });
  });
