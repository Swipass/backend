/**
 * IZIPASS BACKEND — v0.1
 *
 * Startup sequence:
 *   1. Run Prisma migrations (auto — never needs manual db:migrate)
 *   2. Seed database (admin, fee config, bridge list)
 *   3. Connect Redis (optional — degrades gracefully)
 *   4. Build Fastify app
 *   5. Register routes
 *   6. Start status poller
 *   7. Listen
 */
import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { execSync } from "child_process";

import { logger } from "./utils/logger";
import { connectDB } from "./lib/database";
import { connectRedis } from "./lib/redis";
import { seed } from "./lib/seed";
import { registerRoutes } from "./routes/index";
import { startStatusPoller } from "./workers/statusPoller";

// ── Step 1: Run migrations automatically ──────────────────────
async function migrate(): Promise<void> {
  logger.info("Running database migrations...");
  try {
    execSync("npx prisma migrate deploy", { stdio: "pipe" });
    logger.info("✓ Migrations applied");
  } catch {
    // migrate deploy fails if no migration history — use db push instead
    logger.warn("No migration history found, pushing schema directly...");
    try {
      execSync("npx prisma db push --accept-data-loss", { stdio: "pipe" });
      logger.info("✓ Schema pushed");
    } catch (err) {
      logger.error({ err }, "❌ Database setup failed");
      process.exit(1);
    }
  }
  // Always regenerate the client after schema changes
  execSync("npx prisma generate", { stdio: "pipe" });
}

// ── Step 4: Build Fastify app ─────────────────────────────────
async function buildApp() {
  const app = Fastify({
    logger: false, // we use pino directly
    trustProxy: true,
    ajv: { customOptions: { strict: false } },
  });

  // Security headers
  await app.register(helmet, { contentSecurityPolicy: false });

  // CORS — allow frontend origin
  await app.register(cors, {
    origin: process.env.FRONTEND_URL
      ? [process.env.FRONTEND_URL, "http://localhost:3000", "http://localhost:3001"]
      : true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX ?? "60"),
    timeWindow: 60_000, // per minute
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      success: false,
      error: "Too many requests — please slow down",
    }),
  });

  // JWT (for admin)
  await app.register(jwt, {
    secret: process.env.JWT_SECRET || "izipass_dev_secret_change_in_production",
  });

  // Swagger docs
  await app.register(swagger, {
    openapi: {
      info: { title: "Izipass API", version: "0.1.0", description: "Universal cross-chain bridge API" },
      servers: [{ url: process.env.API_URL || "http://localhost:4000" }],
    },
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list" },
  });

  // Global 404
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ success: false, error: "Route not found" });
  });

  // Global error handler
  app.setErrorHandler((err, _req, reply) => {
    logger.error({ err: err.message, stack: err.stack }, "Unhandled error");
    reply.status(500).send({ success: false, error: "Internal server error" });
  });

  return app;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  logger.info("Starting Izipass API v0.1...");

  await migrate();
  await connectDB();
  await seed();
  await connectRedis();

  const app = await buildApp();
  await registerRoutes(app);

  startStatusPoller();

  const port = parseInt(process.env.PORT ?? "4000");
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({ port, host });
  logger.info(`✓ API listening on http://${host}:${port}`);
  logger.info(`✓ Swagger docs at http://${host}:${port}/docs`);
  logger.info(`✓ Admin login: ${process.env.ADMIN_EMAIL ?? "admin@izipass.dev"}`);
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received — shutting down");
  process.exit(0);
});
process.on("SIGINT", async () => {
  logger.info("SIGINT received — shutting down");
  process.exit(0);
});

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
