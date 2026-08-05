import { describe, expect, it } from "vitest";
import { EnvSchema } from "./env.schema.ts";

function errorMessages(result: {
  success: boolean;
  error?: { issues: Array<{ message?: string; path?: readonly PropertyKey[] }> };
}): string {
  if (result.success) return "";
  return (
    result.error?.issues
      .map(({ message, path }) => `${(path ?? []).map(String).join(".")} ${message ?? ""}`)
      .join(" ") ?? ""
  );
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
    expect(messages).toContain("DATABASE_URL");
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
    expect(messages).toContain("NANGO_WEBHOOK_SECRET");
    expect(messages).toContain("MAILBOX_ENCRYPTION_KEY");
    expect(messages).toContain("UNSUBSCRIBE_TOKEN_SECRET");
    expect(messages).toContain("SYSTEM_ADMIN_EMAIL");
  });

  it("leaves SYSTEM_ADMIN_EMAIL optional outside production (self-host stays open)", () => {
    const result = EnvSchema.safeParse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.SYSTEM_ADMIN_EMAIL).toBeUndefined();
  });

  it("requires an aligned SMTP_FROM and TLS posture in production", () => {
    const result = EnvSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "https://app.quiksend.io",
      NANGO_WEBHOOK_SECRET: "nango-secret",
      MAILBOX_ENCRYPTION_KEY: "mailbox-key",
      UNSUBSCRIBE_TOKEN_SECRET: "unsub-secret",
      SYSTEM_ADMIN_EMAIL: "admin@quiksend.example",
      SMTP_HOST: "smtp.quiksend.example",
      // SMTP_FROM and TLS deliberately omitted.
    });
    expect(result.success).toBe(false);
    const message = result.success ? "" : (result.error.issues.find((i) => i.message.includes("SMTP"))?.message ?? "");
    expect(message).toContain("SMTP_FROM");
    expect(message).toContain("SMTP_SECURE");
  });

  it("rejects SMTP_USER without a paired SMTP_PASS in any environment", () => {
    const result = EnvSchema.safeParse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      SMTP_USER: "relay-user",
    });
    expect(result.success).toBe(false);
    const message = result.success ? "" : (result.error.issues[0]?.message ?? "");
    expect(message).toContain("SMTP_USER and SMTP_PASS must be set together");
  });

  it("accepts production env when all critical secrets, SYSTEM_ADMIN_EMAIL, and an aligned SMTP posture are present", () => {
    const result = EnvSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      BETTER_AUTH_SECRET: "a".repeat(32),
      NANGO_WEBHOOK_SECRET: "nango-secret",
      MAILBOX_ENCRYPTION_KEY: "mailbox-key",
      UNSUBSCRIBE_TOKEN_SECRET: "unsub-secret",
      SYSTEM_ADMIN_EMAIL: "admin@quiksend.example",
      SMTP_HOST: "smtp.quiksend.example",
      SMTP_FROM: "no-reply@quiksend.example",
      SMTP_SECURE: "1",
      SMTP_USER: "relay-user",
      SMTP_PASS: "relay-pass",
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
      DATABASE_URL: "postgres://quiksend_prod:R4nd0m-Str0ng-Db-Passw0rd@db.internal.quiksend.example:5432/quiksend",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "https://app.quiksend.io",
      NANGO_WEBHOOK_SECRET: "nango-secret",
      MAILBOX_ENCRYPTION_KEY: "7+v7Obw4LLnu6Caweg07W89jcuFWXkxo1R4kD8lKm4Y=",
      UNSUBSCRIBE_TOKEN_SECRET: "+6gGXPHFvKZLSvt6bBbAPR28KrwZzFKh/71HkdcUY5A=",
      SYSTEM_ADMIN_EMAIL: "admin@quiksend.example",
      SMTP_HOST: "smtp.quiksend.example",
      SMTP_FROM: "no-reply@quiksend.example",
      SMTP_SECURE: "1",
      QUIKSEND_ENGINE_FAKE_MAIL: "1",
      QUIKSEND_ENGINE_FORCE_OUTER_ROLLBACK: "1",
      QUIKSEND_ENGINE_TEST_MODE: "permanent-failure",
      QUIKSEND_CANARY_IMAP_MOCK: "inbox",
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
    expect(messages).toContain("localhost, loopback, or unspecified addresses");
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
    expect(messages).toContain("localhost, loopback, or unspecified addresses");
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
