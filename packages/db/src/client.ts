import { env } from "@quiksend/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.ts";

/**
 * Long-lived application client, shared by apps/web and apps/worker.
 *
 * NOTE: if you ever put a transaction-mode pooler (PgBouncer, Neon's pooled
 * endpoint) in front of Postgres, prepared statements break — pass `{ prepare: false }`
 * here, or point long-lived processes at a direct/session endpoint.
 */
const client = postgres(env.DATABASE_URL);

export const db = drizzle(client, { schema, casing: "snake_case" });
export { client, schema };
