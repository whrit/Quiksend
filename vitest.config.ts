import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Vitest at the workspace root does not inherit the per-package `dotenv -e ../../.env`
 * wrapper that `db:migrate`, `web:dev`, etc. use. Every test module imports
 * `@quiksend/config`, which fail-fasts if `DATABASE_URL` is missing — so we
 * eagerly load the root `.env` here and merge it into `process.env` before
 * vitest forks any workers.
 *
 * CI provides `DATABASE_URL`/`NODE_ENV`/`LOG_LEVEL` via workflow-level `env:`
 * so those already-set values win over anything in a checked-in `.env.example`
 * or a stray local `.env` on a CI runner.
 */
function loadDotenv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  let raw: string;
  try {
    raw = readFileSync(resolve(here, ".env"), "utf8");
  } catch {
    return; // No .env (CI, prod-like shells) — process.env is already primed.
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotenv();

export default defineConfig({
  test: {
    include: ["packages/**/*.{test,spec}.ts", "apps/**/*.{test,spec}.ts"],
    environment: "node",
    globals: false,
    // Serialize DB-touching tests. Tenancy + CRM upsert tests share a Postgres
    // and race in parallel forks (last-write-wins on truncate).
    fileParallelism: false,
    // Wave 9 backlog: suite wall-clock ~56s — consider `pool: 'forks'` or a
    // dedicated CI job for worker integration tests to parallelize import cost.
  },
});
