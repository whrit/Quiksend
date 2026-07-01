import { join } from "node:path";
import { env } from "@quiksend/config";
import { logger } from "@quiksend/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main(): Promise<void> {
  const migrationsFolder = join(import.meta.dirname, "..", "drizzle");
  const sql = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle(sql);

  logger.info({ migrationsFolder }, "Running migrations");
  await migrate(db, { migrationsFolder });
  logger.info("Migrations complete");

  await sql.end();
}

main().catch((err: unknown) => {
  logger.error({ err }, "Migration failed");
  process.exit(1);
});
