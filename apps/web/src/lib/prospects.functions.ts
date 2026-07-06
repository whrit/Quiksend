import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { enqueue, enqueueWithRetries } from "@quiksend/queue";
import type { EmailGateway } from "@quiksend/mail/gateway-detect";
import { isAdminOrOwner } from "@quiksend/core";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizeDomain, normalizeEmail } from "./prospect-import.ts";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./org-fn.ts";
import { createProspectInputSchema, prospectStatusSchema } from "./schemas/prospect.ts";
import { withAnalyticsTiming } from "./timing.ts";

type ProspectRow = typeof tables.prospect.$inferSelect;
type CompanyRow = typeof tables.company.$inferSelect;
type ListRow = typeof tables.list.$inferSelect;
type ImportBatchRow = typeof tables.importBatch.$inferSelect;
type ImportErrorRow = typeof tables.importError.$inferSelect;

function serializeProspect(row: ProspectRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    companyId: row.companyId,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    title: row.title,
    linkedinUrl: row.linkedinUrl,
    phone: row.phone,
    timezone: row.timezone,
    status: row.status,
    source: row.source,
    customFields: (row.customFields ?? null) as Record<string, string> | null,
    crmProvider: row.crmProvider,
    crmExternalId: row.crmExternalId,
    crmConnectionId: row.crmConnectionId,
    lastCrmSyncAt: row.lastCrmSyncAt?.toISOString() ?? null,
    emailGateway: row.emailGateway ?? null,
    gatewayClassifiedAt: row.gatewayClassifiedAt?.toISOString() ?? null,
    gatewayEvidence: row.gatewayEvidence ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeCompany(row: CompanyRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    size: row.size,
    website: row.website,
    linkedinUrl: row.linkedinUrl,
    customFields: (row.customFields ?? null) as Record<string, string> | null,
    crmProvider: row.crmProvider,
    crmExternalId: row.crmExternalId,
    crmConnectionId: row.crmConnectionId,
    lastCrmSyncAt: row.lastCrmSyncAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeList(row: ListRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeImportBatch(row: ImportBatchRow, errors: ImportErrorRow[] = []) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    filename: row.filename,
    mapping: row.mapping as Record<string, string>,
    createdCount: row.createdCount,
    updatedCount: row.updatedCount,
    skippedCount: row.skippedCount,
    erroredCount: row.erroredCount,
    status: row.status,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    errors: errors.map((err) => ({
      id: err.id,
      batchId: err.batchId,
      rowNumber: err.rowNumber,
      raw: err.raw as Record<string, string>,
      reason: err.reason,
      createdAt: err.createdAt.toISOString(),
    })),
  };
}

const sortFieldSchema = z.enum(["createdAt", "email", "lastName", "status"]);

const cursorSchema = z.union([
  z.object({
    id: z.string().uuid(),
    field: sortFieldSchema,
    value: z.string(),
  }),
  z
    .object({
      id: z.string().uuid(),
      createdAt: z.string().datetime(),
    })
    .transform((cursor) => ({
      id: cursor.id,
      field: "createdAt" as const,
      value: cursor.createdAt,
    })),
]);

function cursorValueFromProspect(row: ProspectRow, field: z.infer<typeof sortFieldSchema>): string {
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

function prospectCursorCondition(
  sortField: z.infer<typeof sortFieldSchema>,
  sortDir: "asc" | "desc",
  cursor: { id: string; field: z.infer<typeof sortFieldSchema>; value: string },
) {
  const column = sortColumn(sortField);
  if (sortField === "createdAt") {
    const cursorDate = new Date(cursor.value);
    if (sortDir === "desc") {
      return or(
        lt(column, cursorDate),
        and(eq(column, cursorDate), lt(tables.prospect.id, cursor.id)),
      )!;
    }
    return or(
      gt(column, cursorDate),
      and(eq(column, cursorDate), gt(tables.prospect.id, cursor.id)),
    )!;
  }

  if (sortDir === "desc") {
    return or(
      lt(column, cursor.value),
      and(eq(column, cursor.value), lt(tables.prospect.id, cursor.id)),
    )!;
  }
  return or(
    gt(column, cursor.value),
    and(eq(column, cursor.value), gt(tables.prospect.id, cursor.id)),
  )!;
}

const listProspectsInputSchema = z.object({
  status: z.array(prospectStatusSchema).optional(),
  listId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  gateways: z.array(z.string()).optional(),
  search: z.string().max(200).optional(),
  sortField: sortFieldSchema.default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(500).default(50),
});

const prospectPatchSchema = z
  .object({
    firstName: z.string().max(200).nullable().optional(),
    lastName: z.string().max(200).nullable().optional(),
    title: z.string().max(200).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    linkedinUrl: z.string().max(500).nullable().optional(),
    timezone: z.string().max(100).nullable().optional(),
    status: prospectStatusSchema.optional(),
    companyId: z.string().uuid().nullable().optional(),
  })
  .strict();

const listCompaniesInputSchema = z.object({
  search: z.string().max(200).optional(),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(500).default(50),
});

const upsertCompanyInputSchema = z.object({
  name: z.string().max(500).optional(),
  domain: z.string().max(255).optional(),
  industry: z.string().max(200).optional(),
  size: z.string().max(100).optional(),
  website: z.string().max(500).optional(),
  linkedinUrl: z.string().max(500).optional(),
});

const importRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  prospect: z.object({
    email: z.string(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    linkedinUrl: z.string().nullable().optional(),
    timezone: z.string().nullable().optional(),
  }),
  company: z
    .object({
      name: z.string().nullable().optional(),
      domain: z.string().nullable().optional(),
      industry: z.string().nullable().optional(),
      website: z.string().nullable().optional(),
    })
    .optional(),
});

const startImportInputSchema = z.object({
  filename: z.string().min(1).max(500),
  mapping: z.record(z.string(), z.string()),
  rows: z.array(importRowSchema).max(5000),
  dedupePolicy: z.enum(["skip_existing", "update_existing"]),
  invalidRows: z
    .array(
      z.object({
        rowNumber: z.number().int().positive(),
        raw: z.record(z.string(), z.string()),
        reason: z.string(),
      }),
    )
    .optional(),
});

function sortColumn(field: z.infer<typeof sortFieldSchema>) {
  switch (field) {
    case "email":
      return tables.prospect.email;
    case "lastName":
      return tables.prospect.lastName;
    case "status":
      return tables.prospect.status;
    default:
      return tables.prospect.createdAt;
  }
}

function notFound(): never {
  throw new Response("Not found", { status: 404 });
}

export const listProspects = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(listProspectsInputSchema)
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const conditions = [
      eq(tables.prospect.organizationId, organizationId),
      isNull(tables.prospect.deletedAt),
    ];

    if (data.status?.length) {
      conditions.push(inArray(tables.prospect.status, data.status));
    }
    if (data.companyId) {
      conditions.push(eq(tables.prospect.companyId, data.companyId));
    }
    if (data.gateways?.length) {
      conditions.push(inArray(tables.prospect.emailGateway, data.gateways as EmailGateway[]));
    }
    if (data.search) {
      const term = `%${data.search.trim()}%`;
      conditions.push(
        or(
          ilike(tables.prospect.email, term),
          ilike(tables.prospect.firstName, term),
          ilike(tables.prospect.lastName, term),
        )!,
      );
    }
    if (data.listId) {
      conditions.push(
        sql`${tables.prospect.id} in (select ${tables.listMember.prospectId} from ${tables.listMember} inner join ${tables.list} on ${tables.listMember.listId} = ${tables.list.id} where ${tables.listMember.listId} = ${data.listId} and ${tables.list.organizationId} = ${organizationId})`,
      );
    }
    if (data.cursor) {
      conditions.push(prospectCursorCondition(data.sortField, data.sortDir, data.cursor));
    }

    const order = data.sortDir === "asc" ? asc : desc;
    const rows = await db
      .select({
        prospect: tables.prospect,
        companyName: tables.company.name,
      })
      .from(tables.prospect)
      .leftJoin(tables.company, eq(tables.prospect.companyId, tables.company.id))
      .where(and(...conditions))
      .orderBy(order(sortColumn(data.sortField)), order(tables.prospect.id))
      .limit(data.limit + 1);

    const hasMore = rows.length > data.limit;
    const page = hasMore ? rows.slice(0, data.limit) : rows;
    const last = page.at(-1)?.prospect;

    return {
      items: page.map((row) => ({
        ...serializeProspect(row.prospect),
        companyName: row.companyName,
      })),
      nextCursor:
        hasMore && last
          ? {
              id: last.id,
              field: data.sortField,
              value: cursorValueFromProspect(last, data.sortField),
            }
          : null,
    };
  });

export const getProspect = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const row = await db.query.prospect.findFirst({
      where: and(
        eq(tables.prospect.id, data.id),
        eq(tables.prospect.organizationId, organizationId),
        isNull(tables.prospect.deletedAt),
      ),
      with: {
        company: true,
        listMembers: {
          with: { list: true },
        },
      },
    });

    if (!row) notFound();

    return {
      prospect: serializeProspect(row),
      company: row.company ? serializeCompany(row.company) : null,
      lists: row.listMembers.map((m) => serializeList(m.list)),
    };
  });

export const createProspect = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(createProspectInputSchema)
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const email = normalizeEmail(data.email);
    if (!email) throw new Error("Invalid email address");

    const existing = await db.query.prospect.findFirst({
      where: and(
        eq(tables.prospect.organizationId, organizationId),
        eq(tables.prospect.email, email),
      ),
    });

    if (existing) {
      if (existing.deletedAt) {
        const [restored] = await db
          .update(tables.prospect)
          .set({
            deletedAt: null,
            firstName: data.firstName ?? existing.firstName,
            lastName: data.lastName ?? existing.lastName,
            title: data.title ?? existing.title,
            phone: data.phone ?? existing.phone,
            linkedinUrl: data.linkedinUrl ?? existing.linkedinUrl,
            timezone: data.timezone ?? existing.timezone,
            status: data.status ?? existing.status,
            companyId: data.companyId ?? existing.companyId,
            source: data.source,
          })
          .where(
            and(
              eq(tables.prospect.id, existing.id),
              eq(tables.prospect.organizationId, organizationId),
            ),
          )
          .returning();
        return serializeProspect(restored!);
      }
      throw new Error("A prospect with this email already exists");
    }

    const [created] = await db
      .insert(tables.prospect)
      .values({
        organizationId,
        email,
        firstName: data.firstName,
        lastName: data.lastName,
        title: data.title,
        phone: data.phone,
        linkedinUrl: data.linkedinUrl,
        timezone: data.timezone,
        status: data.status ?? "new",
        source: data.source,
        companyId: data.companyId,
      })
      .returning();

    await enqueueCrmContactUpsertForProspect(organizationId, created!.id);
    await enqueueWithRetries("gateway.detect_single", { email });

    return serializeProspect(created!);
  });

export const updateProspect = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid(), patch: prospectPatchSchema }))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const [updated] = await db
      .update(tables.prospect)
      .set(data.patch)
      .where(
        and(
          eq(tables.prospect.id, data.id),
          eq(tables.prospect.organizationId, organizationId),
          isNull(tables.prospect.deletedAt),
        ),
      )
      .returning();

    if (!updated) notFound();
    return serializeProspect(updated);
  });

export const deleteProspect = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const [deleted] = await db
      .update(tables.prospect)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(tables.prospect.id, data.id),
          eq(tables.prospect.organizationId, organizationId),
          isNull(tables.prospect.deletedAt),
        ),
      )
      .returning({ id: tables.prospect.id });

    if (!deleted) notFound();
    return { ok: true as const };
  });

export const bulkDeleteProspects = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const existing = await db
      .select({ id: tables.prospect.id })
      .from(tables.prospect)
      .where(
        and(
          inArray(tables.prospect.id, data.ids),
          eq(tables.prospect.organizationId, organizationId),
          isNull(tables.prospect.deletedAt),
        ),
      );

    if (existing.length !== data.ids.length) {
      throw new Error("One or more prospects were not found in this workspace");
    }

    await db
      .update(tables.prospect)
      .set({ deletedAt: new Date() })
      .where(
        and(
          inArray(tables.prospect.id, data.ids),
          eq(tables.prospect.organizationId, organizationId),
        ),
      );

    return { deleted: data.ids.length };
  });

export const listCompanies = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(listCompaniesInputSchema)
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const conditions = [
      eq(tables.company.organizationId, organizationId),
      isNull(tables.company.deletedAt),
    ];

    if (data.search) {
      const term = `%${data.search.trim()}%`;
      conditions.push(or(ilike(tables.company.name, term), ilike(tables.company.domain, term))!);
    }
    if (data.cursor) {
      const cursorDate = new Date(data.cursor.value);
      conditions.push(
        or(
          lt(tables.company.createdAt, cursorDate),
          and(eq(tables.company.createdAt, cursorDate), lt(tables.company.id, data.cursor.id)),
        )!,
      );
    }

    const rows = await db
      .select()
      .from(tables.company)
      .where(and(...conditions))
      .orderBy(desc(tables.company.createdAt), desc(tables.company.id))
      .limit(data.limit + 1);

    const hasMore = rows.length > data.limit;
    const page = hasMore ? rows.slice(0, data.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map(serializeCompany),
      nextCursor:
        hasMore && last
          ? {
              id: last.id,
              field: "createdAt" as const,
              value: last.createdAt.toISOString(),
            }
          : null,
    };
  });

export const upsertCompany = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(upsertCompanyInputSchema)
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const domain = data.domain ? normalizeDomain(data.domain) : null;
    const name = data.name?.trim() || null;

    let existing = null;
    if (domain) {
      existing = await db.query.company.findFirst({
        where: and(
          eq(tables.company.organizationId, organizationId),
          eq(tables.company.domain, domain),
          isNull(tables.company.deletedAt),
        ),
      });
    } else if (name) {
      existing = await db.query.company.findFirst({
        where: and(
          eq(tables.company.organizationId, organizationId),
          sql`lower(${tables.company.name}) = ${name.toLowerCase()}`,
          isNull(tables.company.deletedAt),
        ),
      });
    }

    const values = {
      name,
      domain,
      industry: data.industry,
      size: data.size,
      website: data.website,
      linkedinUrl: data.linkedinUrl,
    };

    if (existing) {
      const [updated] = await db
        .update(tables.company)
        .set(values)
        .where(
          and(
            eq(tables.company.id, existing.id),
            eq(tables.company.organizationId, organizationId),
          ),
        )
        .returning();
      return serializeCompany(updated!);
    }

    const [created] = await db
      .insert(tables.company)
      .values({ organizationId, ...values })
      .returning();

    return serializeCompany(created!);
  });

export const createList = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, userId } = context.orgContext;

    const [created] = await db
      .insert(tables.list)
      .values({
        organizationId,
        name: data.name,
        description: data.description,
        createdByUserId: userId,
      })
      .returning();

    return serializeList(created!);
  });

export const listLists = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({}))
  .handler(async ({ context }) => {
    const { organizationId } = context.orgContext;
    const rows = await db
      .select()
      .from(tables.list)
      .where(eq(tables.list.organizationId, organizationId))
      .orderBy(asc(tables.list.name));
    return rows.map(serializeList);
  });

export const addToList = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      listId: z.string().uuid(),
      prospectIds: z.array(z.string().uuid()).min(1).max(500),
    }),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const targetList = await db.query.list.findFirst({
      where: and(eq(tables.list.id, data.listId), eq(tables.list.organizationId, organizationId)),
    });
    if (!targetList) notFound();

    const prospects = await db
      .select({ id: tables.prospect.id })
      .from(tables.prospect)
      .where(
        and(
          inArray(tables.prospect.id, data.prospectIds),
          eq(tables.prospect.organizationId, organizationId),
          isNull(tables.prospect.deletedAt),
        ),
      );

    if (prospects.length !== data.prospectIds.length) {
      throw new Error("One or more prospects were not found in this workspace");
    }

    await db
      .insert(tables.listMember)
      .values(data.prospectIds.map((prospectId) => ({ listId: data.listId, prospectId })))
      .onConflictDoNothing();

    return { added: data.prospectIds.length };
  });

export const removeFromList = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      listId: z.string().uuid(),
      prospectIds: z.array(z.string().uuid()).min(1).max(500),
    }),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const targetList = await db.query.list.findFirst({
      where: and(eq(tables.list.id, data.listId), eq(tables.list.organizationId, organizationId)),
    });
    if (!targetList) notFound();

    await db
      .delete(tables.listMember)
      .where(
        and(
          eq(tables.listMember.listId, data.listId),
          inArray(tables.listMember.prospectId, data.prospectIds),
        ),
      );

    return { removed: data.prospectIds.length };
  });

export const startImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(startImportInputSchema)
  .handler(async ({ data, context }) => {
    const { organizationId, userId } = context.orgContext;

    const [batch] = await db
      .insert(tables.importBatch)
      .values({
        organizationId,
        filename: data.filename,
        mapping: data.mapping,
        createdByUserId: userId,
        // Row processing happens in the worker (import.process handler).
        // "queued" tells the UI to keep polling instead of re-showing the file
        // picker.
        status: "queued",
      })
      .returning();
    if (!batch) throw new Error("Failed to create import batch");

    if (data.invalidRows?.length) {
      await db.insert(tables.importError).values(
        data.invalidRows.map((row) => ({
          batchId: batch.id,
          rowNumber: row.rowNumber,
          raw: row.raw,
          reason: row.reason,
        })),
      );
      // Reflect parse-time errors in the batch counters immediately so the
      // client's polling snapshot has something to render.
      await db
        .update(tables.importBatch)
        .set({ erroredCount: data.invalidRows.length })
        .where(
          and(
            eq(tables.importBatch.id, batch.id),
            eq(tables.importBatch.organizationId, organizationId),
          ),
        );
    }

    // Hand the actual row-by-row work off to the worker so a 5,000-row CSV
    // doesn't hold a server-fn request open for minutes and time out at the
    // proxy layer. The client polls `getImportBatch` and shows progress.
    await enqueueWithRetries("import.process", {
      batchId: batch.id,
      organizationId,
      dedupePolicy: data.dedupePolicy,
      rows: data.rows,
    });

    const [refreshed] = await db
      .select()
      .from(tables.importBatch)
      .where(
        and(
          eq(tables.importBatch.id, batch.id),
          eq(tables.importBatch.organizationId, organizationId),
        ),
      );

    return {
      batch: serializeImportBatch(refreshed ?? batch),
      // Kept for backwards-compat with the previous synchronous shape; will be
      // zero until the worker fills them in and the client re-polls.
      summary: {
        createdCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        erroredCount: data.invalidRows?.length ?? 0,
      },
    };
  });

export const getImportBatch = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const batch = await db.query.importBatch.findFirst({
      where: and(
        eq(tables.importBatch.id, data.id),
        eq(tables.importBatch.organizationId, organizationId),
      ),
      with: { errors: true },
    });

    if (!batch) notFound();
    return serializeImportBatch(batch, batch.errors);
  });

async function hasAnyCrmConnection(organizationId: string): Promise<boolean> {
  const row = await db.query.crmConnection.findFirst({
    where: and(
      eq(tables.crmConnection.organizationId, organizationId),
      eq(tables.crmConnection.status, "active"),
    ),
  });
  return Boolean(row);
}

async function enqueueCrmContactUpsertForProspect(
  organizationId: string,
  prospectId: string,
): Promise<void> {
  if (!(await hasAnyCrmConnection(organizationId))) return;

  const connections = await db.query.crmConnection.findMany({
    where: and(
      eq(tables.crmConnection.organizationId, organizationId),
      eq(tables.crmConnection.status, "active"),
    ),
  });

  for (const connection of connections) {
    await enqueue("crm.writeback", {
      connectionId: connection.id,
      eventType: "contact_upsert",
      entityId: prospectId,
      idempotencyKey: `contact_upsert:${prospectId}:${connection.id}`,
    });
  }
}

export const getProspectEnrollments = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ prospectId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;

    const rows = await db.query.enrollment.findMany({
      where: and(
        eq(tables.enrollment.prospectId, data.prospectId),
        eq(tables.enrollment.organizationId, organizationId),
      ),
      orderBy: desc(tables.enrollment.updatedAt),
    });

    const sequenceIds = [...new Set(rows.map((r) => r.sequenceId))];
    const sequences =
      sequenceIds.length > 0
        ? await db.query.sequence.findMany({
            where: and(
              eq(tables.sequence.organizationId, organizationId),
              inArray(tables.sequence.id, sequenceIds),
            ),
          })
        : [];
    const sequenceMap = new Map(sequences.map((s) => [s.id, s]));

    return rows.map((row) => {
      const sequence = sequenceMap.get(row.sequenceId);
      return {
        id: row.id,
        sequenceId: row.sequenceId,
        sequenceName: sequence?.name ?? "Unknown sequence",
        state: row.state,
        currentStepIndex: row.currentStepIndex,
        nextRunAt: row.nextRunAt?.toISOString() ?? null,
        lastError: row.lastError,
        updatedAt: row.updatedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      };
    });
  });

export const getProspectMessages = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      prospectId: z.string().uuid(),
      cursor: z
        .object({
          at: z.string().datetime(),
          id: z.string().uuid(),
        })
        .optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const limit = data.limit ?? 20;

    const conditions = [
      eq(tables.message.organizationId, organizationId),
      eq(tables.message.prospectId, data.prospectId),
    ];

    if (data.cursor) {
      conditions.push(
        or(
          lt(tables.message.createdAt, new Date(data.cursor.at)),
          and(
            eq(tables.message.createdAt, new Date(data.cursor.at)),
            lt(tables.message.id, data.cursor.id),
          ),
        )!,
      );
    }

    const rows = await db.query.message.findMany({
      where: and(...conditions),
      orderBy: [desc(tables.message.createdAt), desc(tables.message.id)],
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? {
            at: last.createdAt.toISOString(),
            id: last.id,
          }
        : null;

    return {
      items: items.map((m) => ({
        id: m.id,
        direction: m.direction,
        subject: m.subject,
        status: m.status,
        sentiment: m.sentiment,
        sentAt: m.sentAt?.toISOString() ?? null,
        receivedAt: m.receivedAt?.toISOString() ?? null,
      })),
      nextCursor,
    };
  });

export const getProspectResearchProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ prospectId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const profile = await db.query.researchProfile.findFirst({
      where: and(
        eq(tables.researchProfile.organizationId, organizationId),
        eq(tables.researchProfile.prospectId, data.prospectId),
      ),
    });
    if (!profile) return null;
    return {
      id: profile.id,
      status: profile.status,
      updatedAt: profile.updatedAt.toISOString(),
    };
  });

function extractEmailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase();
}

type GatewayMixRow = { gateway: string; count: number; pct: number };

async function queryGatewayMix(
  organizationId: string,
  extraCondition?: ReturnType<typeof sql>,
): Promise<{ mix: GatewayMixRow[]; classifiedPct: number; total: number }> {
  const conditions = [
    eq(tables.prospect.organizationId, organizationId),
    isNull(tables.prospect.deletedAt),
  ];
  if (extraCondition) conditions.push(extraCondition);

  const rows = await db
    .select({
      gateway: tables.prospect.emailGateway,
      count: sql<number>`count(*)::int`,
    })
    .from(tables.prospect)
    .where(and(...conditions))
    .groupBy(tables.prospect.emailGateway);

  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const classified = rows.filter((r) => r.gateway !== null).reduce((sum, r) => sum + r.count, 0);

  const mix = rows
    .filter((r) => r.gateway !== null)
    .map((r) => ({
      gateway: r.gateway!,
      count: r.count,
      pct: total > 0 ? r.count / total : 0,
    }))
    .toSorted((a, b) => b.count - a.count);

  return {
    mix,
    classifiedPct: total > 0 ? classified / total : 0,
    total,
  };
}

export const classifyEmail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ email: z.string().email() }))
  .handler(async ({ data, context }) => {
    if (!isAdminOrOwner(context.orgContext as Parameters<typeof isAdminOrOwner>[0])) {
      throw new Error("Admin role required");
    }

    const domain = extractEmailDomain(data.email);
    if (!domain) {
      return { gateway: "unknown" as const, evidence: [], cached: false };
    }

    const cached = await db.query.gatewayClassification.findFirst({
      where: and(
        eq(tables.gatewayClassification.emailDomain, domain),
        sql`${tables.gatewayClassification.ttlUntil} > now()`,
      ),
    });

    if (cached) {
      return {
        gateway: cached.gateway,
        evidence: cached.evidence,
        cached: true,
      };
    }

    await enqueueWithRetries("gateway.detect_single", { email: data.email });
    return { gateway: "unknown" as const, evidence: [], cached: false };
  });

export const reclassifyDomain = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ emailDomain: z.string().min(1).max(255) }))
  .handler(async ({ data, context }) => {
    if (!isAdminOrOwner(context.orgContext as Parameters<typeof isAdminOrOwner>[0])) {
      throw new Error("Admin role required");
    }

    const domain = data.emailDomain.trim().toLowerCase();
    await db
      .delete(tables.gatewayClassification)
      .where(eq(tables.gatewayClassification.emailDomain, domain));

    await enqueueWithRetries("gateway.detect_single", { email: `probe@${domain}` });
    await enqueueWithRetries("gateway.apply_classification", {
      organizationId: context.orgContext.organizationId,
      domain,
    });

    return { success: true as const };
  });

export const getGatewayMixForOrg = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({}))
  .handler(async ({ context }) => {
    const { organizationId } = context.orgContext;
    return withAnalyticsTiming("getGatewayMixForOrg", organizationId, async () =>
      queryGatewayMix(organizationId),
    );
  });

export const getGatewayMixForList = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ listId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return withAnalyticsTiming("getGatewayMixForList", organizationId, async () => {
      const list = await db.query.list.findFirst({
        where: and(eq(tables.list.id, data.listId), eq(tables.list.organizationId, organizationId)),
      });
      if (!list) notFound();

      return queryGatewayMix(
        organizationId,
        sql`${tables.prospect.id} in (select ${tables.listMember.prospectId} from ${tables.listMember} where ${tables.listMember.listId} = ${data.listId})`,
      );
    });
  });

export const getGatewayMixForSequence = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ sequenceId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return withAnalyticsTiming("getGatewayMixForSequence", organizationId, async () => {
      const sequence = await db.query.sequence.findFirst({
        where: and(
          eq(tables.sequence.id, data.sequenceId),
          eq(tables.sequence.organizationId, organizationId),
        ),
      });
      if (!sequence) notFound();

      return queryGatewayMix(
        organizationId,
        sql`${tables.prospect.id} in (select ${tables.enrollment.prospectId} from ${tables.enrollment} where ${tables.enrollment.sequenceId} = ${data.sequenceId} and ${tables.enrollment.organizationId} = ${organizationId})`,
      );
    });
  });
