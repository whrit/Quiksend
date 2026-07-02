import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tenancy CI guard — the invariant "no app-scoped table is queried without an
 * `organizationId` filter" enforced at test time so a missing filter fails CI
 * rather than leaking rows in production.
 *
 * Runs BEFORE any app-scoped tables exist, so the guard is a no-op at
 * foundations time; it activates automatically as Phase 2+ adds tables to
 * `APP_SCOPED_TABLES`. Adding a table to that list without an accompanying
 * scoped query is the same as saying "trust me" — do not.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const APP_SCOPED_TABLES: readonly string[] = [
  // Phase 2:
  "company",
  "prospect",
  "list",
  "importBatch",
  // Phase 3:
  "crmConnection",
  "syncState",
  // Phase 4:
  "mailbox",
  "message",
  // Phase 5:
  "sequence",
  "sequenceStep",
  "enrollment",
];

const SCAN_ROOTS = ["apps/web/src", "apps/worker/src", "packages"];
const IGNORED_DIRS = new Set([
  "node_modules",
  ".output",
  ".turbo",
  "dist",
  "build",
  "drizzle",
  ".tanstack",
  "routeTree.gen.ts",
]);

const IGNORED_FILES = new Set([
  // Tests exercise queries deliberately without scope.
  "tenancy-guard.test.ts",
  // Better Auth's generated schema is owned by the auth-generate loop.
  "auth.ts",
]);

function walk(root: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (IGNORED_DIRS.has(name)) continue;
    if (IGNORED_FILES.has(name)) continue;
    const path = join(root, name);
    const s = statSync(path);
    if (s.isDirectory()) walk(path, out);
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("tenancy guard", () => {
  it("finds no query against an app-scoped table without an organizationId filter", () => {
    // Guard is dormant while APP_SCOPED_TABLES is empty (the loop below scans
    // zero tables and `violations` stays empty). Phase 2+ activates it by
    // adding tables. Written this way instead of the earlier conditional-return
    // form to satisfy vitest's no-conditional-expect rule.
    const violations: string[] = [];
    for (const dir of SCAN_ROOTS) {
      const files = walk(join(REPO_ROOT, dir));
      for (const file of files) {
        const src = readFileSync(file, "utf8");
        for (const table of APP_SCOPED_TABLES) {
          const usesTable = new RegExp(`\\btables\\.${table}\\b`).test(src);
          if (!usesTable) continue;
          const hasScope = /organizationId/i.test(src);
          if (!hasScope) violations.push(`${file}: references ${table} without organizationId`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
