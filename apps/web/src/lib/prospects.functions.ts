import { db, tables } from "@quiksend/db";
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DedupePolicy, ValidCsvRow } from "./prospect-import.ts";
import { normalizeDomain, normalizeEmail } from "./prospect-import.ts";
import { orgFn } from "./org-fn.ts";

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

const prospectStatusSchema = z.enum([
  "new",
  "active",
  "replied",
  "bounced",
  "unsubscribed",
  "do_not_contact",
]);

const prospectSourceSchema = z.enum(["manual", "csv", "crm", "api"]);

const sortFieldSchema = z.enum(["createdAt", "email", "lastName", "status"]);

const cursorSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});

const listProspectsInputSchema = z.object({
  status: z.array(prospectStatusSchema).optional(),
  listId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
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

const createProspectInputSchema = z.object({
  email: z.string().min(1).max(320),
  firstName: z.string().max(200).optional(),
  lastName: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  linkedinUrl: z.string().max(500).optional(),
  timezone: z.string().max(100).optional(),
  status: prospectStatusSchema.optional(),
  companyId: z.string().uuid().optional(),
  source: prospectSourceSchema.default("manual"),
});

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

export const listProspects = orgFn({ method: "GET" })
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
      const cursorDate = new Date(data.cursor.createdAt);
      if (data.sortDir === "desc") {
        conditions.push(
          or(
            lt(tables.prospect.createdAt, cursorDate),
            and(eq(tables.prospect.createdAt, cursorDate), lt(tables.prospect.id, data.cursor.id)),
          )!,
        );
      } else {
        conditions.push(
          or(
            sql`${tables.prospect.createdAt} > ${cursorDate}`,
            and(
              eq(tables.prospect.createdAt, cursorDate),
              sql`${tables.prospect.id} > ${data.cursor.id}`,
            ),
          )!,
        );
      }
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
      nextCursor: hasMore && last ? { id: last.id, createdAt: last.createdAt.toISOString() } : null,
    };
  });

export const getProspect = orgFn({ method: "GET" })
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

export const createProspect = orgFn({ method: "POST" })
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

    return serializeProspect(created!);
  });

export const updateProspect = orgFn({ method: "POST" })
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

export const deleteProspect = orgFn({ method: "POST" })
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

export const bulkDeleteProspects = orgFn({ method: "POST" })
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

export const listCompanies = orgFn({ method: "GET" })
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
      const cursorDate = new Date(data.cursor.createdAt);
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
      nextCursor: hasMore && last ? { id: last.id, createdAt: last.createdAt.toISOString() } : null,
    };
  });

export const upsertCompany = orgFn({ method: "POST" })
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

export const createList = orgFn({ method: "POST" })
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

export const listLists = orgFn({ method: "GET" })
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

export const addToList = orgFn({ method: "POST" })
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

export const removeFromList = orgFn({ method: "POST" })
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

async function resolveCompanyId(
  organizationId: string,
  company: ValidCsvRow["company"],
): Promise<string | null> {
  if (!company) return null;

  const domain = company.domain ? normalizeDomain(company.domain) : null;
  const name = company.name?.trim() || null;

  if (domain) {
    const existing = await db.query.company.findFirst({
      where: and(
        eq(tables.company.organizationId, organizationId),
        eq(tables.company.domain, domain),
        isNull(tables.company.deletedAt),
      ),
    });
    if (existing) return existing.id;

    const [created] = await db
      .insert(tables.company)
      .values({
        organizationId,
        domain,
        name: name ?? domain,
        industry: company.industry,
        website: company.website,
      })
      .returning();
    return created?.id ?? null;
  }

  if (name) {
    const existing = await db.query.company.findFirst({
      where: and(
        eq(tables.company.organizationId, organizationId),
        sql`lower(${tables.company.name}) = ${name.toLowerCase()}`,
        isNull(tables.company.deletedAt),
      ),
    });
    if (existing) return existing.id;

    const [created] = await db.insert(tables.company).values({ organizationId, name }).returning();
    return created?.id ?? null;
  }

  return null;
}

async function importProspectRow(
  organizationId: string,
  row: ValidCsvRow,
  dedupePolicy: DedupePolicy,
): Promise<"created" | "updated" | "skipped"> {
  const email = normalizeEmail(row.prospect.email);
  if (!email) throw new Error("Invalid email");

  const companyId = await resolveCompanyId(organizationId, row.company);

  const existing = await db.query.prospect.findFirst({
    where: and(
      eq(tables.prospect.organizationId, organizationId),
      eq(tables.prospect.email, email),
    ),
  });

  const prospectValues = {
    firstName: row.prospect.firstName ?? null,
    lastName: row.prospect.lastName ?? null,
    title: row.prospect.title ?? null,
    phone: row.prospect.phone ?? null,
    linkedinUrl: row.prospect.linkedinUrl ?? null,
    timezone: row.prospect.timezone ?? null,
    companyId,
    source: "csv" as const,
    deletedAt: null,
  };

  if (existing) {
    if (existing.deletedAt || dedupePolicy === "update_existing") {
      await db
        .update(tables.prospect)
        .set(prospectValues)
        .where(
          and(
            eq(tables.prospect.id, existing.id),
            eq(tables.prospect.organizationId, organizationId),
          ),
        );
      return existing.deletedAt ? "created" : "updated";
    }
    return "skipped";
  }

  await db.insert(tables.prospect).values({
    organizationId,
    email,
    ...prospectValues,
  });
  return "created";
}

export const startImport = orgFn({ method: "POST" })
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
        status: "processing",
      })
      .returning();
    if (!batch) throw new Error("Failed to create import batch");

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let erroredCount = data.invalidRows?.length ?? 0;

    if (data.invalidRows?.length) {
      await db.insert(tables.importError).values(
        data.invalidRows.map((row) => ({
          batchId: batch.id,
          rowNumber: row.rowNumber,
          raw: row.raw,
          reason: row.reason,
        })),
      );
    }

    for (const row of data.rows) {
      try {
        const outcome = await importProspectRow(organizationId, row, data.dedupePolicy);
        if (outcome === "created") createdCount += 1;
        else if (outcome === "updated") updatedCount += 1;
        else skippedCount += 1;
      } catch (err) {
        erroredCount += 1;
        await db.insert(tables.importError).values({
          batchId: batch.id,
          rowNumber: row.rowNumber,
          raw: row.prospect as unknown as Record<string, unknown>,
          reason: err instanceof Error ? err.message : "Import failed",
        });
      }
    }

    const [completed] = await db
      .update(tables.importBatch)
      .set({
        createdCount,
        updatedCount,
        skippedCount,
        erroredCount,
        status: "completed",
      })
      .where(
        and(
          eq(tables.importBatch.id, batch.id),
          eq(tables.importBatch.organizationId, organizationId),
        ),
      )
      .returning();

    return {
      batch: serializeImportBatch(completed!),
      summary: { createdCount, updatedCount, skippedCount, erroredCount },
    };
  });

export const getImportBatch = orgFn({ method: "GET" })
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
