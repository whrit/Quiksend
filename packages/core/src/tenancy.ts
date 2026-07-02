/**
 * Tenancy primitives. Branded string types make it a compile-time error to hand a
 * bare `string` where an `OrganizationId` (workspace id) is expected — the single
 * hardest tenancy bug in a multi-tenant SaaS. The `orgFn` server-side middleware
 * (`apps/web/src/lib/org-fn.ts`) is the runtime chokepoint that mints these.
 */
declare const orgBrand: unique symbol;
declare const userBrand: unique symbol;

export type OrganizationId = string & { readonly [orgBrand]: "OrganizationId" };
export type UserId = string & { readonly [userBrand]: "UserId" };

export type MemberRole = "owner" | "admin" | "member";

export interface OrgContext {
  readonly userId: UserId;
  readonly organizationId: OrganizationId;
  readonly role: MemberRole;
}

/** Widening cast used at trust boundaries (session → context). Never expose to callers. */
export function asOrganizationId(id: string): OrganizationId {
  return id as OrganizationId;
}

export function asUserId(id: string): UserId {
  return id as UserId;
}

export function isAdminOrOwner(ctx: OrgContext): boolean {
  return ctx.role === "admin" || ctx.role === "owner";
}
