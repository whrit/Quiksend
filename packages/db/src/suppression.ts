import { and, eq, or } from "drizzle-orm";
import { db } from "./client.ts";
import * as tables from "./schema/index.ts";

/**
 * Shared send-time suppression guard.
 *
 * Lives here rather than in either app because BOTH the worker's sequence
 * guards and the web app's manual send paths (compose, inbox reply) must apply
 * the identical rule: a prospect who unsubscribed must not receive mail through
 * *any* path — an automated step, a rep hitting send in compose, or an inbox
 * reply. Per-app copies are how those two silently drift apart.
 *
 * Not in `@quiksend/core`, which is pure; this queries the database.
 */

/** Prospect statuses that block all outbound mail, regardless of the suppression list. */
const SUPPRESSED_STATUS: Record<string, true> = {
  unsubscribed: true,
  do_not_contact: true,
  bounced: true,
};

/**
 * True when a send to `email` must be blocked, because the prospect's own
 * status forbids contact or the address (or its whole domain) is suppressed
 * for this organization.
 */
export async function isSendSuppressed(input: {
  organizationId: string;
  email: string;
  prospectStatus?: string | null;
}): Promise<boolean> {
  if (input.prospectStatus && SUPPRESSED_STATUS[input.prospectStatus]) return true;

  const normalized = input.email.toLowerCase();
  const at = normalized.lastIndexOf("@");
  const domain = at >= 0 ? normalized.slice(at + 1) : normalized;

  const [lifecycle, rows] = await Promise.all([
    db.query.organizationLifecycle.findFirst({
      where: eq(tables.organizationLifecycle.organizationId, input.organizationId),
      columns: { sendingDisabledAt: true },
    }),
    db
      .select({ id: tables.suppression.id })
      .from(tables.suppression)
      .where(
        and(
          eq(tables.suppression.organizationId, input.organizationId),
          or(
            and(eq(tables.suppression.valueType, "email"), eq(tables.suppression.value, normalized)),
            and(eq(tables.suppression.valueType, "domain"), eq(tables.suppression.value, domain)),
          ),
        ),
      )
      .limit(1),
  ]);

  // Organization deletion disables sending immediately — checked here, the
  // one chokepoint every send path (sequence engine, compose, inbox reply)
  // already shares, rather than threading a new check through each caller.
  if (lifecycle?.sendingDisabledAt) return true;

  return rows.length > 0;
}
