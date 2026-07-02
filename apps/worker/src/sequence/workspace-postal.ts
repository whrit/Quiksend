import { logger } from "@quiksend/config";
import { db, tables } from "@quiksend/db";
import { eq } from "drizzle-orm";

const DEFAULT_POSTAL_ADDRESS = "1 Main St, City";

/**
 * Reads CAN-SPAM postal address from organization.metadata.postal_address.
 * Falls back to a documented default and logs a warning when unset.
 */
export async function getWorkspacePostalAddress(organizationId: string): Promise<string> {
  const org = await db.query.organization.findFirst({
    where: eq(tables.organization.id, organizationId),
    columns: { metadata: true },
  });

  if (!org?.metadata) {
    logger.warn(
      { organizationId },
      "workspace postal_address not configured — using default (deliverability risk)",
    );
    return DEFAULT_POSTAL_ADDRESS;
  }

  try {
    const parsed = JSON.parse(org.metadata) as { postal_address?: string };
    const address = parsed.postal_address?.trim();
    if (address) return address;
  } catch {
    // fall through to default
  }

  logger.warn(
    { organizationId },
    "workspace postal_address not configured — using default (deliverability risk)",
  );
  return DEFAULT_POSTAL_ADDRESS;
}
