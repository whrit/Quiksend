import { env } from "@quiksend/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.ts";

/**
 * Long-lived application client, shared by apps/web and apps/worker.
 *
 * When using a transaction-mode pooler (PgBouncer, Neon pooled endpoint), set
 * `DATABASE_POOLER_MODE=transaction` so prepared statements are disabled — they
 * break across pooled connections. Direct/session Postgres endpoints can omit it.
 */
const usePool = env.DATABASE_POOLER_MODE === "transaction";
const client = postgres(env.DATABASE_URL, usePool ? { prepare: false } : {});

export const db = drizzle(client, { schema, casing: "snake_case" });
export { client, schema };
