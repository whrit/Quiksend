import { EnvSchema } from "@quiksend/config";

/**
 * Production environment validator. Runs before container startup to catch
 * dangerous configurations early (localhost URLs, default credentials, Mailpit,
 * missing secrets).
 *
 * Returns detailed error messages and exits with code 1 on failure.
 */

const ProductionEnvSchema = EnvSchema.refine(
  (env) => {
    if (env.NODE_ENV !== "production") {
      return true;
    }

    const errors: string[] = [];

    // Check for localhost BETTER_AUTH_URL
    if (env.BETTER_AUTH_URL && env.BETTER_AUTH_URL.includes("localhost")) {
      errors.push(
        'BETTER_AUTH_URL must not be localhost in production (got: "' +
          env.BETTER_AUTH_URL +
          '")',
      );
    }

    // Check for default database credentials (quiksend:quiksend)
    if (
      env.DATABASE_URL &&
      env.DATABASE_URL.includes("quiksend:quiksend@")
    ) {
      errors.push(
        "DATABASE_URL must not use default credentials (quiksend:quiksend) in production",
      );
    }

    // Check for Mailpit SMTP host
    if (env.SMTP_HOST === "mailpit") {
      errors.push(
        'SMTP_HOST must not be "mailpit" in production; set to a real SMTP provider',
      );
    }

    // Ensure SMTP_HOST and SMTP_PORT are set if any SMTP is configured
    if (env.SMTP_HOST || env.SMTP_PORT) {
      if (!env.SMTP_HOST) {
        errors.push("SMTP_HOST is required if SMTP_PORT is set");
      }
      if (!env.SMTP_PORT) {
        errors.push("SMTP_PORT is required if SMTP_HOST is set");
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }

    return true;
  },
  {
    message: "Production configuration validation failed",
  },
);

export function validateProductionEnv(env: Record<string, unknown>): void {
  const result = ProductionEnvSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.errors
      .map((err) => {
        if ("message" in err && err.message) {
          return `  ${err.message}`;
        }
        return `  ${err.path.join(".")}: ${err.code}`;
      })
      .join("\n");

    const message = `\nProduction environment validation failed:\n${issues}\n\n`;

    if (typeof process.stderr?.write === "function") {
      process.stderr.write(message);
    } else {
      console.error(message);
    }

    if (typeof process.exit === "function") {
      process.exit(1);
    }

    throw new Error("Production environment validation failed");
  }
}

// Run validation if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  validateProductionEnv(process.env);
  console.log("✓ Production environment validation passed");
}
