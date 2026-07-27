import "@tanstack/react-start/server-only";

import { auth } from "@quiksend/auth";
import { env, logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { getRequestIP } from "@tanstack/react-start/server";
import { and, eq, sql } from "drizzle-orm";
import { recordApiKeyUsage } from "./helpers.ts";

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

function isTruthyEnvFlag(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function normalizeIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  return ip.replace(/^::ffff:/, "");
}

function trustedProxyPeers(): Set<string> {
  const raw = process.env.TRUSTED_PROXY_IPS ?? "127.0.0.1,::1,::ffff:127.0.0.1";
  return new Set(
    raw
      .split(",")
      .map((entry) => normalizeIp(entry.trim()))
      .filter((entry): entry is string => Boolean(entry)),
  );
}

function trustProxyEnabled(): boolean {
  return isTruthyEnvFlag(process.env.TRUST_PROXY);
}

function clientIp(_request: Request): string | null {
  let peerIp: string | null;
  try {
    peerIp = normalizeIp(getRequestIP({ xForwardedFor: false }));
  } catch {
    // Outside the TanStack Start request context (e.g. unit tests).
    return null;
  }

  if (trustProxyEnabled() && peerIp && trustedProxyPeers().has(peerIp)) {
    return normalizeIp(getRequestIP({ xForwardedFor: true }));
  }

  return peerIp;
}

function rateLimitIpKey(request: Request): string {
  return `ip:${clientIp(request) ?? "unknown"}`;
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

export async function checkApiKeyRateLimit(
  apiKeyId: string,
  limit = DEFAULT_API_RATE_LIMIT,
  windowMs = API_RATE_WINDOW_MS,
): Promise<AuthRateLimitOutcome> {
  const key = `api:${apiKeyId}`;
  const windowSec = windowMs / 1000;

  await db.execute(sql`
    INSERT INTO auth_rate_bucket (key, tokens, updated_at)
    VALUES (${key}, ${limit}, now())
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
    WHERE key = ${key} AND tokens >= 1
    RETURNING tokens
  `);

  if (consumed.length === 0) {
    return { ok: false, retryAfter: Math.ceil(windowSec) };
  }
  return { ok: true };
}

export async function withApiAuth(
  request: Request,
  handler: (ctx: ApiAuthContext) => Promise<Response>,
): Promise<Response> {
  const ctx = await resolveApiKey(request);
  if (!ctx) return jsonError("UNAUTHORIZED", "Invalid or missing API key", 401);

  const rateLimit = await checkApiKeyRateLimit(ctx.apiKeyId);
  if (!rateLimit.ok) {
    return new Response(
      JSON.stringify({
        error: { code: "RATE_LIMITED", message: "API rate limit exceeded" },
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rateLimit.retryAfter),
        },
      },
    );
  }

  const url = new URL(request.url);
  let response: Response;
  try {
    response = await handler(ctx);
  } catch (err) {
    logger.error({ err }, "API handler failed");
    response = jsonError("INTERNAL", "Internal server error", 500);
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
/** Stricter per-IP limit for credential-bearing auth routes (sign-in, sign-up, reset). */
export const AUTH_CREDENTIAL_IP_RATE_LIMIT = 10;
export const AUTH_IP_RATE_WINDOW_MS = 60_000;

function isAuthCredentialRoute(pathname: string): boolean {
  return (
    /\/sign-in(?:\/|$)/.test(pathname) ||
    /\/sign-up(?:\/|$)/.test(pathname) ||
    /\/forget-password(?:\/|$)/.test(pathname) ||
    /\/forgot-password(?:\/|$)/.test(pathname) ||
    /\/reset-password(?:\/|$)/.test(pathname)
  );
}

function authIpRateLimitFor(request: Request): number {
  const pathname = new URL(request.url).pathname;
  return isAuthCredentialRoute(pathname) ? AUTH_CREDENTIAL_IP_RATE_LIMIT : AUTH_IP_RATE_LIMIT;
}

export type AuthRateLimitOutcome = { ok: true } | { ok: false; retryAfter: number };

export async function checkAuthIpRateLimit(
  request: Request,
  limit?: number,
  windowMs = AUTH_IP_RATE_WINDOW_MS,
): Promise<AuthRateLimitOutcome> {
  const effectiveLimit = limit ?? authIpRateLimitFor(request);
  const ip = rateLimitIpKey(request);
  const windowSec = windowMs / 1000;

  await db.execute(sql`
    INSERT INTO auth_rate_bucket (key, tokens, updated_at)
    VALUES (${ip}, ${effectiveLimit}, now())
    ON CONFLICT (key) DO UPDATE SET
      tokens = LEAST(
        auth_rate_bucket.tokens + GREATEST(0, FLOOR(
          EXTRACT(EPOCH FROM (now() - auth_rate_bucket.updated_at)) / ${windowSec} * ${effectiveLimit}
        )::int),
        ${effectiveLimit}
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
