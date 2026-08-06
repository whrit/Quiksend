import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { db } from "./client.ts";
import type * as schema from "./schema/index.ts";

/** Drizzle transaction handle — use inside withTenantTransaction callbacks. */
export type DbTx = PostgresJsDatabase<typeof schema>;

/**
 * Execute `fn` inside a Postgres transaction scoped to a single tenant.
 *
 * Sets `LOCAL ROLE quiksend_app` (subject to RLS) and
 * `set_config('app.organization_id', organizationId, true)` (transaction-local).
 * Both reset automatically on COMMIT/ROLLBACK — tenant state cannot leak.
 */
export async function withTenantTransaction<T>(
  organizationId: string,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE quiksend_app`);
    await tx.execute(sql`SELECT set_config('app.organization_id', ${organizationId}, true)`);
    return fn(tx);
  });
}
