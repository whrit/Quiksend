import { Nango } from "@nangohq/node";
import { env } from "@quiksend/config";

/**
 * Long-lived Nango client. `env.NANGO_SECRET_KEY` is optional in the schema
 * (later phases turn it on) — call `getNango()` lazily and it throws if the
 * key is missing, giving a clear runtime error rather than a `.env` mystery.
 */
let cached: Nango | null = null;

export function getNango(): Nango {
  if (cached) return cached;
  if (!env.NANGO_SECRET_KEY) {
    throw new Error(
      "NANGO_SECRET_KEY is not set. Configure Nango Cloud credentials before connecting a CRM or mailbox.",
    );
  }
  cached = new Nango({ secretKey: env.NANGO_SECRET_KEY });
  return cached;
}

/** Test hook to reset the cached client between runs. */
export function resetNangoForTests(): void {
  cached = null;
}
