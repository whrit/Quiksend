/**
 * Database migration runner: minimal, security-focused, no app config import.
 * Reads only DATABASE_URL and MIGRATIONS_FOLDER from environment.
 * Exits with clear error if DATABASE_URL is missing or malformed.
 */

import { execSync } from "child_process";
import { resolve } from "path";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS_FOLDER = process.env.MIGRATIONS_FOLDER || "packages/db/drizzle";

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required");
  process.exit(1);
}

// Validate URL format: postgres://user:pass@host:port/db
if (!/^postgres(ql)?:\/\/.+@.+:\d+\/.+$/.test(DATABASE_URL)) {
  console.error(
    "ERROR: DATABASE_URL must be a valid PostgreSQL URL (postgres://user:pass@host:port/db)"
  );
  process.exit(1);
}

try {
  console.log("Running migrations from", MIGRATIONS_FOLDER);
  execSync(`pnpm exec drizzle-kit migrate --config packages/db/drizzle.config.ts`, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL },
  });
  console.log("Migrations completed successfully");
} catch (err) {
  console.error("Migration failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
