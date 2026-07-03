import "@tanstack/react-start/server-only";

import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { eq } from "drizzle-orm";

/**
 * Server-only reader for a workspace's raw metadata blob. Used by the
 * `organization.functions.ts` handlers to hydrate deliverability/canary policy;
 * kept out of the main file so its `@quiksend/db` import doesn't reach any
 * client-side route that pulls `organization.functions.ts` through routeTree.
 */
export async function loadOrgMetadata(organizationId: string): Promise<string | null> {
  const org = await db.query.organization.findFirst({
    where: eq(tables.organization.id, organizationId),
    columns: { metadata: true },
  });
  if (!org) throw new OrgNotFoundError();
  return org.metadata;
}

export class OrgNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  constructor() {
    super("Workspace not found");
    this.name = "OrgNotFoundError";
  }
}

export type RoutingImpactPreview = {
  prospectsBehindSeg: number;
  safeMailboxCount: number;
  prospectsAtRiskOfSkip: number;
  prospectsPerGateway: Array<{ gateway: string; count: number }>;
};

import { SEG_GATEWAYS } from "@quiksend/core/deliverability";
import { and, inArray, isNull, sql } from "drizzle-orm";

export async function computeRoutingImpact(organizationId: string): Promise<RoutingImpactPreview> {
  const segGateways = [...SEG_GATEWAYS];

  const segProspects = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tables.prospect)
    .where(
      and(
        eq(tables.prospect.organizationId, organizationId),
        isNull(tables.prospect.deletedAt),
        inArray(tables.prospect.emailGateway, segGateways),
      ),
    );

  const prospectsBehindSeg = segProspects[0]?.count ?? 0;

  const safeMailboxes = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tables.mailbox)
    .where(
      and(
        eq(tables.mailbox.organizationId, organizationId),
        eq(tables.mailbox.status, "active"),
        eq(tables.mailbox.enterpriseSafe, true),
        eq(tables.mailbox.enterpriseSafeAutoDowngraded, false),
      ),
    );

  const safeMailboxCount = safeMailboxes[0]?.count ?? 0;

  const perGateway = await db
    .select({
      gateway: tables.prospect.emailGateway,
      count: sql<number>`count(*)::int`,
    })
    .from(tables.prospect)
    .where(
      and(
        eq(tables.prospect.organizationId, organizationId),
        isNull(tables.prospect.deletedAt),
        inArray(tables.prospect.emailGateway, segGateways),
      ),
    )
    .groupBy(tables.prospect.emailGateway);

  return {
    prospectsBehindSeg,
    safeMailboxCount,
    prospectsAtRiskOfSkip: safeMailboxCount === 0 ? prospectsBehindSeg : 0,
    prospectsPerGateway: perGateway
      .filter((row) => row.gateway != null)
      .map((row) => ({ gateway: row.gateway!, count: row.count })),
  };
}
