/**
 * Browser-safe stub for `@quiksend/db`. Selected by `package.json` `exports`
 * `browser` condition so Vite serves this instead of the real module when
 * building for the client bundle.
 *
 * TanStack Start's server-fn extraction sometimes leaves stale
 * `import { db, tables } from "@quiksend/db"` in the client bundle even after
 * moving the handler bodies server-side. This stub keeps those imports harmless
 * at load time. Any code that ACTUALLY reads `db.query.X` or `tables.foo`
 * throws with a clear message so real bugs (server-only code path running
 * client-side) still surface immediately.
 *
 * Server code always resolves to `./index.ts` via the `default` condition.
 */
function stub<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      throw new Error(
        `@quiksend/db: attempted to use \`${name}.${String(prop)}\` in a browser bundle. ` +
          "This module is server-only; a client entry reached it via a leaky server-fn import edge.",
      );
    },
  });
}

export const db = stub<Record<string, unknown>>("db");
export const client = stub<Record<string, unknown>>("client");
export const tables = stub<Record<string, unknown>>("tables");
export const schema = stub<Record<string, unknown>>("schema");
export const isSendSuppressed = (): never => {
  throw new Error("@quiksend/db: isSendSuppressed called in a browser bundle");
};
export const insertOutbox = (): never => {
  throw new Error("@quiksend/db: insertOutbox called in a browser bundle");
};
export const withTenantTransaction = (): never => {
  throw new Error("@quiksend/db: withTenantTransaction called in a browser bundle");
};
export const recordAudit = (): never => {
  throw new Error("@quiksend/db: recordAudit called in a browser bundle");
};
export const redactAuditMetadata = (): never => {
  throw new Error("@quiksend/db: redactAuditMetadata called in a browser bundle");
};
export const listAuditLog = (): never => {
  throw new Error("@quiksend/db: listAuditLog called in a browser bundle");
};

// Types are erased at build time; safe to re-export from the real module.
export type { OutboxIntent } from "./outbox.ts";
export type { DbTx } from "./tenant-context.ts";
export type { AuditActorType, RecordAuditInput, AuditLogRow } from "./audit.ts";
