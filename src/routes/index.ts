/**
 * Route registrations — v0.2 (multi‑step support)
 *
 * Public routes  (no auth):
 *   GET  /health
 *   GET  /v1/chains
 *   POST /v1/quote
 *   POST /v1/execute
 *   POST /v1/execute/:id/submit-step
 *   GET  /v1/execute/:id/next
 *   GET  /v1/execute/:id
 *
 * Admin routes  (JWT required):
 *   POST /admin/auth/login
 *   GET  /admin/stats
 *   GET  /admin/executions
 *   GET  /admin/fees
 *   PUT  /admin/fees
 *   GET  /admin/bridges
 *   PUT  /admin/bridges/:name
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { SUPPORTED_CHAINS, SUPPORTED_TOKENS } from "../config/chains";
import { buildQuote } from "../services/quote.service";
import {
  prepareExecution,
  submitStepTxHash,
  getExecution,
  getExecutionsByAddress,
} from "../services/execution.service";
import {
  adminLogin,
  getDashboardStats,
  listExecutions,
  getFeeConfig,
  updateFeeConfig,
  getBridgeConfigs,
  updateBridgeConfig,
} from "../services/admin.service";
import { requireAdmin } from "../middleware/auth";
import { logger } from "../utils/logger";
import { prisma } from "../lib/database";

// ── Zod schemas ───────────────────────────────────────────────

const QuoteSchema = z.object({
  fromChain: z.string(),
  toChain: z.string(),
  fromToken: z.string(),
  toToken: z.string(),
  fromAmount: z.string().regex(/^\d+$/, "fromAmount must be a raw integer string (wei/lamports)"),
  fromAddress: z.string().optional(),
  recipientAddress: z.string().optional(),
  slippage: z.number().min(0).max(0.5).optional(),
});

const ExecuteSchema = z.object({
  quoteId: z.string(),
  userAddress: z.string(),
  recipientAddress: z.string().optional(),
});

const TxHashSchema = z.object({
  txHash: z.string().min(10),
});

const FeeSchema = z.object({
  feePct: z.number().min(0.0005).max(0.02).optional(),
  minFeePct: z.number().optional(),
  maxFeePct: z.number().optional(),
});

// Helper: wrap async handlers with consistent error format
function wrap(fn: (req: FastifyRequest, reply: FastifyReply) => Promise<any>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      return await fn(req, reply);
    } catch (err: any) {
      const message = err?.message || "Internal error";
      logger.warn({ err: message, path: req.url }, "Request error");

      const status =
        message.includes("not found") ? 404 :
        message.includes("expired") ? 422 :
        message.includes("already been used") ? 422 :
        400;

      return reply.status(status).send({ success: false, error: message });
    }
  };
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {

  // ── Health ─────────────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    version: "0.2.0",
    timestamp: new Date().toISOString(),
  }));

  // ── Chains + tokens (static config) ────────────────────────
  app.get("/v1/chains", async () => ({
    success: true,
    data: SUPPORTED_CHAINS,
  }));

  app.get("/v1/tokens/:chain", async (req: any, reply) => {
    const tokens = SUPPORTED_TOKENS[req.params.chain];
    if (!tokens) {
      return reply.status(404).send({ success: false, error: "Unknown chain" });
    }
    return { success: true, data: tokens };
  });

  // ── Quote ──────────────────────────────────────────────────
  app.post(
    "/v1/quote",
    wrap(async (req, reply) => {
      const body = QuoteSchema.parse(req.body);
      const quote = await buildQuote({
        ...body,
        recipientAddress: body.recipientAddress ?? body.fromAddress,
      });
      return reply.status(200).send({ success: true, data: quote });
    })
  );

  // ── Execute (create execution + first step) ─────────────────
  app.post(
    "/v1/execute",
    wrap(async (req, reply) => {
      const body = ExecuteSchema.parse(req.body);
      const result = await prepareExecution({
        quoteId: body.quoteId,
        userAddress: body.userAddress,
        recipientAddress: body.recipientAddress ?? body.userAddress,
      });
      return reply.status(201).send({ success: true, data: result });
    })
  );

  // ── Submit tx hash for the current step ────────────────────
  app.post(
    "/v1/execute/:id/submit-step",
    wrap(async (req, reply) => {
      const { txHash } = TxHashSchema.parse(req.body);
      await submitStepTxHash((req.params as any).id, txHash);
      return { success: true, message: "Step transaction recorded" };
    })
  );

  // ── Get the next pending transaction (or completion status) ─
  app.get(
    "/v1/execute/:id/next",
    wrap(async (req, reply) => {
      const executionId = (req.params as any).id;
      const execution = await prisma.execution.findUnique({
        where: { id: executionId },
        include: { steps: { orderBy: { stepIndex: "asc" } } },
      });
      if (!execution) return reply.status(404).send({ success: false, error: "Not found" });

      const currentStep = execution.steps.find(s => s.stepIndex === execution.currentStepIndex);
      if (!currentStep) {
        // Should not happen, but means all steps are done
        return reply.status(200).send({ success: true, data: { completed: true } });
      }

      if (currentStep.status === "PENDING") {
        // Return the transaction again (in case frontend needs to re‑sign)
        return reply.status(200).send({
          success: true,
          data: {
            stepIndex: currentStep.stepIndex,
            stepType: currentStep.type,
            transactionRequest: currentStep.transactionRequest,
          },
        });
      } else if (currentStep.status === "SUBMITTED" || currentStep.status === "CONFIRMED") {
        return reply.status(200).send({
          success: true,
          data: { waitingForConfirmation: true, stepIndex: currentStep.stepIndex },
        });
      } else {
        // Step is COMPLETED or FAILED – if completed, maybe all done
        const allCompleted = execution.steps.every(s => s.status === "COMPLETED");
        if (allCompleted || execution.status === "SUCCESS") {
          return reply.status(200).send({ success: true, data: { completed: true } });
        }
        return reply.status(200).send({ success: true, data: { completed: false, error: currentStep.errorMessage } });
      }
    })
  );

  // ── Get full execution status (for status page) ────────────
  app.get(
    "/v1/execute/:id",
    wrap(async (req, reply) => {
      const execution = await getExecution((req.params as any).id);
      if (!execution) {
        return reply.status(404).send({ success: false, error: "Execution not found" });
      }
      return { success: true, data: execution };
    })
  );

  // ── Execution history for a wallet ─────────────────────────
  app.get(
    "/v1/history/:address",
    wrap(async (req, reply) => {
      const query = req.query as any;
      const params = req.params as any;

      const page = parseInt(query.page ?? "1");
      const limit = Math.min(parseInt(query.limit ?? "20"), 50);

      const result = await getExecutionsByAddress(params.address, page, limit);
      return { success: true, ...result };
    })
  );

  // ══════════════════════════════════════════════════════════
  // ADMIN ROUTES
  // ══════════════════════════════════════════════════════════

  // Login — no auth required (returns JWT)
  app.post(
    "/admin/auth/login",
    wrap(async (req, reply) => {
      const { email, password } = req.body as { email: string; password: string };
      const admin = await adminLogin(email, password);
      if (!admin) {
        return reply.status(401).send({ success: false, error: "Invalid credentials" });
      }
      const token = (app as any).jwt.sign(
        { id: admin.id, email: admin.email, role: "admin" },
        { expiresIn: "24h" }
      );
      return { success: true, data: { token, admin } };
    })
  );

  // All routes below require admin JWT
  app.register(async (adminApp) => {
    adminApp.addHook("preHandler", requireAdmin);

    adminApp.get("/admin/stats", wrap(async (req, reply) => {
      const stats = await getDashboardStats();
      return { success: true, data: stats };
    }));

    adminApp.get("/admin/executions", wrap(async (req, reply) => {
      const query = req.query as any;

      const page = parseInt(query.page ?? "1");
      const limit = Math.min(parseInt(query.limit ?? "20"), 100);

      const result = await listExecutions(page, limit, query.status);
      return { success: true, ...result };
    }));

    adminApp.get("/admin/fees", wrap(async (req, reply) => {
      return { success: true, data: await getFeeConfig() };
    }));

    adminApp.put("/admin/fees", wrap(async (req, reply) => {
      const body = FeeSchema.parse(req.body);
      const updated = await updateFeeConfig(body);
      return { success: true, data: updated };
    }));

    adminApp.get("/admin/bridges", wrap(async (req, reply) => {
      return { success: true, data: await getBridgeConfigs() };
    }));

    adminApp.put("/admin/bridges/:name", wrap(async (req, reply) => {
      const { isEnabled } = req.body as { isEnabled: boolean };
      const params = req.params as any;

      const updated = await updateBridgeConfig(params.name, isEnabled);
      return { success: true, data: updated };
    }));
  });
}