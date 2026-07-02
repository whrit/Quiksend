import { env, logger } from "@quiksend/config";
import { PostHog } from "posthog-node";

/**
 * Lazy PostHog client. Returns `null` (and a debug log) when `POSTHOG_KEY` is
 * unset — call sites do `posthog?.capture(...)` to no-op cleanly.
 *
 * Product events land in Phase 9 (analytics) and Phase 10 (API usage). Wiring
 * the client early keeps the observability shape consistent across the two
 * apps without churning downstream imports later.
 */
let cached: PostHog | null | undefined;

export function getPostHog(): PostHog | null {
  if (cached !== undefined) return cached;
  if (!env.POSTHOG_KEY) {
    logger.debug("POSTHOG_KEY not set; PostHog disabled");
    cached = null;
    return null;
  }
  cached = new PostHog(env.POSTHOG_KEY, { host: env.POSTHOG_HOST });
  logger.info("PostHog initialized");
  return cached;
}

export async function shutdownPostHog(): Promise<void> {
  if (!cached) return;
  await cached.shutdown();
  cached = null;
}
