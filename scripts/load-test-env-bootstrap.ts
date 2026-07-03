/**
 * Runs before @quiksend/config is first imported by load-test-engine.ts.
 * Must stay free of workspace package imports.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const raw = readFileSync(join(repoRoot, ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {
  // .env optional — defaults below apply for fresh worktrees.
}

process.env.UNSUBSCRIBE_TOKEN_SECRET ??= "dev-unsubscribe-token-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.MAILBOX_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");
process.env.SYSTEM_SEED_ENCRYPTION_KEY ??= Buffer.alloc(32, 4).toString("base64");
process.env.SMTP_HOST ??= "localhost";
process.env.SMTP_PORT ??= "1025";
process.env.QUIKSEND_ENGINE_FAKE_MAIL ??= "1";

export const LOAD_TEST_ENV_BOOTSTRAPPED = true;
