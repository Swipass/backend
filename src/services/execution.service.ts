/**
 * Execution Service — handles the full bridge execution lifecycle.
 *
 * Flow:
 *   1. Frontend calls POST /execute → we build the tx and return it
 *   2. User signs in their wallet and broadcasts
 *   3. Frontend calls POST /execute/:id/tx-hash with the broadcast hash
 *   4. Background worker polls LI.FI until DONE or FAILED
 */
import { ExecutionStatus } from "@prisma/client";
import { prisma } from "../lib/database";
import { lifi } from "../adapters/lifi.adapter";
import { logger } from "../utils/logger";

export interface ExecuteRequest {
  quoteId: string;
  userAddress: string;
  recipientAddress: string; // may equal userAddress
}

export interface ExecuteResponse {
  executionId: string;
  trackingUrl: string;
  /** The unsigned transaction the user's wallet must sign & broadcast */
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

/**
 * Build the transaction for the user to sign.
 * Prevents the same quote from being used more than once.
 */
export async function prepareExecution(req: ExecuteRequest): Promise<ExecuteResponse> {
  // ── Load and validate quote ─────────────────────────────────
  const quote = await prisma.quote.findUnique({ 
    where: { id: req.quoteId } 
  });

  if (!quote) {
    throw new Error("Quote not found. Please request a new quote.");
  }
  if (quote.status === "EXECUTED") {
    throw new Error("This quote has already been used. Please request a new quote.");
  }
  if (quote.expiresAt < new Date()) {
    throw new Error("Quote expired. Please request a fresh quote.");
  }

  // ── NEW: Check if this quote is already being processed by another execution
  const existingExecution = await prisma.execution.findFirst({
    where: { 
      quoteId: quote.id,
      status: { in: ["PENDING", "BRIDGING"] }
    }
  });

  if (existingExecution) {
    throw new Error("This quote is already being processed. Please request a new quote.");
  }

  // ── Build transaction ─────────────────────────────
  const txReq = await lifi.buildTransaction(
    quote.routeData as Record<string, unknown>,
    req.userAddress,
    req.recipientAddress
  );

  if (!txReq) {
    throw new Error("Unable to build transaction. The route may no longer be available — please get a new quote.");
  }

  // ── Create execution (still do NOT mark quote EXECUTED yet)
  const execution = await prisma.execution.create({
    data: {
      quoteId: quote.id,
      userAddress: req.userAddress,
      recipientAddress: req.recipientAddress,
      status: ExecutionStatus.PENDING,
    },
  });

  logger.info({ 
    executionId: execution.id, 
    quoteId: quote.id 
  }, "Execution prepared");

  const appUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  return {
    executionId: execution.id,
    trackingUrl: `${appUrl}/bridge/status/${execution.id}`,
    transactionRequest: txReq,
  };
}

/**
 * Called by the frontend after the user has signed and broadcast the tx.
 * Stores the hash and queues status polling.
 */
export async function submitTxHash(executionId: string, txHash: string): Promise<void> {
  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    include: { quote: true }
  });

  if (!execution) throw new Error("Execution not found");
  if (execution.txHash) return; // already submitted

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

  logger.info({ executionId, txHash, quoteId: execution.quoteId }, "Tx submitted successfully");
}

/** Get full execution status for the status page */
export async function getExecution(executionId: string) {
  return prisma.execution.findUnique({
    where: { id: executionId },
    include: { quote: true },
  });
}

/** Paginated execution history for a wallet address */
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

/**
 * Internal: poll LI.FI for a single execution and update its status.
 * Called by the background polling worker.
 */
export async function pollExecutionStatus(executionId: string): Promise<boolean> {
  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    include: { quote: true },
  });

  if (!execution || !execution.txHash) return false;
  if (execution.status === "SUCCESS" || execution.status === "FAILED") return true; // already done

  const status = await lifi.getStatus(
    execution.txHash,
    execution.quote.fromChainId,
    execution.quote.toChainId
  );

  logger.debug({ executionId, txHash: execution.txHash, status }, "Polled execution");

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
    logger.info({ executionId }, "✓ Execution completed successfully");
    return true;
  }

  if (status === "FAILED") {
    await prisma.execution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.FAILED, errorMessage: "Bridge transaction failed" },
    });
    logger.warn({ executionId }, "✗ Execution failed");
    return true;
  }

  return false;
}
