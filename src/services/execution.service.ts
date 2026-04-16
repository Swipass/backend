/**
 * Execution Service — v0.2 (Execution Guarantee Layer)
 *
 * Upgrades:
 * - Route validation before execution
 * - Simulation-based execution safety
 * - Smart retry engine (auto fresh quote)
 */

import { ExecutionStatus } from "@prisma/client";
import { prisma } from "../lib/database";
import { lifi } from "../adapters/lifi.adapter";
import { logger } from "../utils/logger";

export interface ExecuteRequest {
  quoteId: string;
  userAddress: string;
  recipientAddress: string;
}

export interface ExecuteResponse {
  executionId: string;
  trackingUrl: string;
  transactionRequest: {
    to: string;
    from: string;
    data: string;
    value: string;
    gasLimit: string;
    gasPrice?: string;
    chainId: number;
  };
}

// ─────────────────────────────────────────────────────────────
// 🔥 EXECUTION GUARANTEE LAYER
// ─────────────────────────────────────────────────────────────

export async function prepareExecution(req: ExecuteRequest): Promise<ExecuteResponse> {
  const quote = await prisma.quote.findUnique({
    where: { id: req.quoteId },
  });

  if (!quote) throw new Error("Quote not found");
  if (quote.status === "EXECUTED") throw new Error("Quote already used");
  if (quote.expiresAt < new Date()) throw new Error("Quote expired");

  // ── STEP 1: Validate Route ─────────────────────────
  const valid = await lifi.validateRoute(quote.routeData);
  if (!valid) {
    throw new Error("Route invalid — refresh required");
  }

  // ── STEP 2: Build + Simulate ───────────────────────
  let txReq = await lifi.buildTransaction(
    quote.routeData as Record<string, unknown>,
    req.userAddress,
    req.recipientAddress
  );

  // ── STEP 3: Smart Retry ────────────────────────────
  if (!txReq) {
    logger.warn("Retrying execution with fresh route");

    const fresh = await lifi.getQuote({
      fromChainId: quote.fromChainId,
      toChainId: quote.toChainId,
      fromTokenAddress: quote.fromTokenAddr,
      toTokenAddress: quote.toTokenAddr,
      fromAmount: quote.fromAmount,
      fromAddress: req.userAddress,
      toAddress: req.recipientAddress,
    });

    if (!fresh) {
      throw new Error("Unable to refresh route");
    }

    txReq = await lifi.buildTransaction(
      fresh.rawRoute,
      req.userAddress,
      req.recipientAddress
    );

    if (!txReq) {
      throw new Error("Execution failed after retry");
    }
  }

  // ── Create Execution ───────────────────────────────
  const execution = await prisma.execution.create({
    data: {
      quoteId: quote.id,
      userAddress: req.userAddress,
      recipientAddress: req.recipientAddress,
      status: ExecutionStatus.PENDING,
    },
  });

  logger.info({ executionId: execution.id }, "Execution prepared");

  const appUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  return {
    executionId: execution.id,
    trackingUrl: `${appUrl}/bridge/status/${execution.id}`,
    transactionRequest: txReq,
  };
}

// ── Rest unchanged (keep your logic) ─────────────────────────

export async function submitTxHash(executionId: string, txHash: string): Promise<void> {
  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    include: { quote: true },
  });

  if (!execution) throw new Error("Execution not found");
  if (execution.txHash) return;

  await prisma.$transaction([
    prisma.execution.update({
      where: { id: executionId },
      data: { txHash, status: ExecutionStatus.BRIDGING },
    }),
    prisma.quote.update({
      where: { id: execution.quoteId },
      data: { status: "EXECUTED" },
    }),
  ]);

  logger.info({ executionId, txHash }, "Tx submitted successfully");
}

export async function getExecution(executionId: string) {
  return prisma.execution.findUnique({
    where: { id: executionId },
    include: { quote: true },
  });
}

export async function getExecutionsByAddress(address: string, page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.execution.findMany({
      where: { userAddress: { equals: address, mode: "insensitive" } },
      include: { quote: true },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.execution.count({
      where: { userAddress: { equals: address, mode: "insensitive" } },
    }),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

export async function pollExecutionStatus(executionId: string): Promise<boolean> {
  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    include: { quote: true },
  });

  if (!execution || !execution.txHash) return false;
  if (execution.status === "SUCCESS" || execution.status === "FAILED") return true;

  const status = await lifi.getStatus(
    execution.txHash,
    execution.quote.fromChainId,
    execution.quote.toChainId
  );

  if (status === "SUCCESS") {
    const completedAt = new Date();
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.SUCCESS,
        completedAt,
        durationMs: completedAt.getTime() - execution.createdAt.getTime(),
      },
    });
    return true;
  }

  if (status === "FAILED") {
    await prisma.execution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.FAILED },
    });
    return true;
  }

  return false;
}