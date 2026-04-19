/**
 * Execution Service — handles multi‑step bridge execution lifecycle (v0.3 Fixed + Improved)
 *
 * Improvements in this version:
 * - Better logging for failed steps (includes full LI.FI status)
 * - Detects approval steps and gives clearer error messages
 * - More robust polling
 */

import { ExecutionStatus, StepStatus } from "@prisma/client";
import { prisma } from "../lib/database";
import { lifi, LifiTransactionResult } from "../adapters/lifi.adapter";
import { logger } from "../utils/logger";

export interface ExecuteRequest {
  quoteId: string;
  userAddress: string;
  recipientAddress: string;
}

export interface ExecuteResponse {
  executionId: string;
  trackingUrl: string;
  stepIndex: number;
  stepType: string;
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

export async function prepareExecution(req: ExecuteRequest): Promise<ExecuteResponse> {
  const quote = await prisma.quote.findUnique({ where: { id: req.quoteId } });
  if (!quote) throw new Error("Quote not found");
  if (quote.status === "EXECUTED") throw new Error("Quote already used");
  if (quote.expiresAt < new Date()) throw new Error("Quote expired");

  let execution = await prisma.execution.findFirst({
    where: { quoteId: quote.id },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });

  if (!execution) {
    const routeData = quote.routeData as any;
    const stepsRaw = routeData.includedSteps ?? [];

    if (stepsRaw.length === 0) {
      throw new Error("No steps found in LI.FI route");
    }

    const newExecution = await prisma.$transaction(async (tx) => {
      const exec = await tx.execution.create({
        data: {
          quoteId: quote.id,
          userAddress: req.userAddress,
          recipientAddress: req.recipientAddress,
          status: ExecutionStatus.PENDING,
          currentStepIndex: 0,
        },
      });

      for (let i = 0; i < stepsRaw.length; i++) {
        const step = stepsRaw[i];

        const txReq = await lifi.buildStepTransaction(
          routeData,
          i,
          req.userAddress,
          req.recipientAddress
        );

        const txReqPlain = {
          to: txReq.to,
          from: txReq.from,
          data: txReq.data,
          value: txReq.value,
          gasLimit: txReq.gasLimit,
          gasPrice: txReq.gasPrice,
          chainId: txReq.chainId,
        };

        await tx.step.create({
          data: {
            executionId: exec.id,
            stepIndex: i,
            type: step.type || "unknown",
            status: StepStatus.PENDING,
            transactionRequest: txReqPlain as any,
          },
        });
      }
      return exec;
    });

    execution = await prisma.execution.findUnique({
      where: { id: newExecution.id },
      include: { steps: { orderBy: { stepIndex: "asc" } } },
    });

    if (!execution) throw new Error("Failed to retrieve created execution");
  }

  const currentStep = execution.steps.find(s => s.stepIndex === execution!.currentStepIndex);
  if (!currentStep) throw new Error("No current step found");

  if (currentStep.status === StepStatus.CONFIRMED) {
    await advanceToNextStep(execution.id);
    return prepareExecution(req);
  }

  if (currentStep.status === StepStatus.COMPLETED) {
    throw new Error("Execution already completed");
  }

  if (currentStep.status === StepStatus.SUBMITTED) {
    throw new Error("Step already submitted, waiting for confirmation");
  }

  const appUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  return {
    executionId: execution.id,
    trackingUrl: `${appUrl}/bridge/status/${execution.id}`,
    stepIndex: currentStep.stepIndex,
    stepType: currentStep.type,
    transactionRequest: currentStep.transactionRequest as any,
  };
}

export async function submitStepTxHash(executionId: string, txHash: string): Promise<void> {
  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    include: { steps: true },
  });
  if (!execution) throw new Error("Execution not found");

  const currentStep = execution.steps.find(s => s.stepIndex === execution.currentStepIndex);
  if (!currentStep) throw new Error("No current step");

  if (currentStep.status !== StepStatus.PENDING) {
    throw new Error("Step already submitted or completed");
  }

  await prisma.step.update({
    where: { id: currentStep.id },
    data: { txHash, status: StepStatus.SUBMITTED },
  });

  if (execution.status === ExecutionStatus.PENDING) {
    await prisma.execution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.BRIDGING },
    });
  }

  logger.info({ executionId, stepIndex: currentStep.stepIndex, txHash }, "Step tx submitted successfully");
}

export async function advanceToNextStep(executionId: string): Promise<boolean> {
  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });
  if (!execution) return false;

  const currentStep = execution.steps.find(s => s.stepIndex === execution.currentStepIndex);
  if (!currentStep) return false;

  if (currentStep.status !== StepStatus.CONFIRMED && currentStep.status !== StepStatus.COMPLETED) {
    return false;
  }

  if (currentStep.status === StepStatus.CONFIRMED) {
    await prisma.step.update({
      where: { id: currentStep.id },
      data: { status: StepStatus.COMPLETED, completedAt: new Date() },
    });
  }

  const nextIndex = execution.currentStepIndex + 1;

  if (nextIndex >= execution.steps.length) {
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.SUCCESS,
        completedAt: new Date(),
        durationMs: new Date().getTime() - execution.createdAt.getTime(),
      },
    });
    logger.info({ executionId }, "Execution completed successfully");
    return true;
  }

  await prisma.execution.update({
    where: { id: executionId },
    data: { currentStepIndex: nextIndex },
  });

  logger.info({ executionId, nextStepIndex: nextIndex }, "Advanced to next step");
  return true;
}

/**
 * Improved pollStepStatus with better logging
 */
export async function pollStepStatus(stepId: string): Promise<boolean> {
  const step = await prisma.step.findUnique({
    where: { id: stepId },
    include: { execution: true },
  });
  if (!step || !step.txHash) return false;

  if (step.status !== StepStatus.SUBMITTED) return true;

  const execution = step.execution;
  const txReq = step.transactionRequest as any;
  const chainId = txReq.chainId;

  try {
    const status = await lifi.getStepStatus(step.txHash, chainId, step.type);

    logger.debug({ 
      stepId, 
      txHash: step.txHash, 
      stepType: step.type, 
      status 
    }, "Polled step status");

    if (status === "CONFIRMED" || status === "SUCCESS") {
      await prisma.step.update({
        where: { id: step.id },
        data: { status: StepStatus.CONFIRMED },
      });
      await advanceToNextStep(execution.id);
      return true;
    } 
    else if (status === "FAILED") {
      const isApproval = step.type.toLowerCase().includes("approval") || step.stepIndex === 0;

      await prisma.step.update({
        where: { id: step.id },
        data: { 
          status: StepStatus.FAILED, 
          errorMessage: isApproval 
            ? "Approval transaction failed. Please approve USDT to LI.FI Diamond contract." 
            : "Transaction failed on chain" 
        },
      });

      await prisma.execution.update({
        where: { id: execution.id },
        data: { 
          status: ExecutionStatus.FAILED, 
          errorMessage: `Step ${step.stepIndex} failed (${step.type})` 
        },
      });

      logger.warn({ 
        stepId, 
        txHash: step.txHash, 
        stepType: step.type,
        isApproval 
      }, "Step failed on chain");
      return true;
    }
  } catch (err) {
    logger.error({ stepId, err }, "Error polling step status");
  }

  return false;
}

export async function getExecution(executionId: string) {
  return prisma.execution.findUnique({
    where: { id: executionId },
    include: { quote: true, steps: true },
  });
}

export async function getExecutionsByAddress(address: string, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    prisma.execution.findMany({
      where: { userAddress: { equals: address, mode: "insensitive" } },
      include: { quote: true, steps: true },
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