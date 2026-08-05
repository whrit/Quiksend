import { describe, expect, it } from "vitest";
import { EnvSchema } from "./env.schema.ts";

describe("EnvSchema", () => {
  it("applies defaults and accepts a valid DATABASE_URL", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
    });
    expect(parsed).toBeDefined();
    expect(parsed.DATABASE_URL).toBe(
      "postgres://quiksend:quiksend@localhost:5432/quiksend",
    );
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(EnvSchema.safeParse({}).success).toBe(false);
  });

  it("coerces SMTP_PORT to a number", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      SMTP_PORT: "2587",
    });
    expect(typeof parsed.SMTP_PORT).toBe("number");
    expect(parsed.SMTP_PORT).toBe(2587);
  });

  it("defaults AI provider to anthropic and PostHog host to US cloud", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
    });
    expect(parsed.AI_PROVIDER).toBe("anthropic");
    expect(parsed.POSTHOG_API_HOST).toContain("us");
  });

  it("coerces SENTRY_TRACES_SAMPLE_RATE and rejects out-of-range values", () => {
    const validParsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      SENTRY_TRACES_SAMPLE_RATE: "0.5",
    });
    expect(typeof validParsed.SENTRY_TRACES_SAMPLE_RATE).toBe("number");
    expect(validParsed.SENTRY_TRACES_SAMPLE_RATE).toBe(0.5);

    const invalidResult = EnvSchema.safeParse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      SENTRY_TRACES_SAMPLE_RATE: "1.5",
    });
    expect(invalidResult.success).toBe(false);
  });

  it("requires production-critical secrets when NODE_ENV is production", () => {
    const result = EnvSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
    });
    expect(result.success).toBe(false);
    const issues = !result.success ? result.error.issues : [];
    const messages = issues.map((i) => i.message ?? "").join(" ");
    expect(messages).toContain("BETTER_AUTH_SECRET");
    expect(messages).toContain("NANGO_WEBHOOK_SECRET");
    expect(messages).toContain("MAILBOX_ENCRYPTION_KEY");
    expect(messages).toContain("UNSUBSCRIBE_TOKEN_SECRET");
  });

  it("accepts production env when all critical secrets are present", () => {
    const result = EnvSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "https://app.quiksend.io",
      NANGO_WEBHOOK_SECRET: "nango-secret",
      MAILBOX_ENCRYPTION_KEY: "mailbox-key",
      UNSUBSCRIBE_TOKEN_SECRET: "unsub-secret",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional search provider API keys", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      PERPLEXITY_API_KEY: "key",
      TAVILY_API_KEY: "key2",
    });
    expect(parsed).toBeDefined();
  });

  it("treats search provider API keys as optional", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
    });
    expect(parsed.PERPLEXITY_API_KEY).toBeUndefined();
    expect(parsed.TAVILY_API_KEY).toBeUndefined();
  });

  it("defaults worker test hooks to off", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
    });
    expect(parsed.WORKER_TEST_HOOK_NO_ADVANCE_SCHEDULE).toBe(false);
    expect(parsed.WORKER_TEST_HOOK_NO_POLL).toBe(false);
  });

  it("parses worker test hook flags from env strings", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      WORKER_TEST_HOOK_NO_ADVANCE_SCHEDULE: "true",
      WORKER_TEST_HOOK_NO_POLL: "1",
    });
    expect(parsed.WORKER_TEST_HOOK_NO_ADVANCE_SCHEDULE).toBe(true);
    expect(parsed.WORKER_TEST_HOOK_NO_POLL).toBe(true);
  });

  it("forces worker test hooks off in production even when set", () => {
    const parsed = EnvSchema.parse({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "https://app.quiksend.io",
      NANGO_WEBHOOK_SECRET: "nango-secret",
      MAILBOX_ENCRYPTION_KEY: "mailbox-key",
      UNSUBSCRIBE_TOKEN_SECRET: "unsub-secret",
      WORKER_TEST_HOOK_NO_ADVANCE_SCHEDULE: "true",
      WORKER_TEST_HOOK_NO_POLL: "true",
    });
    expect(parsed.WORKER_TEST_HOOK_NO_ADVANCE_SCHEDULE).toBe(false);
    expect(parsed.WORKER_TEST_HOOK_NO_POLL).toBe(false);
  });

  it("rejects http:// BETTER_AUTH_URL in production", () => {
    const result = EnvSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "http://app.quiksend.io",
      NANGO_WEBHOOK_SECRET: "nango-secret",
      MAILBOX_ENCRYPTION_KEY: "mailbox-key",
      UNSUBSCRIBE_TOKEN_SECRET: "unsub-secret",
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0]?.message).toContain("HTTPS");
  });

  it("rejects localhost BETTER_AUTH_URL in production", () => {
    const result = EnvSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "https://localhost:3000",
      NANGO_WEBHOOK_SECRET: "nango-secret",
      MAILBOX_ENCRYPTION_KEY: "mailbox-key",
      UNSUBSCRIBE_TOKEN_SECRET: "unsub-secret",
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0]?.message).toContain("BETTER_AUTH_URL");
  });

  it("rejects loopback BETTER_AUTH_URL in production", () => {
    const result = EnvSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "https://127.0.0.1:3000",
      NANGO_WEBHOOK_SECRET: "nango-secret",
      MAILBOX_ENCRYPTION_KEY: "mailbox-key",
      UNSUBSCRIBE_TOKEN_SECRET: "unsub-secret",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unspecified (0.0.0.0) BETTER_AUTH_URL in production", () => {
    const result = EnvSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "https://0.0.0.0:3000",
      NANGO_WEBHOOK_SECRET: "nango-secret",
      MAILBOX_ENCRYPTION_KEY: "mailbox-key",
      UNSUBSCRIBE_TOKEN_SECRET: "unsub-secret",
    });
    expect(result.success).toBe(false);
  });

  it("allows localhost BETTER_AUTH_URL in development", () => {
    const result = EnvSchema.safeParse({
      NODE_ENV: "development",
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      BETTER_AUTH_URL: "http://localhost:3000",
    });
    expect(result.success).toBe(true);
  });
});
