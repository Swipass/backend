/**
 * Status Poller — polls LI.FI every 10 seconds for in-flight executions.
 *
 * Uses a simple DB query + cron rather than BullMQ to reduce dependencies.
 * For high volume (1000+ concurrent bridges) switch to BullMQ.
 */
import cron from "node-cron";
import { prisma } from "../lib/database";
import { pollExecutionStatus } from "../services/execution.service";
import { logger } from "../utils/logger";

let isRunning = false;

async function pollAll(): Promise<void> {
  if (isRunning) return; // prevent overlap
  isRunning = true;

  try {
    // Find all executions that are in-flight
    const pending = await prisma.execution.findMany({
      where: {
        status: { in: ["BRIDGING"] },
        txHash: { not: null },
        // Don't poll executions older than 30 minutes — they've likely failed
        createdAt: { gte: new Date(Date.now() - 30 * 60_000) },
      },
      select: { id: true },
    });

    if (pending.length === 0) return;

    logger.debug({ count: pending.length }, "Polling in-flight executions");

    // Poll each one — we cap concurrency to avoid hammering LI.FI
    const BATCH = 5;
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      await Promise.allSettled(batch.map((e) => pollExecutionStatus(e.id)));
    }
  } catch (err) {
    logger.error({ err }, "Status poller error");
  } finally {
    isRunning = false;
  }
}

/** Start the polling cron — runs every 10 seconds */
export function startStatusPoller(): void {
  // Run every 10 seconds
  cron.schedule("*/10 * * * * *", pollAll);
  logger.info("✓ Status poller started (every 10s)");
}
