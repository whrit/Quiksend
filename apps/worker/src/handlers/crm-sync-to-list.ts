import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, eq, inArray } from "drizzle-orm";
import type { CrmSyncPayload } from "@quiksend/queue";
import type { NormalizedContact } from "@quiksend/integrations";
import { tables } from "@quiksend/db/tables";

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

  const externalIds = [
    ...new Set(
      records.map((record) => record.externalId).filter((id): id is string => Boolean(id)),
    ),
  ];
  if (externalIds.length === 0) return;

  const prospectRows = await db
    .select({ id: tables.prospect.id })
    .from(tables.prospect)
    .where(
      and(
        eq(tables.prospect.organizationId, organizationId),
        inArray(tables.prospect.crmExternalId, externalIds),
      ),
    );

  if (prospectRows.length === 0) return;

  await db
    .insert(tables.listMember)
    .values(prospectRows.map((row) => ({ listId: targetListId, prospectId: row.id })))
    .onConflictDoNothing();
}
