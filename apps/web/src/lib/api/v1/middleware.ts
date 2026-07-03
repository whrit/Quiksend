import "@tanstack/react-start/server-only";

import { auth } from "@quiksend/auth";
import { env } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, eq, sql } from "drizzle-orm";
import { countRecentApiKeyUsage, recordApiKeyUsage } from "./helpers.ts";

export const DEFAULT_API_RATE_LIMIT = 100;
export const API_RATE_WINDOW_MS = 60_000;

export interface ApiAuthContext {
  apiKeyId: string;
  orgId: string;
  userId: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export function jsonData<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status });
}

export function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } } satisfies ApiErrorBody, { status });
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

function clientIp(request: Request): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null
  );
}

export function parseKeyMetadata(metadata: unknown): { organizationId?: string } {
  if (!metadata) return {};
  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata) as { organizationId?: string };
    } catch {
      return {};
    }
  }
  if (typeof metadata === "object") return metadata as { organizationId?: string };
  return {};
}

async function resolveOrganizationFromApiKey(keyRecord: {
  id: string;
  referenceId: string;
  metadata: unknown;
}): Promise<{ orgId: string; userId: string } | null> {
  const orgId = parseKeyMetadata(keyRecord.metadata).organizationId;
  if (!orgId) return null;

  const membership = await db.query.member.findFirst({
    where: and(
      eq(tables.member.userId, keyRecord.referenceId),
      eq(tables.member.organizationId, orgId),
    ),
  });
  if (!membership) return null;

  return { orgId, userId: keyRecord.referenceId };
}

export async function resolveApiKey(request: Request): Promise<ApiAuthContext | null> {
  const rawKey = extractBearerToken(request);
  if (!rawKey) return null;

  const result = await auth.api.verifyApiKey({
    body: { key: rawKey },
  });
  if (!result.valid || !result.key) return null;

  const referenceId = result.key.referenceId;
  if (!referenceId) return null;

  const scope = await resolveOrganizationFromApiKey({
    id: result.key.id,
    referenceId,
    metadata: result.key.metadata ?? null,
  });
  if (!scope) return null;

  return {
    apiKeyId: result.key.id,
    orgId: scope.orgId,
    userId: scope.userId,
  };
}

export async function withApiAuth(
  request: Request,
  handler: (ctx: ApiAuthContext) => Promise<Response>,
): Promise<Response> {
  const ctx = await resolveApiKey(request);
  if (!ctx) return jsonError("UNAUTHORIZED", "Invalid or missing API key", 401);

  const recent = await countRecentApiKeyUsage(ctx.apiKeyId, API_RATE_WINDOW_MS);
  if (recent >= DEFAULT_API_RATE_LIMIT) {
    const retryAfter = Math.ceil(API_RATE_WINDOW_MS / 1000);
    return new Response(
      JSON.stringify({
        error: { code: "RATE_LIMITED", message: "API rate limit exceeded" },
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
        },
      },
    );
  }

  const url = new URL(request.url);
  let response: Response;
  try {
    response = await handler(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    response = jsonError("INTERNAL", message, 500);
  }

  await recordApiKeyUsage({
    organizationId: ctx.orgId,
    apiKeyId: ctx.apiKeyId,
    endpoint: url.pathname,
    method: request.method,
    statusCode: response.status,
    ipAddress: clientIp(request),
  });

  return response;
}

export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function parseLimit(value: string | null, fallback = 50, max = 500): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export function parseCursor(value: string | null): { id: string; createdAt: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { id?: string; createdAt?: string };
    if (!parsed.id || !parsed.createdAt) return null;
    return { id: parsed.id, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

export function encodeCursor(cursor: { id: string; createdAt: string } | null): string | null {
  if (!cursor) return null;
  return JSON.stringify(cursor);
}

/** Per-IP rate limit for unauthenticated routes (auth endpoints). */
export const AUTH_IP_RATE_LIMIT = 100;
export const AUTH_IP_RATE_WINDOW_MS = 60_000;

export type AuthRateLimitOutcome = { ok: true } | { ok: false; retryAfter: number };

export async function checkAuthIpRateLimit(
  request: Request,
  limit = AUTH_IP_RATE_LIMIT,
  windowMs = AUTH_IP_RATE_WINDOW_MS,
): Promise<AuthRateLimitOutcome> {
  const ip = clientIp(request) ?? "unknown";
  const windowSec = windowMs / 1000;

  await db.execute(sql`
    INSERT INTO auth_rate_bucket (key, tokens, updated_at)
    VALUES (${ip}, ${limit}, now())
    ON CONFLICT (key) DO UPDATE SET
      tokens = LEAST(
        auth_rate_bucket.tokens + GREATEST(0, FLOOR(
          EXTRACT(EPOCH FROM (now() - auth_rate_bucket.updated_at)) / ${windowSec} * ${limit}
        )::int),
        ${limit}
      ),
      updated_at = now()
  `);

  const consumed = await db.execute<{ tokens: number }>(sql`
    UPDATE auth_rate_bucket
    SET tokens = tokens - 1, updated_at = now()
    WHERE key = ${ip} AND tokens >= 1
    RETURNING tokens
  `);

  if (consumed.length === 0) {
    return { ok: false, retryAfter: Math.ceil(windowSec) };
  }
  return { ok: true };
}

export function publicBaseUrl(request: Request): string {
  return env.BETTER_AUTH_URL ?? new URL(request.url).origin;
}
