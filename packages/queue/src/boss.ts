import { env, logger } from "@quiksend/config";
import { PgBoss } from "pg-boss";
import type { SendOptions, UpdateQueueOptions, WorkOptions } from "pg-boss";
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

const QUEUE_DEFAULTS: Partial<Record<JobName, UpdateQueueOptions>> = {
  "crm.writeback": {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 3600,
  },
  "gateway.detect_single": {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 3600,
  },
  "gateway.detect_bulk": {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 3600,
  },
  "gateway.apply_classification": {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 3600,
  },
};

const WORK_DEFAULTS: Partial<Record<JobName, WorkOptions>> = {
  "webhook.deliver": {
    localConcurrency: env.WEBHOOK_DELIVER_CONCURRENCY,
  },
};

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

export type EnqueueOptions = SendOptions;

/**
 * Typed producer. Validates the payload against the registered schema before
 * enqueueing — a mis-typed payload fails locally, not on the consumer at 3am.
 */
export async function enqueue<N extends JobName>(
  job: N,
  payload: JobPayloadMap[N],
  options?: EnqueueOptions,
): Promise<string | null> {
  const schema = JobSchemas[job];
  const validated = schema.parse(payload);
  const boss = await getBoss();
  const id = await boss.send(job, validated as object, options);
  logger.debug({ job, id }, "job enqueued");
  return id;
}

const RETRY_ENQUEUE_DEFAULTS: EnqueueOptions = {
  retryLimit: 5,
  retryDelay: 60,
  retryBackoff: true,
  retryDelayMax: 3600,
};

/** Enqueue with standard retry policy (5 attempts, exponential backoff to 3600s). */
export async function enqueueWithRetries<N extends JobName>(
  job: N,
  payload: JobPayloadMap[N],
  options?: EnqueueOptions,
): Promise<string | null> {
  return enqueue(job, payload, { ...RETRY_ENQUEUE_DEFAULTS, ...options });
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
  workOptions?: WorkOptions,
): Promise<void> {
  const schema = JobSchemas[job];
  const boss = await getBoss();
  const queueDefaults = QUEUE_DEFAULTS[job];
  if (queueDefaults) {
    await boss.createQueue(job, queueDefaults);
  } else {
    await boss.createQueue(job);
  }
  const workDefaults = WORK_DEFAULTS[job];
  await boss.work<unknown>(job, { ...workDefaults, ...workOptions }, async (jobs) => {
    for (const item of jobs) {
      const payload = schema.parse(item.data) as JobPayloadMap[N];
      await handler(payload);
    }
  });
  logger.info({ job }, "job handler registered");
}
