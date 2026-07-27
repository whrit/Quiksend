import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { resolvePostalAddress } from "@quiksend/mail";
import { eq } from "drizzle-orm";

/**
 * CAN-SPAM postal address for a workspace, read from
 * `organization.metadata.postal_address`.
 *
 * Falls back to the documented placeholder and warns — the shared resolver in
 * `@quiksend/mail` owns both behaviours so the worker and the web manual send
 * paths cannot drift apart on a compliance field.
 */
export async function getWorkspacePostalAddress(organizationId: string): Promise<string> {
  const org = await db.query.organization.findFirst({
    where: eq(tables.organization.id, organizationId),
    columns: { metadata: true },
  });

  return resolvePostalAddress({ organizationId, metadata: org?.metadata ?? null });
}
