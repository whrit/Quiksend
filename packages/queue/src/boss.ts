import { env, logger } from "@quiksend/config";
import { PgBoss } from "pg-boss";
import { JobSchemas, type JobName, type JobPayloadMap } from "./jobs.ts";

/**
 * Long-lived pg-boss instance shared by producers (`apps/web`) and consumers
 * (`apps/worker`). pg-boss writes to a `pgboss` schema alongside app tables in
 * the same Postgres database — no extra infra.
 *
 * Boot flow:
 *   • `getBoss()` returns a started instance (lazy). First call runs schema
 *     install; subsequent calls return the cached instance.
 *   • `registerHandler()` boots (if needed) + registers a handler.
 *   • `stopBoss()` gracefully drains on SIGTERM.
 */
let cached: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (cached) return cached;
  if (starting) return starting;
  starting = (async () => {
    const boss = new PgBoss({ connectionString: env.DATABASE_URL });
    boss.on("error", (err: Error) => logger.error({ err }, "pg-boss error"));
    await boss.start();
    cached = boss;
    starting = null;
    logger.info("pg-boss started");
    return boss;
  })();
  return starting;
}

export async function stopBoss(): Promise<void> {
  if (!cached) return;
  await cached.stop({ graceful: true });
  cached = null;
  logger.info("pg-boss stopped");
}

/**
 * Typed producer. Validates the payload against the registered schema before
 * enqueueing — a mis-typed payload fails locally, not on the consumer at 3am.
 */
export async function enqueue<N extends JobName>(
  job: N,
  payload: JobPayloadMap[N],
): Promise<string | null> {
  const schema = JobSchemas[job];
  const validated = schema.parse(payload);
  const boss = await getBoss();
  const id = await boss.send(job, validated as object);
  logger.debug({ job, id }, "job enqueued");
  return id;
}

export type JobHandler<N extends JobName> = (payload: JobPayloadMap[N]) => Promise<void>;

/**
 * Registers a handler for a job. The wrapper validates the incoming payload
 * against the schema before invoking — a bad payload dies with a clear zod
 * error instead of a mystery `undefined.foo` at line 42.
 */
export async function registerHandler<N extends JobName>(
  job: N,
  handler: JobHandler<N>,
): Promise<void> {
  const schema = JobSchemas[job];
  const boss = await getBoss();
  await boss.createQueue(job);
  await boss.work<unknown>(job, async (jobs) => {
    for (const item of jobs) {
      const payload = schema.parse(item.data) as JobPayloadMap[N];
      await handler(payload);
    }
  });
  logger.info({ job }, "job handler registered");
}
