import { EnvSchema } from "./env.schema.ts";
import type { Env } from "./env.schema.ts";

/**
 * Eager, fail-fast environment loader. If required vars are missing or malformed the
 * process exits at startup rather than blowing up somewhere deep in a request.
 *
 * The schema itself lives in `env.schema.ts` (no side effects) so it can be imported
 * and unit-tested without triggering this load.
 *
 * Guardrail: this module is server-only. If it is ever pulled into a browser bundle
 * (usually because a route file imported a `.functions.ts` and the TanStack server-fn
 * boundary wasn't detected — see `apps/web/src/lib/org-fn.ts`), throw loud instead of
 * silently crashing on `process.stderr.write` when `process` is undefined. Never leak
 * env values or exit the tab; just refuse to initialise and surface the misconfig.
 */
function loadEnv(): Env {
  if (typeof process === "undefined" || typeof process.env === "undefined") {
    throw new Error(
      "@quiksend/config: env cannot be read in a browser context. This module is " +
        "server-only; a client bundle imported it, most likely because a route file " +
        "pulled in a `.functions.ts` and the TanStack Start server-fn boundary wasn't " +
        "detected. Fix the import graph, don't polyfill.",
    );
  }
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    // Use process.stderr when available, fall back to console.error otherwise —
    // some server runtimes (workers, edge) don't expose stderr.
    const message = `\nInvalid environment variables:\n${issues}\n\n`;
    if (typeof process.stderr?.write === "function") {
      process.stderr.write(message);
    } else {
      // eslint-disable-next-line no-console -- intentional fallback for runtimes without stderr
      console.error(message);
    }
    if (typeof process.exit === "function") {
      process.exit(1);
    }
    throw new Error("Invalid environment variables");
  }
  return parsed.data;
}

export const env: Env = loadEnv();
export { EnvSchema };
export type { Env };
