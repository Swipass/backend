/**
 * Admin Service — all data needed by the admin dashboard.
 */
import { prisma } from "../lib/database";
import bcrypt from "bcryptjs";
import { logger } from "../utils/logger";

// ── Authentication ────────────────────────────────────────────

export async function adminLogin(email: string, password: string) {
  const admin = await prisma.admin.findFirst({ where: { email } });
  if (!admin) return null;

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) return null;

  logger.info({ email }, "Admin login");
  return { id: admin.id, email: admin.email, name: admin.name };
}

// ── Dashboard stats ───────────────────────────────────────────

export async function getDashboardStats() {
  const now = new Date();
  const day = new Date(now.getTime() - 86_400_000);
  const week = new Date(now.getTime() - 7 * 86_400_000);

  const [
    totalExecutions,
    successExecutions,
    failedExecutions,
    dailyExecutions,
    weeklyExecutions,
    pendingExecutions,
    totalQuotes,
    recentExecutions,
  ] = await Promise.all([
    prisma.execution.count(),
    prisma.execution.count({ where: { status: "SUCCESS" } }),
    prisma.execution.count({ where: { status: "FAILED" } }),
    prisma.execution.count({ where: { createdAt: { gte: day } } }),
    prisma.execution.count({ where: { createdAt: { gte: week } } }),
    prisma.execution.count({ where: { status: { in: ["PENDING", "BRIDGING"] } } }),
    prisma.quote.count(),
    prisma.execution.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { quote: { select: { fromChain: true, toChain: true, fromToken: true, toToken: true } } },
    }),
  ]);

  const successRate =
    totalExecutions > 0
      ? Math.round((successExecutions / totalExecutions) * 1000) / 10
      : 0;

  return {
    totalExecutions,
    successExecutions,
    failedExecutions,
    successRate,
    dailyExecutions,
    weeklyExecutions,
    pendingExecutions,
    totalQuotes,
    recentExecutions,
  };
}

// ── Executions list ───────────────────────────────────────────

export async function listExecutions(page = 1, limit = 20, status?: string) {
  const where = status ? { status: status as any } : {};
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.execution.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        quote: {
          select: {
            fromChain: true, toChain: true,
            fromToken: true, toToken: true,
            fromAmount: true, toAmount: true, feePct: true,
          },
        },
      },
    }),
    prisma.execution.count({ where }),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

// ── Fee config ────────────────────────────────────────────────

export async function getFeeConfig() {
  return prisma.feeConfig.findFirst({ where: { isActive: true } });
}

export async function updateFeeConfig(data: { feePct?: number; minFeePct?: number; maxFeePct?: number }) {
  const existing = await prisma.feeConfig.findFirst({ where: { isActive: true } });
  if (existing) {
    return prisma.feeConfig.update({ where: { id: existing.id }, data });
  }
  return prisma.feeConfig.create({ data: { feePct: 0.003, minFeePct: 0.001, maxFeePct: 0.005, ...data } });
}

// ── Bridge config ─────────────────────────────────────────────

export async function getBridgeConfigs() {
  return prisma.bridgeConfig.findMany({ orderBy: { name: "asc" } });
}

export async function updateBridgeConfig(name: string, isEnabled: boolean) {
  return prisma.bridgeConfig.upsert({
    where: { name },
    update: { isEnabled },
    create: { name, isEnabled },
  });
}
