import { isAdminOrOwner } from "@quiksend/core";
import {
  SEG_GATEWAYS,
  mergeDeliverabilityPolicy,
  parseDeliverabilityPolicy,
  type DeliverabilityPolicy,
  type RoutingPolicy,
} from "@quiksend/core/deliverability";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import {
  computeRoutingImpact,
  loadOrgMetadata,
  type RoutingImpactPreview,
} from "./organization.server.ts";
export type { RoutingImpactPreview };
import { authMiddleware } from "./org-fn.ts";

class OrganizationError extends Error {
  readonly code: "FORBIDDEN" | "NOT_FOUND";
  constructor(code: OrganizationError["code"], message: string) {
    super(message);
    this.name = "OrganizationError";
    this.code = code;
  }
}

function requireAdmin(ctx: { orgContext: { role: string } }): void {
  if (!isAdminOrOwner(ctx.orgContext as never)) {
    throw new OrganizationError("FORBIDDEN", "Admin or owner role required");
  }
}

export const getWorkspaceDeliverabilityPolicy = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const metadata = await loadOrgMetadata(context.orgContext.organizationId);
    return parseDeliverabilityPolicy(metadata);
  });

export const setWorkspaceDeliverabilityPolicy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        routingPolicy: z.enum(["off", "warn", "enforce"]),
        contentSanitizerEnabled: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    requireAdmin({ orgContext: context.orgContext });
    const organizationId = context.orgContext.organizationId;
    const metadata = await loadOrgMetadata(organizationId);
    const nextMetadata = mergeDeliverabilityPolicy(metadata, {
      routingPolicy: data.routingPolicy,
      contentSanitizerEnabled: data.contentSanitizerEnabled,
      changedBy: context.orgContext.userId,
    });

    await db
      .update(tables.organization)
      .set({ metadata: nextMetadata })
      .where(eq(tables.organization.id, organizationId));

    await db.insert(tables.event).values({
      organizationId,
      type: "workspace.deliverability_policy_changed",
      entityType: "organization",
      entityId: organizationId,
      payload: {
        routingPolicy: data.routingPolicy,
        contentSanitizerEnabled: data.contentSanitizerEnabled ?? data.routingPolicy !== "off",
      },
    });

    return parseDeliverabilityPolicy(nextMetadata);
  });

export const previewRoutingImpact = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return computeRoutingImpact(context.orgContext.organizationId);
  });

export type SequenceDeliverabilityRisk = {
  segProspectCount: number;
  safeMailboxCount: number;
  showBanner: boolean;
};

export const getSequenceDeliverabilityRisk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ sequenceId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const organizationId = context.orgContext.organizationId;
    const sequence = await db.query.sequence.findFirst({
      where: and(
        eq(tables.sequence.id, data.sequenceId),
        eq(tables.sequence.organizationId, organizationId),
      ),
    });
    if (!sequence) throw new OrganizationError("NOT_FOUND", "Sequence not found");

    const segGateways = [...SEG_GATEWAYS];
    const segEnrolled = await db
      .select({ count: sql<number>`count(distinct ${tables.prospect.id})::int` })
      .from(tables.enrollment)
      .innerJoin(tables.prospect, eq(tables.prospect.id, tables.enrollment.prospectId))
      .where(
        and(
          eq(tables.enrollment.sequenceId, sequence.id),
          eq(tables.enrollment.organizationId, organizationId),
          inArray(tables.prospect.emailGateway, segGateways),
        ),
      );

    const impact = await computeRoutingImpact(organizationId);
    const segProspectCount = segEnrolled[0]?.count ?? 0;

    return {
      segProspectCount,
      safeMailboxCount: impact.safeMailboxCount,
      showBanner: segProspectCount > 0 && impact.safeMailboxCount === 0,
    } satisfies SequenceDeliverabilityRisk;
  });

export type EnrollmentSegWarning = {
  segCount: number;
  safeMailboxCount: number;
  unsafeMailboxProviders: string[];
  showWarning: boolean;
};

export const getEnrollmentSegWarning = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z.object({ prospectIds: z.array(z.string().uuid()).min(1) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const organizationId = context.orgContext.organizationId;
    const segGateways = [...SEG_GATEWAYS];

    const segProspects = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tables.prospect)
      .where(
        and(
          eq(tables.prospect.organizationId, organizationId),
          inArray(tables.prospect.id, data.prospectIds),
          inArray(tables.prospect.emailGateway, segGateways),
        ),
      );

    const segCount = segProspects[0]?.count ?? 0;
    const impact = await computeRoutingImpact(organizationId);

    const unsafeMailboxes = await db.query.mailbox.findMany({
      where: and(
        eq(tables.mailbox.organizationId, organizationId),
        eq(tables.mailbox.status, "active"),
      ),
      columns: { provider: true, enterpriseSafe: true, enterpriseSafeAutoDowngraded: true },
    });

    const unsafeMailboxProviders = [
      ...new Set(
        unsafeMailboxes
          .filter((mb) => !mb.enterpriseSafe || mb.enterpriseSafeAutoDowngraded)
          .map((mb) => mb.provider),
      ),
    ];

    return {
      segCount,
      safeMailboxCount: impact.safeMailboxCount,
      unsafeMailboxProviders,
      showWarning: segCount > 0 && impact.safeMailboxCount === 0,
    } satisfies EnrollmentSegWarning;
  });

export type { DeliverabilityPolicy, RoutingPolicy };
