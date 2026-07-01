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
});
