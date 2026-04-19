/**
 * Status Poller — polls LI.FI every 5 seconds for in‑flight step transactions.
 *
 * Uses a simple DB query + cron rather than BullMQ to reduce dependencies.
 * For high volume (1000+ concurrent bridges) switch to BullMQ.
 */
import cron from "node-cron";
import { prisma } from "../lib/database";
import { pollStepStatus, advanceToNextStep } from "../services/execution.service";
import { logger } from "../utils/logger";

let isRunning = false;

async function pollAllSteps(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    // Find all steps that are SUBMITTED and not too old
    const submittedSteps = await prisma.step.findMany({
      where: {
        status: "SUBMITTED",
        createdAt: { gte: new Date(Date.now() - 30 * 60_000) },
      },
      select: { id: true },
    });

    for (const step of submittedSteps) {
      await pollStepStatus(step.id);
    }

    // Also check for any executions that might have stuck steps (e.g., confirmed but not advanced)
    const executions = await prisma.execution.findMany({
      where: {
        status: "BRIDGING",
        currentStepIndex: { not: undefined },
      },
      include: { steps: true },
    });

    for (const exec of executions) {
      const currentStep = exec.steps.find(s => s.stepIndex === exec.currentStepIndex);
      if (currentStep && currentStep.status === "CONFIRMED") {
        await advanceToNextStep(exec.id);
      }
    }
  } catch (err) {
    logger.error({ err }, "Poller error");
  } finally {
    isRunning = false;
  }
}

/** Start the polling cron — runs every 5 seconds */
export function startStatusPoller(): void {
  cron.schedule("*/5 * * * * *", pollAllSteps);
  logger.info("✓ Step poller started (every 5s)");
}