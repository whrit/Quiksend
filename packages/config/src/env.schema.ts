import { z } from "zod";

/**
 * Pure environment schema — no side effects, safe to import anywhere (including tests).
 * The eager, fail-fast loader lives in `env.ts`.
 *
 * Phase 0 only *requires* DATABASE_URL. Later phases add their own vars here and flip
 * them from optional to required as they come online.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // Required (Phase 0)
  DATABASE_URL: z.string().url(),

  // Auth (Phase 1)
  BETTER_AUTH_SECRET: z.string().min(1).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MS_CLIENT_ID: z.string().optional(),
  MS_CLIENT_SECRET: z.string().optional(),

  // Integrations (Phase 3)
  NANGO_SECRET_KEY: z.string().optional(),

  // AI (Phase 8)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // Local mail (Phase 4)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),

  // Observability (optional)
  SENTRY_DSN: z.string().optional(),
  POSTHOG_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;
