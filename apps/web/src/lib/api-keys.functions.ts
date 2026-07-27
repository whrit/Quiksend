import { auth } from "@quiksend/auth";
import { isAdminOrOwner } from "@quiksend/core";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./org-fn.ts";

const createApiKeySchema = z.object({
  name: z.string().min(1).max(200),
  expiresIn: z.number().int().positive().optional(),
});

const LIST_API_KEYS_LIMIT = 100;

export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({}))
  .handler(async ({ context }) => {
    const { organizationId } = context.orgContext;
    const result = await auth.api.listApiKeys({
      query: { organizationId, limit: LIST_API_KEYS_LIMIT },
      headers: context.authHeaders,
    });
    const keys = (result.apiKeys ?? []).map((key) => ({
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      enabled: key.enabled,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      lastRequest: key.lastRequest,
    }));
    return Object.assign(keys, { truncated: keys.length >= LIST_API_KEYS_LIMIT });
  });

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(createApiKeySchema)
  .handler(async ({ data, context }) => {
    if (!isAdminOrOwner(context.orgContext)) {
      throw new Error("Admin or owner role required to manage API keys");
    }
    const { organizationId, userId } = context.orgContext;

    const created = await auth.api.createApiKey({
      body: {
        name: data.name,
        userId,
        expiresIn: data.expiresIn,
        prefix: "qsk",
        metadata: JSON.stringify({ organizationId }),
      },
      headers: context.authHeaders,
    });

    return {
      id: created.id,
      name: created.name,
      key: created.key,
      prefix: created.prefix,
      expiresAt: created.expiresAt,
    };
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ keyId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    if (!isAdminOrOwner(context.orgContext)) {
      throw new Error("Admin or owner role required to manage API keys");
    }
    const { organizationId } = context.orgContext;

    const listed = await auth.api.listApiKeys({
      query: { organizationId, limit: LIST_API_KEYS_LIMIT },
      headers: context.authHeaders,
    });
    const existing = (listed.apiKeys ?? []).find((key) => key.id === data.keyId);
    if (!existing) {
      throw new Error("API key not found in this workspace");
    }

    await auth.api.deleteApiKey({
      body: { keyId: data.keyId },
      headers: context.authHeaders,
    });

    return { ok: true as const };
  });

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
