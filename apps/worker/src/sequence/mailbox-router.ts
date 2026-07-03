import {
  isMailboxSafeForGateway,
  isSegGateway,
  type DeliverabilityPolicy,
} from "@quiksend/core/deliverability";
import { tables } from "@quiksend/db/tables";
import type { EmailGateway } from "@quiksend/mail/gateway-detect";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@quiksend/db/schema";
import { countReservationsInWindow } from "./reserve-slot.ts";

type DbTx = PostgresJsDatabase<typeof schema>;

type MailboxRow = typeof tables.mailbox.$inferSelect;
type EnrollmentRow = typeof tables.enrollment.$inferSelect;

export type RoutingDecision =
  | {
      kind: "route";
      mailboxId: string;
      autoSwapped: boolean;
      emitEvents: readonly string[];
    }
  | {
      kind: "skip";
      reason: "no_safe_mailbox_for_gateway";
      emitEvent: true;
    };

function toSafetySnapshot(mailbox: MailboxRow) {
  return {
    enterpriseSafe: mailbox.enterpriseSafe,
    enterpriseSafeAutoDowngraded: mailbox.enterpriseSafeAutoDowngraded,
    provider: mailbox.provider,
  };
}

async function loadSafeMailboxes(tx: DbTx, orgId: string): Promise<MailboxRow[]> {
  // CR-35 (PERF-014): no partial index on enterprise_safe filter yet — acceptable at <20
  // mailboxes/workspace; add (organization_id) WHERE status='active' AND enterprise_safe=true
  // AND enterprise_safe_auto_downgraded=false if mailbox counts grow.
  const rows = await tx.query.mailbox.findMany({
    where: and(
      eq(tables.mailbox.organizationId, orgId),
      eq(tables.mailbox.status, "active"),
      eq(tables.mailbox.enterpriseSafe, true),
      eq(tables.mailbox.enterpriseSafeAutoDowngraded, false),
    ),
  });
  return rows;
}

async function pickLeastLoadedSafeMailbox(
  tx: DbTx,
  safeMailboxes: readonly MailboxRow[],
  currentMailbox: MailboxRow,
  at: Date,
): Promise<string> {
  // CR-34 (PERF-011): N reservation COUNTs inside advisory lock — fine at <5 safe mailboxes.
  let bestId = safeMailboxes[0]!.id;
  let bestCount = Number.POSITIVE_INFINITY;
  let bestSameProvider = false;

  for (const mb of safeMailboxes) {
    const count = await countReservationsInWindow(tx, mb.id, at);
    const sameProvider = mb.provider === currentMailbox.provider;
    const better = count < bestCount || (count === bestCount && sameProvider && !bestSameProvider);
    if (better) {
      bestId = mb.id;
      bestCount = count;
      bestSameProvider = sameProvider;
    }
  }

  return bestId;
}

export async function selectMailboxForSend(
  tx: DbTx,
  orgId: string,
  enrollment: EnrollmentRow,
  currentMailbox: MailboxRow,
  recipientGateway: EmailGateway | null,
  policy: DeliverabilityPolicy,
  at: Date = new Date(),
): Promise<RoutingDecision> {
  const currentId = currentMailbox.id;
  const emitEvents: string[] = [];

  if (policy.routingPolicy === "off" || !isSegGateway(recipientGateway)) {
    return { kind: "route", mailboxId: currentId, autoSwapped: false, emitEvents };
  }

  const safeMailboxes = await loadSafeMailboxes(tx, orgId);
  const currentSafe = isMailboxSafeForGateway(toSafetySnapshot(currentMailbox), recipientGateway);
  const hasAnchor = enrollment.anchorMessageId != null;

  if (safeMailboxes.length === 0) {
    if (policy.routingPolicy === "enforce") {
      return { kind: "skip", reason: "no_safe_mailbox_for_gateway", emitEvent: true };
    }
    emitEvents.push("deliverability.delivered_at_risk");
    return { kind: "route", mailboxId: currentId, autoSwapped: false, emitEvents };
  }

  if (currentSafe) {
    return { kind: "route", mailboxId: currentId, autoSwapped: false, emitEvents };
  }

  if (hasAnchor) {
    emitEvents.push("deliverability.anchor_threading_preserved");
    if (policy.routingPolicy === "warn") {
      emitEvents.push("deliverability.delivered_at_risk");
    }
    return { kind: "route", mailboxId: currentId, autoSwapped: false, emitEvents };
  }

  const targetId = await pickLeastLoadedSafeMailbox(tx, safeMailboxes, currentMailbox, at);
  emitEvents.push("deliverability.mailbox_auto_swapped");
  return {
    kind: "route",
    mailboxId: targetId,
    autoSwapped: targetId !== currentId,
    emitEvents,
  };
}
