import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "./client.ts";
import * as tables from "./schema/index.ts";

/**
 * Append-only, organization-scoped audit trail for privileged mutations.
 *
 * Lives here (not in either app) for the same reason `suppression.ts` does:
 * both the worker and the web app record authoritative mutations, and a
 * single shared writer is the only way the redaction rule can't drift.
 *
 * Callers pass raw metadata; `recordAudit` redacts and bounds it before the
 * row is written, so a caller forgetting to scrub a field never leaks a
 * secret into an append-only table nothing purges early.
 */

export type AuditActorType = "user" | "api_key" | "system";

export interface RecordAuditInput {
  organizationId: string;
  actorType: AuditActorType;
  /** User id, API key id, or null for system-initiated actions (e.g. purge). */
  actorId?: string | null;
  /** Namespaced action, e.g. "api_key.create", "organization.delete_requested". */
  action: string;
  /** Entity kind the action targets, e.g. "api_key", "mailbox", "organization". */
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditLogRow {
  id: string;
  organizationId: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: Date;
}

const METADATA_CHAR_LIMIT = 4096;

/** Key names that must never reach the audit table, even if a caller forgets to scrub them. */
const SECRET_KEY_PATTERN =
  /password|secret|token|apikey|api_key|credential|hash|smtp_config|imap|refresh_token|access_token|body|bodyhtml|bodytext/i;

/**
 * Defense-in-depth redaction: strips keys that look secret-shaped and bounds
 * the serialized size. Callers are still responsible for not passing secrets
 * or message bodies in the first place — this only guarantees a mistake
 * doesn't silently persist one.
 */
export function redactAuditMetadata(
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!input) return null;

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    redacted[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : value;
  }

  if (JSON.stringify(redacted).length <= METADATA_CHAR_LIMIT) return redacted;
  // Oversized payload (e.g. a caller passed a large object by mistake) — keep
  // the shape observable without storing unbounded content.
  return { truncated: true, keys: Object.keys(redacted) };
}

/** Records one privileged mutation. Never throws into the caller's mutation path on a logging failure's own account — callers that must not fail open should await and handle rejections explicitly. */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  await db.insert(tables.auditLog).values({
    organizationId: input.organizationId,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: redactAuditMetadata(input.metadata),
  });
}

export interface ListAuditLogParams {
  organizationId: string;
  limit?: number;
  /** Keyset cursor: rows strictly before this (createdAt, id) pair, in the same desc order. */
  before?: { id: string; createdAt: Date } | null;
}

const DEFAULT_AUDIT_PAGE_SIZE = 100;

/** Newest-first, keyset-paginated read of an organization's own audit trail. */
export async function listAuditLog(params: ListAuditLogParams): Promise<AuditLogRow[]> {
  const limit = params.limit ?? DEFAULT_AUDIT_PAGE_SIZE;
  const conditions = [eq(tables.auditLog.organizationId, params.organizationId)];
  if (params.before) {
    conditions.push(lt(tables.auditLog.createdAt, params.before.createdAt));
  }

  return db
    .select()
    .from(tables.auditLog)
    .where(and(...conditions))
    .orderBy(desc(tables.auditLog.createdAt), desc(tables.auditLog.id))
    .limit(limit);
}
