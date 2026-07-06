import { z } from "zod";
import { isAdminOrOwner } from "@quiksend/core";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { getNango, getProviderConfig } from "@quiksend/integrations";
import type { CrmProvider, FieldMapping } from "@quiksend/integrations/providers";
import { enqueue } from "@quiksend/queue";
import { and, desc, eq } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, TenancyError } from "./org-fn.ts";

const providerSchema = z.enum(["salesforce", "hubspot"]);

const fieldMappingSchema = z.object({
  prospect: z.record(z.string(), z.string()),
  company: z.record(z.string(), z.string()),
});

export interface CrmConnectionDto {
  id: string;
  organizationId: string;
  provider: CrmProvider;
  nangoConnectionId: string;
  status: string;
  fieldMapping: FieldMapping;
  lastSyncAt: string | null;
  lastError: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

function toDto(row: typeof tables.crmConnection.$inferSelect): CrmConnectionDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    provider: row.provider,
    nangoConnectionId: row.nangoConnectionId,
    status: row.status,
    fieldMapping: row.fieldMapping as FieldMapping,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function requireAdmin(ctx: { orgContext: { role: string } }): void {
  if (!isAdminOrOwner(ctx.orgContext as Parameters<typeof isAdminOrOwner>[0])) {
    throw new TenancyError("NOT_A_MEMBER", "Admin or owner role required");
  }
}

export const listCrmConnections = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(tables.crmConnection)
      .where(eq(tables.crmConnection.organizationId, context.orgContext.organizationId))
      .orderBy(desc(tables.crmConnection.createdAt));
    return rows.map(toDto);
  });

export const createCrmConnectSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(providerSchema)
  .handler(async ({ data: provider, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    const nango = getNango();
    const cfg = getProviderConfig(provider);
    const session = await nango.createConnectSession({
      end_user: {
        id: context.orgContext.userId,
      },
      allowed_integrations: [cfg.nangoIntegrationId],
      organization: {
        id: context.orgContext.organizationId,
      },
    });
    return {
      sessionToken: session.data.token,
      connectUrl: session.data.connect_link,
    };
  });

/**
 * Mint a Nango Connect session bound to an existing CRM connection so the user
 * can re-authorize after credentials go stale (e.g. `invalid_credentials`).
 * See docs/nango-setup.md and https://docs.nango.dev/guides/reauthorize-a-connection.
 */
async function createCrmReconnectSession(
  connectionId: string,
  expectedProvider: CrmProvider,
  organizationId: string,
  userId: string,
): Promise<{ sessionToken: string; connectUrl: string }> {
  const connection = await db.query.crmConnection.findFirst({
    where: and(
      eq(tables.crmConnection.id, connectionId),
      eq(tables.crmConnection.organizationId, organizationId),
    ),
  });
  if (!connection) throw new TenancyError("NOT_A_MEMBER", "Connection not found");
  if (connection.provider !== expectedProvider) {
    throw new TenancyError("NOT_A_MEMBER", `Connection is not a ${expectedProvider} connection`);
  }
  const cfg = getProviderConfig(expectedProvider);
  const nango = getNango();
  const session = await nango.createReconnectSession({
    connection_id: connection.nangoConnectionId,
    integration_id: cfg.nangoIntegrationId,
    end_user: {
      id: userId,
    },
    organization: {
      id: organizationId,
    },
  });
  return {
    sessionToken: session.data.token,
    connectUrl: session.data.connect_link,
  };
}

const reconnectCrmSchema = z.object({
  crmConnectionId: z.string().uuid(),
});

export const createSalesforceReconnectSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => reconnectCrmSchema.parse(data))
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    return createCrmReconnectSession(
      data.crmConnectionId,
      "salesforce",
      context.orgContext.organizationId,
      context.orgContext.userId,
    );
  });

export const createHubspotReconnectSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => reconnectCrmSchema.parse(data))
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    return createCrmReconnectSession(
      data.crmConnectionId,
      "hubspot",
      context.orgContext.organizationId,
      context.orgContext.userId,
    );
  });

export const finalizeCrmConnection = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      provider: providerSchema,
      nangoConnectionId: z.string().min(1),
    }),
  )
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    const cfg = getProviderConfig(data.provider);
    const [row] = await db
      .insert(tables.crmConnection)
      .values({
        organizationId: context.orgContext.organizationId,
        provider: data.provider,
        nangoConnectionId: data.nangoConnectionId,
        status: "active",
        fieldMapping: cfg.defaultFieldMapping,
        createdByUserId: context.orgContext.userId,
      })
      .onConflictDoUpdate({
        target: [tables.crmConnection.organizationId, tables.crmConnection.provider],
        set: {
          nangoConnectionId: data.nangoConnectionId,
          status: "active",
          fieldMapping: cfg.defaultFieldMapping,
          lastError: null,
        },
      })
      .returning();

    if (!row) throw new TenancyError("NOT_A_MEMBER", "Failed to save CRM connection");

    const models: Array<"Contact" | "Account" | "Company"> = [
      "Contact",
      data.provider === "hubspot" ? "Company" : "Account",
    ];
    for (const model of models) {
      await enqueue("crm.sync", { connectionId: row.id, model });
    }

    return toDto(row);
  });

export const updateFieldMapping = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      connectionId: z.string().uuid(),
      mapping: fieldMappingSchema,
    }),
  )
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    const [row] = await db
      .update(tables.crmConnection)
      .set({ fieldMapping: data.mapping as FieldMapping })
      .where(
        and(
          eq(tables.crmConnection.id, data.connectionId),
          eq(tables.crmConnection.organizationId, context.orgContext.organizationId),
        ),
      )
      .returning();
    if (!row) throw new TenancyError("NOT_A_MEMBER", "Connection not found");
    return toDto(row);
  });

export const disconnectCrm = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ connectionId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    const connection = await db.query.crmConnection.findFirst({
      where: and(
        eq(tables.crmConnection.id, data.connectionId),
        eq(tables.crmConnection.organizationId, context.orgContext.organizationId),
      ),
    });
    if (!connection) throw new TenancyError("NOT_A_MEMBER", "Connection not found");

    const cfg = getProviderConfig(connection.provider as CrmProvider);
    const nango = getNango();
    await nango.deleteConnection(cfg.nangoIntegrationId, connection.nangoConnectionId);

    const [row] = await db
      .update(tables.crmConnection)
      .set({ status: "disconnected" })
      .where(
        and(
          eq(tables.crmConnection.id, connection.id),
          eq(tables.crmConnection.organizationId, context.orgContext.organizationId),
        ),
      )
      .returning();
    if (!row) throw new TenancyError("NOT_A_MEMBER", "Connection not found");
    return toDto(row);
  });

export const triggerCrmSync = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      connectionId: z.string().uuid(),
      model: z.enum(["Contact", "Account", "Company"]),
      targetListId: z.string().uuid().optional(),
      filter: z.enum(["all", "modified_since", "tagged"]).optional(),
      modifiedSinceDays: z.number().int().positive().optional(),
      tag: z.string().max(200).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    const connection = await db.query.crmConnection.findFirst({
      where: and(
        eq(tables.crmConnection.id, data.connectionId),
        eq(tables.crmConnection.organizationId, context.orgContext.organizationId),
      ),
    });
    if (!connection) throw new TenancyError("NOT_A_MEMBER", "Connection not found");
    await enqueue("crm.sync", {
      connectionId: data.connectionId,
      model: data.model,
      targetListId: data.targetListId,
      filter: data.filter,
      modifiedSinceDays: data.modifiedSinceDays,
      tag: data.tag,
    });
    return { enqueued: true };
  });
