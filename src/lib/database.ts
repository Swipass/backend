/**
 * Prisma client singleton.
 * Reuses the same instance across hot-reloads in development.
 */
import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? [{ emit: "event", level: "query" }, "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

export async function connectDB(): Promise<void> {
  await prisma.$connect();
  logger.info("✓ Database connected");
}

export async function disconnectDB(): Promise<void> {
  await prisma.$disconnect();
  logger.info("Database disconnected");
}
