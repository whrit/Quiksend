import { describe, expect, it } from "vitest";
import { EnvSchema } from "./env.schema.ts";

function errorMessages(result: {
  success: boolean;
  error?: { issues: Array<{ message?: string }> };
}): string {
  if (result.success) return "";
  return result.error?.issues.map(({ message }) => message ?? "").join(" ") ?? "";
}

describe("EnvSchema", () => {
  it("applies defaults and accepts a valid DATABASE_URL", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
    });
    expect(parsed).toBeDefined();
    expect(parsed.DATABASE_URL).toBe("postgres://quiksend:quiksend@localhost:5432/quiksend");
  });

  it("rejects a missing DATABASE_URL", () => {
    const result = EnvSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    const messages = errorMessages(result);
    expect(messages).toContain("Required");
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
    expect(parsed.AI_DEFAULT_PROVIDER).toBe("anthropic");
    expect(parsed.POSTHOG_HOST).toContain("us");
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
    if (result.success) throw new Error("expected failure");
    const messages = errorMessages(result);
    expect(messages).toContain("BETTER_AUTH_SECRET");
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
      BRAVE_API_KEY: "brave-key",
      EXA_API_KEY: "exa-key",
      TAVILY_API_KEY: "tavily-key",
    });
    expect(parsed).toBeDefined();
    expect(parsed.BRAVE_API_KEY).toBe("brave-key");
    expect(parsed.EXA_API_KEY).toBe("exa-key");
    expect(parsed.TAVILY_API_KEY).toBe("tavily-key");
  });

  it("treats search provider API keys as optional", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
    });
    expect(parsed.BRAVE_API_KEY).toBeUndefined();
    expect(parsed.EXA_API_KEY).toBeUndefined();
    expect(parsed.TAVILY_API_KEY).toBeUndefined();
  });

  it("defaults engine test hooks to off", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
    });
    expect(parsed.QUIKSEND_ENGINE_FAKE_MAIL).toBe(false);
    expect(parsed.QUIKSEND_ENGINE_FORCE_OUTER_ROLLBACK).toBe(false);
  });

  it("parses engine test hook flags from env strings", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      QUIKSEND_ENGINE_FAKE_MAIL: "true",
      QUIKSEND_ENGINE_FORCE_OUTER_ROLLBACK: "1",
    });
    expect(parsed.QUIKSEND_ENGINE_FAKE_MAIL).toBe(true);
    expect(parsed.QUIKSEND_ENGINE_FORCE_OUTER_ROLLBACK).toBe(true);
  });

  it("forces engine test hooks off in production even when set", () => {
    const parsed = EnvSchema.parse({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "https://app.quiksend.io",
      NANGO_WEBHOOK_SECRET: "nango-secret",
      MAILBOX_ENCRYPTION_KEY: "mailbox-key",
      UNSUBSCRIBE_TOKEN_SECRET: "unsub-secret",
      QUIKSEND_ENGINE_FAKE_MAIL: "true",
      QUIKSEND_ENGINE_FORCE_OUTER_ROLLBACK: "true",
    });
    expect(parsed.QUIKSEND_ENGINE_FAKE_MAIL).toBe(false);
    expect(parsed.QUIKSEND_ENGINE_FORCE_OUTER_ROLLBACK).toBe(false);
    expect(parsed.QUIKSEND_ENGINE_TEST_MODE).toBeUndefined();
    expect(parsed.QUIKSEND_CANARY_IMAP_MOCK).toBeUndefined();
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
    if (result.success) throw new Error("expected failure");
    const messages = errorMessages(result);
    expect(messages).toContain("HTTPS");
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
    if (result.success) throw new Error("expected failure");
    const messages = errorMessages(result);
    expect(messages).toContain("BETTER_AUTH_URL");
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
    if (result.success) throw new Error("expected failure");
    const messages = errorMessages(result);
    expect(messages).toContain("not permitted");
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
    if (result.success) throw new Error("expected failure");
    const messages = errorMessages(result);
    expect(messages).toContain("not permitted");
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
