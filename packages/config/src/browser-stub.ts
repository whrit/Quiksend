/**
 * Browser-safe stub for `@quiksend/config`. Selected by `package.json` `exports`
 * `browser` condition so Vite serves this instead of the real module when
 * building for the client bundle.
 *
 * The real `env.ts` reads `process.env` at import time and refuses to boot
 * without required vars; the real `logger.ts` initializes pino which pulls
 * `node:*` modules. Neither belongs in a client bundle. This stub keeps
 * incidental imports (via leaky server-fn extraction) from crashing the page.
 *
 * `env` reads return safe defaults for the two fields `logger.ts` needs at
 * init; every other read throws. `logger` is a no-op pino-compatible surface.
 *
 * Server code always resolves to `./index.ts` via the `default` condition.
 */
import type { Env } from "./env.schema.ts";
import type { Logger } from "./logger.ts";

const safeDefaults: Record<string, unknown> = {
  LOG_LEVEL: "info",
  NODE_ENV: "production",
};

export const env: Env = new Proxy({} as Env, {
  get(_target, prop) {
    if (typeof prop === "string" && prop in safeDefaults) return safeDefaults[prop];
    throw new Error(
      `@quiksend/config: attempted to read \`env.${String(prop)}\` in a browser bundle. ` +
        "This module is server-only; a client entry reached it via a leaky server-fn import edge.",
    );
  },
});

interface NoopLogger {
  fatal: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  trace: (...args: unknown[]) => void;
  child: () => NoopLogger;
}

const noopLogger: NoopLogger = {
  fatal: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  child: () => noopLogger,
};

export const logger: Logger = noopLogger as unknown as Logger;

export type { Env, Logger };
