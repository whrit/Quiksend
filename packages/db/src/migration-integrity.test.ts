import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards the drizzle migration chain against silent corruption.
 *
 * Two real incidents motivated this:
 *   1. `drizzle-kit generate` reused an existing NNNN_ filename, producing two
 *      migrations with the same numeric prefix and OVERWRITING the earlier
 *      snapshot.
 *   2. A `--custom` (data-only) generate rewrote the latest snapshot minus the
 *      `views` section. Left in place, the next generate would have re-emitted
 *      `CREATE VIEW` for an already-applied view.
 *
 * Both were invisible until something downstream broke. These assertions make
 * either one fail CI immediately.
 */

const drizzleDir = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
const metaDir = join(drizzleDir, "meta");

interface Journal {
  entries: { idx: number; tag: string }[];
}

const journal = JSON.parse(readFileSync(join(metaDir, "_journal.json"), "utf8")) as Journal;

/**
 * Migrations applied before snapshot hygiene was enforced. They are inert —
 * drizzle only diffs against the LATEST snapshot — but they must never grow.
 */
const KNOWN_MISSING_SNAPSHOTS = new Set([
  "0018_phase11c_canary",
  "0020_wave8_rho_perf_indexes",
  "0021_wave8_omicron_canary_step_index",
  // Data-only migration: no schema change, so no snapshot of its own.
  "0024_backfill_message_step_index",
]);

const numericPrefix = (tag: string): string => tag.split("_")[0] ?? "";

describe("drizzle migration chain", () => {
  it("gives every migration a unique numeric prefix", () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const { tag } of journal.entries) {
      const prefix = numericPrefix(tag);
      const previous = seen.get(prefix);
      if (previous) collisions.push(`${prefix}: ${previous} vs ${tag}`);
      else seen.set(prefix, tag);
    }
    // A duplicate prefix makes drizzle clobber the earlier snapshot.
    expect(collisions).toEqual([]);
  });

  it("has a .sql file backing every journal entry", () => {
    const files = new Set(readdirSync(drizzleDir).filter((f) => f.endsWith(".sql")));
    const missing = journal.entries.map((e) => `${e.tag}.sql`).filter((f) => !files.has(f));
    expect(missing).toEqual([]);
  });

  it("does not accumulate new snapshot gaps", () => {
    const files = new Set(readdirSync(metaDir));
    const missing = journal.entries
      .map((e) => e.tag)
      .filter(
        (tag) =>
          !KNOWN_MISSING_SNAPSHOTS.has(tag) && !files.has(`${numericPrefix(tag)}_snapshot.json`),
      );
    expect(missing).toEqual([]);
  });

  it("keeps the newest snapshot complete", () => {
    const snapshots = readdirSync(metaDir)
      .filter((f) => f.endsWith("_snapshot.json"))
      .toSorted();
    const newest = snapshots.at(-1);
    expect(newest).toBeDefined();

    const snapshot = JSON.parse(readFileSync(join(metaDir, newest!), "utf8")) as {
      tables?: Record<string, unknown>;
      views?: Record<string, unknown>;
    };

    // A truncated regeneration silently drops whole sections; the next generate
    // then re-emits DDL that is already applied.
    expect(Object.keys(snapshot.tables ?? {}).length).toBeGreaterThan(30);
    expect(Object.keys(snapshot.views ?? {})).toContain("public.sequence_stats");
  });
});
