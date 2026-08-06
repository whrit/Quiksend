import { defineConfig } from "vitest/config";
import { loadDotenv } from "./scripts/load-dotenv.ts";
import { resolveTestDatabaseUrl } from "./scripts/test-database-url.ts";

/**
 * Vitest at the workspace root doesn't inherit the per-package
 * `dotenv -e ../../.env` wrapper that `db:migrate`, `web:dev`, etc. use.
 * Every test module imports `@quiksend/config`, which fail-fasts if
 * `DATABASE_URL` is missing — so we eagerly load the root `.env` before
 * vitest forks any workers.
 *
 * CI provides `DATABASE_URL`/`NODE_ENV`/`LOG_LEVEL` via workflow-level `env:`;
 * `loadDotenv()` skips keys already set, so those win.
 */
loadDotenv();

/**
 * Redirect the whole suite onto a dedicated test database BEFORE any worker
 * forks or any module imports `@quiksend/config` (which snapshots
 * `DATABASE_URL` at import time).
 *
 * Without this, tests inherit the dev `DATABASE_URL` and
 * `truncateAppTables()` wipes whatever you have open in the running app.
 * `packages/db/src/testing.ts` independently refuses to truncate a database
 * whose name lacks the `_test` suffix, so this is belt AND braces.
 */
const testDatabaseUrl = resolveTestDatabaseUrl();
process.env.DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  test: {
    include: [
      "packages/**/*.{test,spec}.ts",
      "apps/**/*.{test,spec}.ts",
      "scripts/**/*.{test,spec}.ts",
    ],
    environment: "node",
    globals: false,
    // Explicit as well as inherited: workers must never see the dev URL.
    env: { DATABASE_URL: testDatabaseUrl },
    // Serialize DB-touching tests. Tenancy + CRM upsert tests share a Postgres
    // and race in parallel forks (last-write-wins on truncate).
    fileParallelism: false,
    // Wave 9 backlog: suite wall-clock ~56s — consider `pool: 'forks'` or a
    // dedicated CI job for worker integration tests to parallelize import cost.
  },
});
