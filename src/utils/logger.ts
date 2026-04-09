/**
 * Structured logger using pino.
 * In development: pretty-prints with colours.
 * In production:  outputs JSON lines (ready for Datadog / CloudWatch).
 */
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "izipass-api", version: "0.1.0" },
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname,service,version",
          },
        }
      : undefined,
});
