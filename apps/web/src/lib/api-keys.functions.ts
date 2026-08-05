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
 * Core logic behind every `*ApiKey*` server function below, factored out so
 * tests can drive it with a hand-built `OrgContext` (see
 * `api-keys-tenancy.test.ts`) instead of faking a request/session — the
 * `createServerFn(...).handler(...)` wrappers are thin adapters over these.
 *
 * Keys are organization-owned (Better Auth `apiKey({ references: "organization" })`,
 * see `packages/auth/src/auth.ts`): `apikey.referenceId` *is* the organization id,
 * the single source of tenancy truth. List/revoke query and mutate that column
 * directly — Better Auth's own list/delete endpoints require a live session
 * (`sessionMiddleware`) and only grant the org's `owner` role by default, which
 * is stricter than this app's admin-or-owner API-key policy; going straight to
 * the table keeps that policy uniform with every other org-scoped server
 * function here (all of which query `db` directly, never re-issue an
 * `auth.api.*` call). Create still goes through `auth.api.createApiKey` — key
 * generation and hashing genuinely live in the plugin.
 */
export async function listApiKeysForOrg(orgContext: OrgContext): Promise<ApiKeySummary[] & { truncated: boolean }> {
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
  const keys = rows.map((row) => ({ ...row, enabled: row.enabled ?? true }));
  return Object.assign(keys, { truncated: keys.length >= LIST_API_KEYS_LIMIT });
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
      // Session/cookie-derived via `authHeaders` in production; passed explicitly
      // too since the plugin's own org-permission check needs an acting user and
      // tests don't carry a real session.
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
