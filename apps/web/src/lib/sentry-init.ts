import { env, logger } from "@quiksend/config";
import * as Sentry from "@sentry/react";
import { createIsomorphicFn } from "@tanstack/react-start";

/**
 * Sentry init for the web app. Server-side captures the errors that were
 * silently swallowed before: server-fn 500s, API route throws, SSR loader
 * failures. Client-side is intentionally a no-op here — `@quiksend/config`
 * is a server-only module (it reads `process.env`) and the schema does not
 * expose a `VITE_SENTRY_DSN` we could safely read in the browser bundle.
 *
 * The `createIsomorphicFn().server(...)` wrapper is a compile-time split
 * inserted by TanStack Start's Vite plugin: on the client bundle the whole
 * body — and thus the `@quiksend/config` import — is dead-code eliminated,
 * so this module is safe to import from `__root.tsx` which runs on both
 * sides.
 */
let initialized = false;

export const initSentry = createIsomorphicFn().server(() => {
  if (initialized) return;
  initialized = true;
  if (!env.SENTRY_DSN) {
    logger.debug({ service: "web" }, "SENTRY_DSN not set; Sentry disabled on web");
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  });
  logger.info({ service: "web" }, "Sentry initialized on web");
});

/**
 * Handle for callers that want to capture manually (e.g. wrapping a boundary).
 * Returns the raw Sentry namespace regardless of init state — `captureException`
 * is a safe no-op before `Sentry.init` has been called.
 */
export function getSentry(): typeof Sentry {
  return Sentry;
}
