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
});
