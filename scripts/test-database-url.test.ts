import { describe, expect, it } from "vitest";
import { databaseNameOf, redact, resolveTestDatabaseUrl } from "./test-database-url.ts";

/**
 * Guards the rule that keeps `pnpm test` from destroying the dev database.
 *
 * The suite truncates app-scoped tables between cases. When it shared
 * `DATABASE_URL` with the running dev app, every `pnpm check` silently wiped
 * whatever you had open. Two things prevent that now: this derivation, and the
 * `_test` suffix assertion inside `truncateAppTables()`.
 */
describe("resolveTestDatabaseUrl", () => {
  it("suffixes the database name so tests never share the dev database", () => {
    const url = resolveTestDatabaseUrl({
      DATABASE_URL: "postgres://quiksend:pw@localhost:5432/quiksend",
    });
    expect(databaseNameOf(url)).toBe("quiksend_test");
  });

  it("preserves credentials, host, port and query params", () => {
    const url = new URL(
      resolveTestDatabaseUrl({
        DATABASE_URL: "postgres://user:pw@db.internal:6543/app?sslmode=require",
      }),
    );
    expect(url.username).toBe("user");
    expect(url.password).toBe("pw");
    expect(url.host).toBe("db.internal:6543");
    expect(url.pathname).toBe("/app_test");
    expect(url.searchParams.get("sslmode")).toBe("require");
  });

  it("is idempotent — an already-test URL is returned unchanged", () => {
    const already = "postgres://quiksend:pw@localhost:5432/quiksend_test";
    expect(resolveTestDatabaseUrl({ DATABASE_URL: already })).toBe(already);
  });

  it("lets TEST_DATABASE_URL win outright", () => {
    const url = resolveTestDatabaseUrl({
      DATABASE_URL: "postgres://quiksend:pw@localhost:5432/quiksend",
      TEST_DATABASE_URL: "postgres://other:pw@elsewhere:5432/custom_test",
    });
    expect(databaseNameOf(url)).toBe("custom_test");
  });

  it("always yields a name ending in _test, which is what the truncate guard checks", () => {
    for (const base of [
      "postgres://u:p@h:5432/quiksend",
      "postgres://u:p@h:5432/prod_like_name",
      "postgres://u:p@h:5432/a",
    ]) {
      expect(databaseNameOf(resolveTestDatabaseUrl({ DATABASE_URL: base }))).toMatch(/_test$/);
    }
  });

  it("refuses to guess when there is no database to derive from", () => {
    expect(() => resolveTestDatabaseUrl({})).toThrow(/neither TEST_DATABASE_URL nor DATABASE_URL/);
    expect(() => resolveTestDatabaseUrl({ DATABASE_URL: "postgres://u:p@h:5432/" })).toThrow(
      /no database name/,
    );
  });

  it("redacts the password so connection strings are safe to log", () => {
    expect(redact("postgres://user:hunter2@host:5432/db")).not.toContain("hunter2");
  });
});
