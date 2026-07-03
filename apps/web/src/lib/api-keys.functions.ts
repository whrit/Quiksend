import { auth } from "@quiksend/auth";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { parseKeyMetadata } from "./api/v1/middleware.ts";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./org-fn.ts";

const createApiKeySchema = z.object({
  name: z.string().min(1).max(200),
  expiresIn: z.number().int().positive().optional(),
});

export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({}))
  .handler(async ({ context }) => {
    const { organizationId } = context.orgContext;
    const result = await auth.api.listApiKeys({
      query: { organizationId, limit: 100 },
      headers: context.authHeaders,
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

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(createApiKeySchema)
  .handler(async ({ data, context }) => {
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
    const { organizationId } = context.orgContext;

    const existing = await auth.api.getApiKey({
      query: { id: data.keyId },
      headers: context.authHeaders,
    });

    let keyOrgId: string | undefined;
    keyOrgId = parseKeyMetadata(existing.metadata).organizationId;
    if (keyOrgId !== organizationId) {
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
