import { describe, it, expect } from "vitest";
import { validateProductionEnv } from "./validate-production-env";

/**
 * Production environment validation tests.
 * Assert that dangerous configurations are rejected when NODE_ENV=production:
 * - Missing required secrets
 * - Localhost BETTER_AUTH_URL
 * - Default database credentials (quiksend:quiksend)
 * - Mailpit SMTP host
 */

describe("production-env validation", () => {
  describe("rejects missing required secrets", () => {
    it("rejects production without BETTER_AUTH_SECRET", () => {
      const config = {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://user:pass@prod-db:5432/app",
        BETTER_AUTH_SECRET: "", // empty
        BETTER_AUTH_URL: "https://example.com",
        NANGO_WEBHOOK_SECRET: "secret",
        MAILBOX_ENCRYPTION_KEY: "base64secret",
        UNSUBSCRIBE_TOKEN_SECRET: "secret",
        SMTP_HOST: "smtp.provider.com",
        SMTP_PORT: "587",
      };
      expect(() => validateProductionEnv(config)).toThrow(
        /BETTER_AUTH_SECRET|NANGO_WEBHOOK_SECRET|MAILBOX_ENCRYPTION_KEY|UNSUBSCRIBE_TOKEN_SECRET/,
      );
    });

    it("rejects production without NANGO_WEBHOOK_SECRET", () => {
      const config = {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://user:pass@prod-db:5432/app",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "https://example.com",
        NANGO_WEBHOOK_SECRET: "", // empty
        MAILBOX_ENCRYPTION_KEY: "base64secret",
        UNSUBSCRIBE_TOKEN_SECRET: "secret",
        SMTP_HOST: "smtp.provider.com",
        SMTP_PORT: "587",
      };
      expect(() => validateProductionEnv(config)).toThrow(
        /BETTER_AUTH_SECRET|NANGO_WEBHOOK_SECRET|MAILBOX_ENCRYPTION_KEY|UNSUBSCRIBE_TOKEN_SECRET/,
      );
    });

    it("rejects production without MAILBOX_ENCRYPTION_KEY", () => {
      const config = {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://user:pass@prod-db:5432/app",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "https://example.com",
        NANGO_WEBHOOK_SECRET: "secret",
        MAILBOX_ENCRYPTION_KEY: "", // empty
        UNSUBSCRIBE_TOKEN_SECRET: "secret",
        SMTP_HOST: "smtp.provider.com",
        SMTP_PORT: "587",
      };
      expect(() => validateProductionEnv(config)).toThrow(
        /BETTER_AUTH_SECRET|NANGO_WEBHOOK_SECRET|MAILBOX_ENCRYPTION_KEY|UNSUBSCRIBE_TOKEN_SECRET/,
      );
    });

    it("rejects production without UNSUBSCRIBE_TOKEN_SECRET", () => {
      const config = {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://user:pass@prod-db:5432/app",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "https://example.com",
        NANGO_WEBHOOK_SECRET: "secret",
        MAILBOX_ENCRYPTION_KEY: "base64secret",
        UNSUBSCRIBE_TOKEN_SECRET: "", // empty
        SMTP_HOST: "smtp.provider.com",
        SMTP_PORT: "587",
      };
      expect(() => validateProductionEnv(config)).toThrow(
        /BETTER_AUTH_SECRET|NANGO_WEBHOOK_SECRET|MAILBOX_ENCRYPTION_KEY|UNSUBSCRIBE_TOKEN_SECRET/,
      );
    });
  });

  describe("rejects localhost URLs in production", () => {
    it("rejects BETTER_AUTH_URL=http://localhost:3000", () => {
      const config = {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://user:pass@prod-db:5432/app",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://localhost:3000", // localhost
        NANGO_WEBHOOK_SECRET: "secret",
        MAILBOX_ENCRYPTION_KEY: "base64secret",
        UNSUBSCRIBE_TOKEN_SECRET: "secret",
        SMTP_HOST: "smtp.provider.com",
        SMTP_PORT: "587",
      };
      expect(() => validateProductionEnv(config)).toThrow(/localhost/);
    });
  });

  describe("rejects default database credentials in production", () => {
    it("rejects DATABASE_URL with default quiksend:quiksend credentials", () => {
      const config = {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://quiksend:quiksend@postgres:5432/quiksend", // default creds
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "https://example.com",
        NANGO_WEBHOOK_SECRET: "secret",
        MAILBOX_ENCRYPTION_KEY: "base64secret",
        UNSUBSCRIBE_TOKEN_SECRET: "secret",
        SMTP_HOST: "smtp.provider.com",
        SMTP_PORT: "587",
      };
      expect(() => validateProductionEnv(config)).toThrow(
        /default credentials/,
      );
    });
  });

  describe("rejects Mailpit SMTP in production", () => {
    it("rejects SMTP_HOST=mailpit", () => {
      const config = {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://user:pass@prod-db:5432/app",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "https://example.com",
        NANGO_WEBHOOK_SECRET: "secret",
        MAILBOX_ENCRYPTION_KEY: "base64secret",
        UNSUBSCRIBE_TOKEN_SECRET: "secret",
        SMTP_HOST: "mailpit", // Mailpit host
        SMTP_PORT: "1025",
      };
      expect(() => validateProductionEnv(config)).toThrow(/Mailpit|mailpit/);
    });
  });

  describe("allows valid production config", () => {
    it("accepts valid production environment", () => {
      const config = {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://produser:prodpass@prod-db.internal:5432/appdb",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "https://app.example.com",
        NANGO_WEBHOOK_SECRET: "nango-secret-123",
        MAILBOX_ENCRYPTION_KEY: "base64encodedkey==",
        UNSUBSCRIBE_TOKEN_SECRET: "unsubscribe-secret",
        SMTP_HOST: "smtp.provider.com",
        SMTP_PORT: "587",
      };
      expect(() => validateProductionEnv(config)).not.toThrow();
    });
  });
});
        BETTER_AUTH_URL: "https://app.example.com",
        NANGO_WEBHOOK_SECRET: "nango-secret-123",
        MAILBOX_ENCRYPTION_KEY: "base64encodedkey==",
        UNSUBSCRIBE_TOKEN_SECRET: "unsubscribe-secret",
        SMTP_HOST: "smtp.provider.com",
        SMTP_PORT: 587,
        SMTP_FROM: "noreply@example.com",
      };
      expect(() => EnvSchema.parse(config)).not.toThrow();
    });
  });
});
