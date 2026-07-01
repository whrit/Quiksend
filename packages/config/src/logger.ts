import { pino } from "pino";
import { env } from "./env.ts";

/**
 * Structured logger. Pretty-prints in development; JSON everywhere else so logs
 * are machine-parseable in CI/production.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : {}),
});

export type Logger = typeof logger;
