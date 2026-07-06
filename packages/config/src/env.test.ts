import { describe, expect, it } from "vitest";
import { EnvSchema } from "./env.schema.ts";

describe("EnvSchema", () => {
  it("applies defaults and accepts a valid DATABASE_URL", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
    });
    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.LOG_LEVEL).toBe("info");
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(EnvSchema.safeParse({}).success).toBe(false);
  });

  it("coerces SMTP_PORT to a number", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      SMTP_PORT: "1025",
    });
    expect(parsed.SMTP_PORT).toBe(1025);
  });

  it("defaults AI provider to anthropic and PostHog host to US cloud", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
    });
    expect(parsed.AI_DEFAULT_PROVIDER).toBe("anthropic");
    expect(parsed.POSTHOG_HOST).toBe("https://us.i.posthog.com");
    expect(parsed.SENTRY_TRACES_SAMPLE_RATE).toBe(0.1);
  });

  it("coerces SENTRY_TRACES_SAMPLE_RATE and rejects out-of-range values", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      SENTRY_TRACES_SAMPLE_RATE: "0.5",
    });
    expect(parsed.SENTRY_TRACES_SAMPLE_RATE).toBe(0.5);
    expect(
      EnvSchema.safeParse({
        DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
        SENTRY_TRACES_SAMPLE_RATE: "2",
      }).success,
    ).toBe(false);
  });

  it("requires production-critical secrets when NODE_ENV is production", () => {
    const result = EnvSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
    });
    expect(result.success).toBe(false);
    const message = result.success ? "" : (result.error.issues[0]?.message ?? "");
    expect(message).toContain("BETTER_AUTH_SECRET");
    expect(message).toContain("NANGO_WEBHOOK_SECRET");
    expect(message).toContain("MAILBOX_ENCRYPTION_KEY");
    expect(message).toContain("UNSUBSCRIBE_TOKEN_SECRET");
  });

  it("accepts production env when all critical secrets are present", () => {
    const result = EnvSchema.safeParse({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      BETTER_AUTH_SECRET: "a".repeat(32),
      NANGO_WEBHOOK_SECRET: "nango-secret",
      MAILBOX_ENCRYPTION_KEY: "mailbox-key",
      UNSUBSCRIBE_TOKEN_SECRET: "unsub-secret",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional search provider API keys", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
      BRAVE_API_KEY: "brave-token",
      EXA_API_KEY: "exa-token",
      TAVILY_API_KEY: "tavily-token",
    });
    expect(parsed.BRAVE_API_KEY).toBe("brave-token");
    expect(parsed.EXA_API_KEY).toBe("exa-token");
    expect(parsed.TAVILY_API_KEY).toBe("tavily-token");
  });

  it("treats search provider API keys as optional", () => {
    const parsed = EnvSchema.parse({
      DATABASE_URL: "postgres://quiksend:quiksend@localhost:5432/quiksend",
    });
    expect(parsed.BRAVE_API_KEY).toBeUndefined();
    expect(parsed.EXA_API_KEY).toBeUndefined();
    expect(parsed.TAVILY_API_KEY).toBeUndefined();
  });
});
