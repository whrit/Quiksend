/**
 * Create the test database if absent, then migrate it to head.
 *
 * Runs automatically before `pnpm test` (npm `pretest` hook), so the suite is
 * never the thing that discovers the database is missing or a migration behind.
 * Idempotent and fast — once created and current, this is two round-trips.
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { databaseNameOf, redact, resolveTestDatabaseUrl } from "./test-database-url.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const testUrl = resolveTestDatabaseUrl();
const testDbName = databaseNameOf(testUrl);

// Connect to the maintenance database — you cannot CREATE DATABASE from inside
// the database you are creating.
const adminUrl = new URL(testUrl);
adminUrl.pathname = "/postgres";

const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
try {
  const existing = await admin`select 1 from pg_database where datname = ${testDbName}`;
  if (existing.length === 0) {
    // Identifier cannot be parameterised; the name is derived from our own
    // config, not user input, and is quoted defensively.
    await admin.unsafe(`create database "${testDbName.replace(/"/g, '""')}"`);
    console.log(`[test-db] created ${testDbName}`);
  }
} finally {
  await admin.end();
}

execFileSync("pnpm", ["--filter", "@quiksend/db", "migrate"], {
  cwd: repoRoot,
  stdio: ["ignore", "pipe", "inherit"],
  env: { ...process.env, DATABASE_URL: testUrl },
});

console.log(`[test-db] ready — ${redact(testUrl)}`);
