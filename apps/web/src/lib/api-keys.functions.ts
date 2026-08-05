import { auth } from "@quiksend/auth";
import { isAdminOrOwner, type OrgContext } from "@quiksend/core";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./org-fn.ts";

const createApiKeySchema = z.object({
  name: z.string().min(1).max(200),
  expiresIn: z.number().int().positive().optional(),
});

const LIST_API_KEYS_LIMIT = 100;

export interface ApiKeySummary {
  id: string;
  name: string | null;
  prefix: string | null;
  enabled: boolean;
  createdAt: Date;
  expiresAt: Date | null;
  lastRequest: Date | null;
}

/**
 * List/revoke go straight to the table: Better Auth's own endpoints only
 * grant the `owner` role — this app's admin-or-owner policy needs direct DB.
 * Create still uses `auth.api.createApiKey` for key generation and hashing.
 */
export async function listApiKeysForOrg(orgContext: OrgContext): Promise<ApiKeySummary[]> {
  if (!isAdminOrOwner(orgContext)) {
    throw new Error("Admin or owner role required to manage API keys");
  }

  const rows = await db.query.apikey.findMany({
    where: eq(tables.apikey.referenceId, orgContext.organizationId),
    orderBy: [desc(tables.apikey.createdAt)],
    limit: LIST_API_KEYS_LIMIT,
    columns: {
      id: true,
      name: true,
      prefix: true,
      enabled: true,
      createdAt: true,
      expiresAt: true,
      lastRequest: true,
    },
  });
  return rows.map((row) => ({ ...row, enabled: row.enabled ?? true }));
}

export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({}))
  .handler(async ({ context }) => listApiKeysForOrg(context.orgContext));

export async function createApiKeyForOrg(
  orgContext: OrgContext,
  data: { name: string; expiresIn?: number },
  authHeaders?: HeadersInit,
): Promise<{ id: string; name: string | null; key: string; prefix: string | null; expiresAt: Date | null }> {
  if (!isAdminOrOwner(orgContext)) {
    throw new Error("Admin or owner role required to manage API keys");
  }

  const created = await auth.api.createApiKey({
    body: {
      name: data.name,
      organizationId: orgContext.organizationId,
      // Plugin org-permission check needs an acting user; tests have no session.
      userId: orgContext.userId,
      expiresIn: data.expiresIn,
      prefix: "qsk",
    },
    headers: authHeaders,
  });

  return {
    id: created.id,
    name: created.name,
    key: created.key,
    prefix: created.prefix,
    expiresAt: created.expiresAt,
  };
}

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(createApiKeySchema)
  .handler(async ({ data, context }) => createApiKeyForOrg(context.orgContext, data, context.authHeaders));

export async function revokeApiKeyForOrg(orgContext: OrgContext, keyId: string): Promise<{ ok: true }> {
  if (!isAdminOrOwner(orgContext)) {
    throw new Error("Admin or owner role required to manage API keys");
  }

  const deleted = await db
    .delete(tables.apikey)
    .where(and(eq(tables.apikey.id, keyId), eq(tables.apikey.referenceId, orgContext.organizationId)))
    .returning({ id: tables.apikey.id });
  if (deleted.length === 0) {
    throw new Error("API key not found in this workspace");
  }

  return { ok: true as const };
}

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ keyId: z.string().min(1) }))
  .handler(async ({ data, context }) => revokeApiKeyForOrg(context.orgContext, data.keyId));

export const getApiUsageSummary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ apiKeyId: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const conditions = [
      eq(tables.apiKeyUsage.organizationId, organizationId),
      gte(tables.apiKeyUsage.timestamp, since),
    ];
    if (data.apiKeyId) {
      conditions.push(eq(tables.apiKeyUsage.apiKeyId, data.apiKeyId));
    }

    const rows = await db.query.apiKeyUsage.findMany({
      where: and(...conditions),
    });

    return {
      total24h: rows.length,
      byStatus: rows.reduce<Record<number, number>>((acc, row) => {
        acc[row.statusCode] = (acc[row.statusCode] ?? 0) + 1;
        return acc;
      }, {}),
    };
  });
