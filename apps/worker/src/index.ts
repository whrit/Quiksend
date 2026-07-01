import { env, logger } from "@relay/config";
import { client, db } from "@relay/db";
import { sql } from "drizzle-orm";

/**
 * Phase 0 worker entrypoint. Right now it just validates the environment, confirms
 * database connectivity, and idles. The scheduler tick + step executor + pollers
 * (Phases 6–7) hang off this process.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down");
  await client.end();
  process.exit(0);
}

async function main(): Promise<void> {
  logger.info({ env: env.NODE_ENV }, "Relay worker starting");

  await db.execute(sql`select 1`);
  logger.info("Database connection OK");

  logger.info("Worker ready (no jobs wired yet — scheduler lands in Phase 6)");

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  logger.error({ err }, "Worker failed to start");
  process.exit(1);
});
