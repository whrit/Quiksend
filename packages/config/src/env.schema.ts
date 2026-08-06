import { z } from "zod";

/** Truthy only for `1` / `true` (matches legacy `process.env.X === "1"` call sites). */
const envBooleanFlag = z
  .preprocess((value) => value === "1" || value === "true", z.boolean())
  .default(false);

const CanaryImapMockMode = z.enum(["inbox", "spam", "quarantine", "not_found", "bounce"]);
const EngineTestMode = z.enum(["permanent-failure"]);

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

    // Reverse-proxy trust. These gate whether `X-Forwarded-For` is believed when
    // deriving the client IP for rate limiting, so a typo must not silently flip
    // the boundary — validate them like everything else rather than reading raw
    // `process.env` at the call site.
    TRUST_PROXY: z
      .enum(["0", "1", "true", "false"])
      .default("0")
      .transform((v) => v === "1" || v === "true"),
    TRUSTED_PROXY_IPS: z.string().default("127.0.0.1,::1,::ffff:127.0.0.1"),

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

    // AI (Phase 8) — providers are model-agnostic behind an interface; either or both may be set.
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    // Default provider a workspace uses if it has not chosen one in settings.
    AI_DEFAULT_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),

    // AI research web search providers (Phase 8). Presence auto-selects a real provider; empty falls back to the fake.
    BRAVE_API_KEY: z.string().optional(),
    EXA_API_KEY: z.string().optional(),
    TAVILY_API_KEY: z.string().optional(),

    // Mail (Phase 4). Local Mailpit values come from docker-compose.yml.
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    // Optional relay auth — paired; both-or-neither is enforced below regardless of environment.
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    // TLS posture for the transactional relay. SMTP_SECURE = implicit TLS
    // (typically port 465); SMTP_REQUIRE_TLS = upgrade via STARTTLS and refuse
    // to send in the clear. Production requires at least one.
    SMTP_SECURE: envBooleanFlag,
    SMTP_REQUIRE_TLS: envBooleanFlag,
    // Envelope/header From for transactional (reset/invitation) mail. Required
    // in production so operator mail never falls back to the `*.local` dev address.
    SMTP_FROM: z.string().email().optional(),
    SMTP_FROM_NAME: z.string().optional(),
    // Encrypts SMTP mailbox credentials at rest (32-byte base64). Required once any SMTP mailbox is connected.
    MAILBOX_ENCRYPTION_KEY: z.string().optional(),
    // Encrypts provider-managed seed inbox IMAP credentials (Quiksend Systems infra only).
    SYSTEM_SEED_ENCRYPTION_KEY: z.string().optional(),
    // Bootstrap operator identity: the only account allowed to create the
    // first organization / sign up outside an invitation. Required in
    // production (every production deployment, including self-host, needs
    // exactly one bootstrap admin instead of fully open signup); optional in
    // development so local/self-host first-run stays a plain signup.
    SYSTEM_ADMIN_EMAIL: z.string().email().optional(),
    QUIKSEND_SYSTEM_ORG_ID: z.string().optional(),

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

    // Data lifecycle retention (Operations, Task 5). Backups (30d) are
    // documented in internal-runbooks/backup-restore.md — Task 4 owns that
    // script, there's no DB row to purge for it. Logs (14d) are retained by
    // the log aggregator/Sentry, not a DB table here.
    RETENTION_EVENT_DAYS: z.coerce.number().int().positive().default(180),
    RETENTION_WEBHOOK_ATTEMPT_DAYS: z.coerce.number().int().positive().default(30),
    RETENTION_DELETED_MESSAGE_DAYS: z.coerce.number().int().positive().default(365),

    // Worker test / load-test hooks — default off; forcibly disabled in production.
    QUIKSEND_ENGINE_FAKE_MAIL: envBooleanFlag,
    QUIKSEND_ENGINE_FORCE_OUTER_ROLLBACK: envBooleanFlag,
    QUIKSEND_ENGINE_TEST_MODE: EngineTestMode.optional(),
    QUIKSEND_CANARY_IMAP_MOCK: CanaryImapMockMode.optional(),
  })
  .transform((env) =>
    env.NODE_ENV === "production"
      ? {
          ...env,
          QUIKSEND_ENGINE_FAKE_MAIL: false,
          QUIKSEND_ENGINE_FORCE_OUTER_ROLLBACK: false,
          QUIKSEND_ENGINE_TEST_MODE: undefined,
          QUIKSEND_CANARY_IMAP_MOCK: undefined,
        }
      : env,
  )
  .refine(
    (env) =>
      env.NODE_ENV !== "production" ||
      (Boolean(env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET.length >= 32) &&
        Boolean(env.NANGO_WEBHOOK_SECRET) &&
        Boolean(env.MAILBOX_ENCRYPTION_KEY) &&
        Boolean(env.UNSUBSCRIBE_TOKEN_SECRET) &&
        Boolean(env.SYSTEM_ADMIN_EMAIL)),
    {
      message:
        "BETTER_AUTH_SECRET (>=32 bytes), NANGO_WEBHOOK_SECRET, MAILBOX_ENCRYPTION_KEY, UNSUBSCRIBE_TOKEN_SECRET, SYSTEM_ADMIN_EMAIL are all required in production",
    },
  )
  .refine(
    (env) => {
      if (env.NODE_ENV !== "production") return true;
      if (!env.BETTER_AUTH_URL) return false;
      try {
        const url = new URL(env.BETTER_AUTH_URL);
        const h = url.hostname;
        return (
          url.protocol === "https:" &&
          h !== "localhost" &&
          h !== "127.0.0.1" &&
          h !== "::1" &&
          h !== "0.0.0.0" &&
          h !== "::"
        );
      } catch {
        return false;
      }
    },
    {
      message:
        "BETTER_AUTH_URL is required in production and must be a public HTTPS URL (no localhost, loopback, or unspecified addresses)",
    },
  )
  .refine((env) => env.NODE_ENV !== "production" || !env.BETTER_AUTH_URL?.includes("localhost"), {
    message: "BETTER_AUTH_URL must not be localhost in production",
  })
  .refine(
    (env) =>
      env.NODE_ENV !== "production" ||
      (Boolean(env.SMTP_HOST) &&
        Boolean(env.SMTP_FROM) &&
        (env.SMTP_SECURE || env.SMTP_REQUIRE_TLS)),
    {
      message:
        "SMTP_HOST, SMTP_FROM, and TLS (SMTP_SECURE or SMTP_REQUIRE_TLS) are all required in production — transactional mail never falls back to a *.local address or an unencrypted relay",
    },
  )
  .refine((env) => Boolean(env.SMTP_USER) === Boolean(env.SMTP_PASS), {
    message: "SMTP_USER and SMTP_PASS must be set together, or not at all",
  })
  .refine(
    (env) => env.NODE_ENV !== "production" || !env.DATABASE_URL?.includes("quiksend:quiksend@"),
    {
      message: "DATABASE_URL must not use default credentials (quiksend:quiksend) in production",
    },
  )
  .refine((env) => env.NODE_ENV !== "production" || env.SMTP_HOST !== "mailpit", {
    message: 'SMTP_HOST must not be "mailpit" in production; set to a real SMTP provider',
  })
  .refine(
    (env) => {
      if (env.NODE_ENV !== "production") return true;
      if (!env.MAILBOX_ENCRYPTION_KEY) return true;

      try {
        // Validate base64 and check decoded length is 32 bytes
        const decoded = Buffer.from(env.MAILBOX_ENCRYPTION_KEY, "base64");
        return decoded.length === 32;
      } catch {
        return false;
      }
    },
    {
      message: "MAILBOX_ENCRYPTION_KEY must be valid base64 that decodes to exactly 32 bytes",
    },
  )
  .refine(
    (env) => {
      if (env.NODE_ENV !== "production") return true;
      if (!env.UNSUBSCRIBE_TOKEN_SECRET) return true;

      // Validate either raw string >= 32 bytes OR base64 that decodes to >= 32 bytes
      if (env.UNSUBSCRIBE_TOKEN_SECRET.length >= 32) {
        return true; // Assume raw string
      }

      try {
        const decoded = Buffer.from(env.UNSUBSCRIBE_TOKEN_SECRET, "base64");
        return decoded.length >= 32;
      } catch {
        return false;
      }
    },
    {
      message: "UNSUBSCRIBE_TOKEN_SECRET must be >= 32 bytes (raw or base64-decoded)",
    },
  );

export type Env = z.infer<typeof EnvSchema>;
