/**
 * Database seed — runs automatically on every server startup.
 * Safe to run multiple times (uses upsert / findFirst).
 *
 * Creates:
 *   1. Admin account (from ADMIN_EMAIL / ADMIN_PASSWORD env vars)
 *   2. Default fee configuration
 *   3. Default bridge list
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { logger } from "../utils/logger";

const prisma = new PrismaClient();

export async function seed(): Promise<void> {
  logger.info("Running database seed...");

  // ── 1. Admin user ──────────────────────────────────────────
  const email = process.env.ADMIN_EMAIL || "admin@swipass.dev";
  const password = process.env.ADMIN_PASSWORD || "Admin@123456";

  const existing = await prisma.admin.findFirst({ where: { email } });
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.admin.create({
      data: { email, passwordHash, name: "Izipass Admin" },
    });
    logger.info({ email }, "✓ Admin account created");
  } else {
    logger.info({ email }, "✓ Admin account already exists");
  }

  // ── 2. Fee config ──────────────────────────────────────────
  const feeExists = await prisma.feeConfig.findFirst();
  if (!feeExists) {
    await prisma.feeConfig.create({
      data: {
        feePct: 0.003,   // 0.3%
        minFeePct: 0.001,
        maxFeePct: 0.005,
      },
    });
    logger.info("✓ Default fee config created");
  }

  // ── 3. Bridge list ─────────────────────────────────────────
  const bridges = [
    "across", "stargate", "hop", "celer", "connext",
    "wormhole", "synapse", "debridge", "symbiosis",
  ];
  for (const name of bridges) {
    await prisma.bridgeConfig.upsert({
      where: { name },
      update: {},
      create: { name, isEnabled: true },
    });
  }
  logger.info("✓ Bridge configs seeded");

  logger.info("Seed complete");
}

// Allow running directly: tsx src/lib/seed.ts
if (require.main === module) {
  seed()
    .catch((e) => { logger.error(e, "Seed failed"); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
