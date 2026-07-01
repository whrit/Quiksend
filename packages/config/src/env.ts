import { EnvSchema } from "./env.schema.ts";
import type { Env } from "./env.schema.ts";

/**
 * Eager, fail-fast environment loader. If required vars are missing or malformed the
 * process exits at startup rather than blowing up somewhere deep in a request.
 *
 * The schema itself lives in `env.schema.ts` (no side effects) so it can be imported
 * and unit-tested without triggering this load.
 */
function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    // Using process.stderr directly so this works before the logger is wired.
    process.stderr.write(`\nInvalid environment variables:\n${issues}\n\n`);
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
export { EnvSchema };
export type { Env };
