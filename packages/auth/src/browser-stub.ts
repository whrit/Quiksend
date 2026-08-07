/**
 * Browser-safe stub for `@quiksend/auth`. Selected by `package.json` `exports`
 * `browser` condition so Vite serves this instead of the real module when
 * building for the client bundle.
 *
 * The real `auth.ts` initializes the Better Auth server instance with a
 * Drizzle adapter and Postgres — none of which belongs in the browser. Any
 * client code that needs Better Auth uses `@quiksend/auth/client`; the barrel
 * export shipping the server `auth` handle only ever reaches the client via
 * a leaky server-fn extraction, and this stub keeps that harmless.
 *
 * Server code always resolves to `./index.ts` via the `default` condition.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth's `Auth` type is complex; the stub matches by construction.
type AuthShape = any;

export const auth: AuthShape = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(
        `@quiksend/auth: attempted to use \`auth.${String(prop)}\` in a browser bundle. ` +
          "This is the server-only Better Auth instance; use `@quiksend/auth/client` for client-side auth.",
      );
    },
  },
) as AuthShape;

export type Auth = AuthShape;

export async function resolveDefaultActiveOrganizationId(): Promise<string | null> {
  throw new Error("@quiksend/auth: resolveDefaultActiveOrganizationId called in a browser bundle");
}
