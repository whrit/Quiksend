import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import type { CrmSyncPayload } from "@quiksend/queue";
import type { NormalizedContact } from "@quiksend/integrations";
import { tables } from "@quiksend/db";

type Db = PostgresJsDatabase<Record<string, never>>;

export function resolveSyncModifiedAfter(
  cursorModifiedAfter: string | null | undefined,
  payload: Pick<CrmSyncPayload, "filter" | "modifiedSinceDays">,
): string | null {
  if (payload.filter === "modified_since" && payload.modifiedSinceDays) {
    const since = new Date();
    since.setDate(since.getDate() - payload.modifiedSinceDays);
    return since.toISOString();
  }
  return cursorModifiedAfter ?? null;
}

export async function addContactsToTargetList(
  db: Db,
  organizationId: string,
  targetListId: string,
  records: readonly NormalizedContact[],
): Promise<void> {
  const listRows = await db
    .select({ id: tables.list.id })
    .from(tables.list)
    .where(and(eq(tables.list.id, targetListId), eq(tables.list.organizationId, organizationId)))
    .limit(1);
  if (!listRows[0]) return;

  for (const record of records) {
    if (!record.externalId) continue;
    const rows = await db
      .select({ id: tables.prospect.id })
      .from(tables.prospect)
      .where(
        and(
          eq(tables.prospect.organizationId, organizationId),
          eq(tables.prospect.crmExternalId, record.externalId),
        ),
      )
      .limit(1);
    const prospectId = rows[0]?.id;
    if (!prospectId) continue;

    await db
      .insert(tables.listMember)
      .values({ listId: targetListId, prospectId })
      .onConflictDoNothing();
  }
}
