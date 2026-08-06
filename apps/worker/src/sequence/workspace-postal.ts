import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { resolvePostalAddress } from "@quiksend/mail";
import { eq } from "drizzle-orm";

/**
 * CAN-SPAM postal address for a workspace, read from
 * `organization.metadata.postal_address`.
 *
 * Delegates to the fail-closed resolver in `@quiksend/mail` which throws
 * `ComplianceConfigurationError` when the address is missing or blank.
 */
export async function getWorkspacePostalAddress(organizationId: string): Promise<string> {
  const org = await db.query.organization.findFirst({
    where: eq(tables.organization.id, organizationId),
    columns: { metadata: true },
  });

  return resolvePostalAddress({ organizationId, metadata: org?.metadata ?? null });
}
