/**
 * Namespaced re-export of the Drizzle table objects, kept free of any runtime
 * side effects. Importing this module NEVER pulls in the Postgres client or
 * `@quiksend/config` — safe to reach from any bundle-transformed file whose
 * server-fn handler bodies have been stripped for the client build.
 *
 * Consumers: use `import { tables } from "@quiksend/db/tables"` in server-fn
 * files. Use `import { db } from "@quiksend/db/client"` (or `@quiksend/db`)
 * for the drizzle client, which stays server-only.
 */
export * as tables from "./schema/index.ts";
