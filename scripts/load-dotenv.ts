/**
 * Loads the repo-root `.env` into `process.env`, without overriding anything
 * already set (CI's workflow-level `env:` and any explicit shell exports win).
 *
 * The per-package scripts get their env from `dotenv -e ../../.env -- <cmd>`,
 * but scripts driven from the repo root (`scripts/ensure-test-db.ts`,
 * `vitest.config.ts`) don't go through that wrapper — they need to prime
 * `process.env` themselves before any module reads it. Duplicated inline in
 * two places was one place too many; this is the one implementation.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function loadDotenv(): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(repoRoot, ".env"), "utf8");
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
