import { env, logger } from "@quiksend/config";
import * as Sentry from "@sentry/node";

/**
 * Sentry init. No-op when `SENTRY_DSN` is unset — the SDK's own guards do this
 * too, but wrapping it here keeps intent explicit and skips the traces overhead
 * during local dev.
 */
let initialized = false;

export function initSentry(serviceName: string): void {
  if (initialized) return;
  if (!env.SENTRY_DSN) {
    logger.debug({ serviceName }, "SENTRY_DSN not set; Sentry disabled");
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    serverName: serviceName,
  });
  initialized = true;
  logger.info({ serviceName }, "Sentry initialized");
}

export { Sentry };
