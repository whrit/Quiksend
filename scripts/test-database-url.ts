/**
 * Single source of truth for where tests are allowed to write.
 *
 * The suite truncates app-scoped tables between cases. Pointed at the dev
 * database — which is what happens when tests just inherit `DATABASE_URL` from
 * the root `.env` — `pnpm test` silently destroys whatever you were looking at
 * in the running app. So tests get their own database, always.
 *
 * Both `vitest.config.ts` and `scripts/ensure-test-db.ts` derive the URL here
 * so they can never disagree about which database that is.
 */

/** Every test database name ends with this. `truncateAppTables` enforces it. */
export const TEST_DB_SUFFIX = "_test";

/**
 * Derive the test database URL from the development one by suffixing the
 * database name: `…/quiksend` → `…/quiksend_test`. An explicit
 * `TEST_DATABASE_URL` always wins.
 */
export function resolveTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.TEST_DATABASE_URL?.trim();
  if (explicit) return explicit;

  const base = env.DATABASE_URL?.trim();
  if (!base) {
    throw new Error(
      "Cannot derive a test database: neither TEST_DATABASE_URL nor DATABASE_URL is set.",
    );
  }

  const url = new URL(base);
  const name = url.pathname.replace(/^\//, "");
  if (!name) throw new Error(`DATABASE_URL has no database name: ${redact(base)}`);
  if (name.endsWith(TEST_DB_SUFFIX)) return base;

  url.pathname = `/${name}${TEST_DB_SUFFIX}`;
  return url.toString();
}

/** Database name from a connection URL, for guards and log lines. */
export function databaseNameOf(connectionUrl: string): string {
  return new URL(connectionUrl).pathname.replace(/^\//, "");
}

/** Connection URL with the password removed, safe to print. */
export function redact(connectionUrl: string): string {
  try {
    const url = new URL(connectionUrl);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "<unparseable connection url>";
  }
}
