import { auth } from "@quiksend/auth";
import { db, tables } from "@quiksend/db";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { parseKeyMetadata } from "./api/v1/middleware.ts";
import { orgFn } from "./org-fn.ts";

const createApiKeySchema = z.object({
  name: z.string().min(1).max(200),
  expiresIn: z.number().int().positive().optional(),
});

export const listApiKeys = orgFn({ method: "GET" })
  .validator(z.object({}))
  .handler(async ({ context }) => {
    const { organizationId } = context.orgContext;
    const headers = getRequestHeaders();
    const result = await auth.api.listApiKeys({
      query: { organizationId, limit: 100 },
      headers,
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
  });

export const createApiKey = orgFn({ method: "POST" })
  .validator(createApiKeySchema)
  .handler(async ({ data, context }) => {
    const { organizationId, userId } = context.orgContext;
    const headers = getRequestHeaders();

    const created = await auth.api.createApiKey({
      body: {
        name: data.name,
        userId,
        expiresIn: data.expiresIn,
        prefix: "qsk",
        metadata: JSON.stringify({ organizationId }),
      },
      headers,
    });

    return {
      id: created.id,
      name: created.name,
      key: created.key,
      prefix: created.prefix,
      expiresAt: created.expiresAt,
    };
  });

export const revokeApiKey = orgFn({ method: "POST" })
  .validator(z.object({ keyId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const headers = getRequestHeaders();

    const existing = await auth.api.getApiKey({
      query: { id: data.keyId },
      headers,
    });

    let keyOrgId: string | undefined;
    keyOrgId = parseKeyMetadata(existing.metadata).organizationId;
    if (keyOrgId !== organizationId) {
      throw new Error("API key not found in this workspace");
    }

    await auth.api.deleteApiKey({
      body: { keyId: data.keyId },
      headers,
    });

    return { ok: true as const };
  });

export const getApiUsageSummary = orgFn({ method: "GET" })
  .validator(z.object({ apiKeyId: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const rows = await db.query.apiKeyUsage.findMany({
      where: eq(tables.apiKeyUsage.organizationId, organizationId),
      limit: 5000,
    });

    const recent = rows.filter(
      (r) => r.timestamp >= since && (!data.apiKeyId || r.apiKeyId === data.apiKeyId),
    );
    return {
      total24h: recent.length,
      byStatus: recent.reduce<Record<number, number>>((acc, row) => {
        acc[row.statusCode] = (acc[row.statusCode] ?? 0) + 1;
        return acc;
      }, {}),
    };
  });
