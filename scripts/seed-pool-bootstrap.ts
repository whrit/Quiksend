#!/usr/bin/env tsx
/**
 * Bootstrap provider-managed seed inboxes from a JSON config file.
 * OMEGA-OPS supplies the real config; this script + example config ship in-repo.
 *
 * Usage:
 *   SYSTEM_SEED_ENCRYPTION_KEY=... pnpm tsx scripts/seed-pool-bootstrap.ts internal-runbooks/seed-pool-config.example.json
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(): void {
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
    // optional
  }
}

loadEnvFile();

import { db, tables } from "../packages/db/src/index.ts";
import { encryptSeedImapConfig } from "../packages/mail/src/seed-crypto.ts";
import type { EmailGateway } from "../packages/mail/src/gateway-detect.ts";

interface SeedPoolEntry {
  email: string;
  gateway: EmailGateway;
  provider: string;
  pool_tag: "production" | "canary_only" | "warmup";
  imap: {
    host: string;
    port: number;
    username: string;
    password: string;
    secure: boolean;
  };
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error("Usage: pnpm tsx scripts/seed-pool-bootstrap.ts <config.json>");
    process.exit(1);
  }

  const entries = JSON.parse(readFileSync(configPath, "utf8")) as SeedPoolEntry[];
  let inserted = 0;

  for (const entry of entries) {
    const imapConfig = encryptSeedImapConfig(
      {
        host: entry.imap.host,
        port: entry.imap.port,
        auth: { user: entry.imap.username, pass: entry.imap.password },
        secure: entry.imap.secure,
      },
      null,
    );

    await db
      .insert(tables.seedInbox)
      .values({
        organizationId: null,
        email: entry.email.toLowerCase(),
        gateway: entry.gateway,
        provider: entry.provider,
        imapConfig,
        poolTag: entry.pool_tag,
        active: true,
      })
      .onConflictDoNothing({ target: tables.seedInbox.email });

    inserted++;
  }

  console.log(`Bootstrap complete: processed ${inserted} seed entries`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
