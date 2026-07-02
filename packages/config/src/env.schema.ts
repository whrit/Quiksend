import { z } from "zod";

/**
 * Pure environment schema — no side effects, safe to import anywhere (including tests).
 * The eager, fail-fast loader lives in `env.ts`.
 *
 * Phase 0 only *requires* DATABASE_URL. Later phases add their own vars here and flip
 * them from optional to required as they come online.
 */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    // Required (Phase 0)
    DATABASE_URL: z.string().url(),
    // Set to `transaction` when using PgBouncer/Neon pooled endpoints (disables prepared statements).
    DATABASE_POOLER_MODE: z.enum(["transaction"]).optional(),

    // Webhook delivery throughput (Phase 10)
    WEBHOOK_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
    WEBHOOK_SWEEP_BATCH_SIZE: z.coerce.number().int().positive().default(50),
    WEBHOOK_DELIVER_CONCURRENCY: z.coerce.number().int().positive().default(5),

    // Auth (Phase 1)
    BETTER_AUTH_SECRET: z.string().min(1).optional(),
    BETTER_AUTH_URL: z.string().url().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    MS_CLIENT_ID: z.string().optional(),
    MS_CLIENT_SECRET: z.string().optional(),

    // Integrations (Phase 3)
    // Set NANGO_SECRET_KEY once a workspace connects Salesforce/HubSpot/Gmail/Microsoft.
    NANGO_SECRET_KEY: z.string().optional(),
    // Verifies Nango's inbound webhook signatures (/api/nango/webhook).
    NANGO_WEBHOOK_SECRET: z.string().optional(),
    // Optional public base URL Nango redirects back to on connect completion.
    NANGO_PUBLIC_URL: z.string().url().optional(),

    // AI (Phase 8) — providers are model-agnostic behind an interface; either or both may be set.
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    // Default provider a workspace uses if it has not chosen one in settings.
    AI_DEFAULT_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),

    // Mail (Phase 4). Local Mailpit values come from docker-compose.yml.
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    // Encrypts SMTP mailbox credentials at rest (32-byte base64). Required once any SMTP mailbox is connected.
    MAILBOX_ENCRYPTION_KEY: z.string().optional(),

    // Signs unsubscribe tokens embedded in outbound messages.
    UNSUBSCRIBE_TOKEN_SECRET: z.string().optional(),

    // Phase 11B — SEG routing sub-cap per mailbox (default 50).
    SEG_DAILY_CAP_PER_MAILBOX: z.coerce.number().int().positive().default(50),

    // Hostname used to detect Quiksend open-tracking pixels in HTML (defaults to BETTER_AUTH_URL host).
    TRACKING_PIXEL_DOMAIN: z.string().optional(),

    // Observability (optional). Sentry captures errors in web + worker; PostHog tracks product events.
    SENTRY_DSN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
    POSTHOG_KEY: z.string().optional(),
    POSTHOG_HOST: z.string().url().default("https://us.i.posthog.com"),
  })
  .refine(
    (env) =>
      env.NODE_ENV !== "production" ||
      (Boolean(env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET.length >= 32) &&
        Boolean(env.NANGO_WEBHOOK_SECRET) &&
        Boolean(env.MAILBOX_ENCRYPTION_KEY) &&
        Boolean(env.UNSUBSCRIBE_TOKEN_SECRET)),
    {
      message:
        "BETTER_AUTH_SECRET (>=32 bytes), NANGO_WEBHOOK_SECRET, MAILBOX_ENCRYPTION_KEY, UNSUBSCRIBE_TOKEN_SECRET are all required in production",
    },
  );

export type Env = z.infer<typeof EnvSchema>;
