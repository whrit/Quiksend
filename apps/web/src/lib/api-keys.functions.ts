import { auth } from "@quiksend/auth";
import { isAdminOrOwner, type OrgContext } from "@quiksend/core";
import { withTenantTransaction } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { APIError } from "better-auth";
import { and, eq, gte } from "drizzle-orm";
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
 * Core logic behind every `*ApiKey*` server function, factored out so tests
 * can drive it with a hand-built `OrgContext` + real session headers instead
 * of faking a request. Keys are organization-owned (Better Auth
 * `apiKey({ references: "organization" })`, `packages/auth/src/auth.ts`):
 * `apikey.referenceId` *is* the organization id. Authorization is enforced
 * twice on purpose — `isAdminOrOwner` here for a clear app-level error, and
 * again inside Better Auth via the explicit `apiKey` access-control
 * statement on the `organization` plugin (owner + admin, never member) —
 * that grant is what lets create/list/revoke go straight through
 * `auth.api.*` instead of bypassing the plugin's own authorization.
 */
export async function listApiKeysForOrg(
  orgContext: OrgContext,
  authHeaders?: HeadersInit,
): Promise<ApiKeySummary[]> {
  if (!isAdminOrOwner(orgContext)) {
    throw new Error("Admin or owner role required to manage API keys");
  }

  const result = await auth.api.listApiKeys({
    query: { organizationId: orgContext.organizationId, limit: LIST_API_KEYS_LIMIT },
    headers: authHeaders,
  });
  return (result.apiKeys ?? []).map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    enabled: key.enabled,
    createdAt: key.createdAt,
    expiresAt: key.expiresAt,
    lastRequest: key.lastRequest,
  }));
}

export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({}))
  .handler(async ({ context }) => listApiKeysForOrg(context.orgContext, context.authHeaders));

export async function createApiKeyForOrg(
  orgContext: OrgContext,
  data: { name: string; expiresIn?: number },
  authHeaders?: HeadersInit,
): Promise<{
  id: string;
  name: string | null;
  key: string;
  prefix: string | null;
  expiresAt: Date | null;
}> {
  if (!isAdminOrOwner(orgContext)) {
    throw new Error("Admin or owner role required to manage API keys");
  }

  const created = await auth.api.createApiKey({
    body: {
      name: data.name,
      organizationId: orgContext.organizationId,
      // Session/cookie-derived via `authHeaders` in production; passed
      // explicitly too since the plugin's own org-permission check needs an
      // acting user and some callers (e.g. server-only tests) carry no session.
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
  .handler(async ({ data, context }) =>
    createApiKeyForOrg(context.orgContext, data, context.authHeaders),
  );

export async function revokeApiKeyForOrg(
  orgContext: OrgContext,
  keyId: string,
  authHeaders?: HeadersInit,
): Promise<{ ok: true }> {
  if (!isAdminOrOwner(orgContext)) {
    throw new Error("Admin or owner role required to manage API keys");
  }

  try {
    // Deletes by id directly — Better Auth's own `/api-key/delete` looks the
    // key up by id (no pagination to fall through) and authorizes against
    // the key's *actual* owning org via the explicit `apiKey` access-control
    // statement (`packages/auth/src/auth.ts`), not whatever org this caller
    // claims. A pre-`listApiKeys` page, capped at `LIST_API_KEYS_LIMIT`,
    // would silently miss any key past the first page and reject a
    // legitimate revoke — this never lists at all.
    await auth.api.deleteApiKey({
      body: { keyId },
      headers: authHeaders,
    });
  } catch (err) {
    // NOT_FOUND (no such key) and FORBIDDEN (key exists, but belongs to a
    // different org) collapse to the same uniform message — fail closed
    // without telling a caller whether a key id exists in someone else's
    // workspace.
    if (err instanceof APIError && (err.status === "NOT_FOUND" || err.status === "FORBIDDEN")) {
      throw new Error("API key not found in this workspace", { cause: err });
    }
    throw err;
  }

  return { ok: true as const };
}

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ keyId: z.string().min(1) }))
  .handler(async ({ data, context }) =>
    revokeApiKeyForOrg(context.orgContext, data.keyId, context.authHeaders),
  );

export const getApiUsageSummary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ apiKeyId: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    return withTenantTransaction(organizationId, async (tx) => {
      const conditions = [
        eq(tables.apiKeyUsage.organizationId, organizationId),
        gte(tables.apiKeyUsage.timestamp, since),
      ];
      if (data.apiKeyId) {
        conditions.push(eq(tables.apiKeyUsage.apiKeyId, data.apiKeyId));
      }

      const rows = await tx.query.apiKeyUsage.findMany({
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
  });
