import { logger } from "@quiksend/config";
import { client, db, tables } from "@quiksend/db";
import {
  fetchChangedHubspotAccounts,
  fetchChangedHubspotContacts,
  fetchChangedSalesforceAccounts,
  fetchChangedSalesforceContacts,
  linkContactsToCompanies,
  parseSyncCursor,
  serializeSyncCursor,
  upsertAccounts,
  upsertContacts,
} from "@quiksend/integrations";
import type { FieldMapping } from "@quiksend/integrations/providers";
import { registerHandler } from "@quiksend/queue";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";

const syncDb = drizzle(client, { casing: "snake_case" });

export async function registerCrmSyncHandler(): Promise<void> {
  await registerHandler("crm.sync", async ({ connectionId, model }) => {
    const connection = await db.query.crmConnection.findFirst({
      where: eq(tables.crmConnection.id, connectionId),
    });
    if (!connection) {
      logger.warn({ connectionId }, "crm.sync: connection not found");
      return;
    }

    const organizationId = connection.organizationId;
    let syncRow = await db.query.syncState.findFirst({
      where: and(
        eq(tables.syncState.connectionId, connectionId),
        eq(tables.syncState.model, model),
      ),
    });

    if (!syncRow) {
      const [inserted] = await db
        .insert(tables.syncState)
        .values({
          organizationId,
          connectionId,
          model,
          status: "running",
        })
        .returning();
      if (!inserted) throw new Error("Failed to create sync_state row");
      syncRow = inserted;
    } else {
      await db
        .update(tables.syncState)
        .set({ status: "running", error: null })
        .where(eq(tables.syncState.id, syncRow.id));
    }

    const syncStateId = syncRow.id;
    const fieldMapping = connection.fieldMapping as FieldMapping;
    const ctx = {
      organizationId,
      connectionId,
      provider: connection.provider,
    };

    const cursor = parseSyncCursor(syncRow.cursor);
    let page = 0;

    try {
      let nextNangoCursor: string | null = cursor.nangoCursor ?? null;
      let modifiedAfter = cursor.modifiedAfter ?? null;
      do {
        page += 1;

        if (model === "Contact") {
          const result =
            connection.provider === "salesforce"
              ? await fetchChangedSalesforceContacts(
                  connection.nangoConnectionId,
                  fieldMapping,
                  modifiedAfter,
                  nextNangoCursor,
                )
              : await fetchChangedHubspotContacts(
                  connection.nangoConnectionId,
                  fieldMapping,
                  modifiedAfter,
                  nextNangoCursor,
                );
          await upsertContacts(syncDb, ctx, result.records);
          await linkContactsToCompanies(syncDb, ctx, result.records);
          if (result.records.length > 0) {
            modifiedAfter =
              result.records[result.records.length - 1]?.lastModifiedISO ?? modifiedAfter;
          }
          nextNangoCursor = result.nextCursor;
        } else {
          const result =
            connection.provider === "salesforce"
              ? await fetchChangedSalesforceAccounts(
                  connection.nangoConnectionId,
                  fieldMapping,
                  modifiedAfter,
                  nextNangoCursor,
                )
              : await fetchChangedHubspotAccounts(
                  connection.nangoConnectionId,
                  fieldMapping,
                  modifiedAfter,
                  nextNangoCursor,
                );
          await upsertAccounts(syncDb, ctx, result.records);
          if (result.records.length > 0) {
            modifiedAfter =
              result.records[result.records.length - 1]?.lastModifiedISO ?? modifiedAfter;
          }
          nextNangoCursor = result.nextCursor;
        }

        const nextCursor = serializeSyncCursor({
          modifiedAfter,
          nangoCursor: nextNangoCursor,
        });

        await db
          .update(tables.syncState)
          .set({ cursor: nextCursor, lastRunAt: new Date() })
          .where(eq(tables.syncState.id, syncStateId));

        logger.info({ organizationId, connectionId, model, page }, "crm.sync page processed");
      } while (nextNangoCursor);

      await db
        .update(tables.crmConnection)
        .set({ lastSyncAt: new Date(), lastError: null, status: "active" })
        .where(eq(tables.crmConnection.id, connectionId));

      await db
        .update(tables.syncState)
        .set({ status: "idle", lastRunAt: new Date(), error: null })
        .where(eq(tables.syncState.id, syncStateId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(tables.syncState)
        .set({ status: "error", error: message, lastRunAt: new Date() })
        .where(eq(tables.syncState.id, syncStateId));
      await db
        .update(tables.crmConnection)
        .set({ lastError: message, status: "error" })
        .where(eq(tables.crmConnection.id, connectionId));
      logger.error({ err, organizationId, connectionId, model }, "crm.sync failed");
      throw err;
    }
  });
}
