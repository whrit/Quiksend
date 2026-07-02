import { logger } from "@quiksend/config";

const SLOW_QUERY_MS = 2000;

export async function withAnalyticsTiming<T>(
  fnName: string,
  organizationId: string,
  work: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } finally {
    const durationMs = performance.now() - start;
    logger.info({ fn: fnName, organizationId, durationMs }, "analytics timing");
    if (durationMs > SLOW_QUERY_MS) {
      logger.warn({ fn: fnName, organizationId, durationMs }, "analytics slow query");
    }
  }
}
