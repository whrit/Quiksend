import { logger } from "@quiksend/config";
import { db, recordAudit } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";

/**
 * Better Auth `hooks.before` / `hooks.after` wiring for Task 5's audit
 * trail. Kept out of `auth.ts` so the core auth config stays small and this
 * package's single canonical `isRecord`-style guard has exactly one home.
 *
 * Every `auth.api.*` call (server-side, e.g.
 * `apps/web/src/lib/api-keys.functions.ts`) and every HTTP request to
 * `/api/auth/*` dispatches through the same pipeline
 * (`dispatchAuthEndpoint`), so `hooks.after` is the one place that sees
 * API-key and invitation/member mutations regardless of caller.
 *
 * Deliberately narrow: only paths that are inherently organization-scoped
 * are covered. Generic auth (sign-in, sign-up, sign-out, password reset)
 * has no organization at the point it happens and doesn't fit this
 * append-only, org-scoped table — see `withOwnerReauth` in
 * `apps/web/src/lib/api/v1/lifecycle-auth.ts` for the one auth event that
 * IS audited (reauthentication ahead of organization deletion, which is
 * already org-scoped by construction).
 */

interface AuditableOrgEvent {
  organizationId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** This package's single canonical object guard — see `ts-no-local-is-record`; do not redefine elsewhere. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads `value[key]` only after confirming `value` is an object — returns `undefined` for any other shape. */
function stringField(value: unknown, key: string): string | undefined {
  const field = isRecord(value) ? value[key] : undefined;
  return typeof field === "string" ? field : undefined;
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  const field = isRecord(value) ? value[key] : undefined;
  return isRecord(field) ? field : undefined;
}

/** `apikey.metadata` is the JSON string `apps/web/src/lib/api-keys.functions.ts` sets on create. */
function parseApiKeyOrganizationId(metadata: unknown): string | null {
  if (typeof metadata !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    return stringField(parsed, "organizationId") ?? null;
  } catch {
    return null;
  }
}

const AUDITED_ORG_EVENT_PATHS: Record<
  string,
  (ctx: { context: unknown; body: unknown }) => AuditableOrgEvent | null
> = {
  "/organization/invite-member": (ctx) => {
    const invitation = recordField(ctx.context, "returned");
    const organizationId = stringField(invitation, "organizationId");
    if (!organizationId) return null;
    return {
      organizationId,
      action: "invitation.create",
      entityType: "invitation",
      entityId: stringField(invitation, "id") ?? null,
      metadata: { email: stringField(invitation, "email"), role: stringField(invitation, "role") },
    };
  },
  "/organization/accept-invitation": (ctx) => {
    const returned = recordField(ctx.context, "returned");
    const invitation = recordField(returned, "invitation");
    const organizationId = stringField(invitation, "organizationId");
    if (!organizationId) return null;
    const member = recordField(returned, "member");
    return {
      organizationId,
      action: "invitation.accept",
      entityType: "invitation",
      entityId: stringField(invitation, "id") ?? null,
      metadata: { memberId: stringField(member, "id") },
    };
  },
  "/organization/reject-invitation": (ctx) => {
    const invitation = recordField(recordField(ctx.context, "returned"), "invitation");
    const organizationId = stringField(invitation, "organizationId");
    if (!organizationId) return null;
    return {
      organizationId,
      action: "invitation.reject",
      entityType: "invitation",
      entityId: stringField(invitation, "id") ?? null,
    };
  },
  "/organization/cancel-invitation": (ctx) => {
    const invitation = recordField(ctx.context, "returned");
    const organizationId = stringField(invitation, "organizationId");
    if (!organizationId) return null;
    return {
      organizationId,
      action: "invitation.cancel",
      entityType: "invitation",
      entityId: stringField(invitation, "id") ?? null,
    };
  },
  "/organization/remove-member": (ctx) => {
    const member = recordField(recordField(ctx.context, "returned"), "member");
    const organizationId = stringField(member, "organizationId");
    if (!organizationId) return null;
    return {
      organizationId,
      action: "member.remove",
      entityType: "member",
      entityId: stringField(member, "id") ?? null,
      metadata: { removedUserId: stringField(member, "userId"), role: stringField(member, "role") },
    };
  },
  "/organization/update-member-role": (ctx) => {
    const member = recordField(recordField(ctx.context, "returned"), "member");
    const organizationId = stringField(member, "organizationId");
    if (!organizationId) return null;
    return {
      organizationId,
      action: "member.update_role",
      entityType: "member",
      entityId: stringField(member, "id") ?? null,
      metadata: { userId: stringField(member, "userId"), role: stringField(member, "role") },
    };
  },
  "/api-key/create": (ctx) => {
    const key = recordField(ctx.context, "returned");
    const organizationId = parseApiKeyOrganizationId(key ? key.metadata : undefined);
    if (!organizationId) return null;
    return {
      organizationId,
      action: "api_key.create",
      entityType: "api_key",
      entityId: stringField(key, "id") ?? null,
      metadata: { name: stringField(key, "name") },
    };
  },
  "/api-key/delete": (ctx) => {
    // No `metadata` on the response — org id was captured by `auditBeforeHook`
    // while the key still existed, stashed on the shared context.
    const organizationId = stringField(ctx.context, "auditApiKeyOrganizationId");
    if (!organizationId) return null;
    return {
      organizationId,
      action: "api_key.revoke",
      entityType: "api_key",
      entityId: stringField(ctx.body, "keyId") ?? null,
    };
  },
};

export const auditBeforeHook = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/api-key/delete") return;
  const keyId = stringField(ctx.body, "keyId");
  if (!keyId) return;

  const existing = await db.query.apikey.findFirst({
    where: eq(tables.apikey.id, keyId),
    columns: { metadata: true },
  });
  const organizationId = parseApiKeyOrganizationId(existing?.metadata);
  if (!organizationId) return;
  return { context: { auditApiKeyOrganizationId: organizationId } };
});

export const auditAfterHook = createAuthMiddleware(async (ctx) => {
  const resolve = AUDITED_ORG_EVENT_PATHS[ctx.path];
  if (!resolve) return;

  try {
    const event = resolve(ctx);
    if (!event) return;
    const sessionUser = recordField(recordField(ctx.context, "session"), "user");
    await recordAudit({
      organizationId: event.organizationId,
      actorType: "user",
      actorId: stringField(sessionUser, "id") ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      metadata: event.metadata,
    });
  } catch (err) {
    // Audit logging must never break the underlying auth mutation.
    logger.error({ err, path: ctx.path }, "Failed to record audit event");
  }
});
