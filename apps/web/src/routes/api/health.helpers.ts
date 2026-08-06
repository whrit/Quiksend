import { getBoss } from "@quiksend/queue";

/**
 * Database client with execute method (postgres-js).
 */
export type DatabaseClient = {
  execute(sql: string): Promise<unknown>;
};

/**
 * Race a promise against a bounded timeout.
 * Properly clears the timeout handle on success to prevent timer leaks.
 */
export async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

/**
 * Probe database connectivity with bounded timeout.
 * @param client - Drizzle DB client
 * @param timeoutMs - Timeout in milliseconds (default 3000)
 * @returns Probe time in milliseconds
 */
export async function probeDatabase(
  client: DatabaseClient,
  timeoutMs: number = 3000,
): Promise<number> {
  const start = Date.now();
  await raceWithTimeout(
    client.execute("SELECT NOW()"),
    timeoutMs,
    `DB probe timeout after ${timeoutMs}ms`,
  );
  return Date.now() - start;
}

/**
 * Probe queue connectivity by actually querying queue state.
 * Tests both pg-boss initialization and Postgres connectivity.
 * @param timeoutMs - Timeout in milliseconds (default 2000)
 * @returns Probe time in milliseconds
 */
export async function probeQueue(timeoutMs: number = 2000): Promise<number> {
  const start = Date.now();
  const boss = await getBoss();
  // getQueue queries the queue metadata table — tests real DB connectivity
  // not just pg-boss instance cache
  await raceWithTimeout(
    boss.getQueue("health.reconcile"),
    timeoutMs,
    `Queue probe timeout after ${timeoutMs}ms`,
  );
  return Date.now() - start;
}
