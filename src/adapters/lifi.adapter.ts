/**
 * LI.FI Adapter — v0.2 (Multi‑step support with /buildTx)
 *
 * Changes:
 * - Uses /buildTx endpoint to get fresh, correct transaction for each step.
 * - getStatus now works for both approvals and bridges.
 * - Added buildStepTransaction for individual steps.
 */

import axios, { AxiosInstance } from "axios";
import { logger } from "../utils/logger";
import { SUPPORTED_CHAINS } from "../config/chains";

// ── Types ────────────────────────────────────────────────────

export interface LifiQuoteRequest {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmount: string;
  fromAddress?: string;
  toAddress?: string;
  slippage?: number;
}

export interface LifiQuoteResult {
  rawRoute: Record<string, unknown>;
  toAmount: string;
  toAmountMin: string;
  estimatedTime: number;
  gasCostUSD: string;
  bridges: string[];
  steps: number;
}

export interface LifiTransactionResult {
  to: string;
  from: string;
  data: string;
  value: string;
  gasLimit: string;
  gasPrice?: string;
  chainId: number;
}

// ── Helpers ───────────────────────────────────────────────────

function chainSlugToId(slug: string): number | null {
  return SUPPORTED_CHAINS.find((c) => c.id === slug)?.lifiId ?? null;
}

// ── Adapter class ─────────────────────────────────────────────

export class LifiAdapter {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: process.env.LIFI_API_URL || "https://li.quest/v1",
      timeout: 15_000,
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : {}),
      },
    });

    this.http.interceptors.request.use((cfg) => {
      logger.debug({ url: cfg.url, params: cfg.params }, "→ LI.FI request");
      return cfg;
    });
  }

  async getQuote(req: LifiQuoteRequest): Promise<LifiQuoteResult | null> {
    try {
      const res = await this.http.get("/quote", {
        params: {
          fromChain: req.fromChainId,
          toChain: req.toChainId,
          fromToken: req.fromTokenAddress,
          toToken: req.toTokenAddress,
          fromAmount: req.fromAmount,
          fromAddress: req.fromAddress,
          toAddress: req.toAddress,
          slippage: req.slippage ?? 0.005,
          integrator: "swipass",
          order: "CHEAPEST",
        },
      });

      const data = res.data;

      const bridges: string[] = [];
      for (const step of data.includedSteps ?? []) {
        if (step.type === "cross" && step.tool) {
          bridges.push(step.tool as string);
        }
      }

      return {
        rawRoute: data,
        toAmount: data.estimate?.toAmount ?? "0",
        toAmountMin: data.estimate?.toAmountMin ?? "0",
        estimatedTime: data.estimate?.executionDuration ?? 30,
        gasCostUSD: data.estimate?.gasCosts?.[0]?.amountUSD ?? "0",
        bridges,
        steps: (data.includedSteps ?? []).length,
      };
    } catch (err: unknown) {
      const e = err as { response?: { status: number; data: unknown }; message: string };
      if (e.response?.status === 404 || e.response?.status === 422) {
        logger.info({ req, data: e.response?.data }, "LI.FI: no route available");
        return null;
      }
      logger.error({ err: e.message, req }, "LI.FI getQuote failed");
      return null;
    }
  }

  /**
   * Build transaction for a specific step using LI.FI's /buildTx endpoint.
   * This ensures we get the exact, fresh transaction for the current step.
   */
  async buildStepTransaction(
    route: Record<string, unknown>,
    stepIndex: number,
    fromAddress: string,
    toAddress: string
  ): Promise<LifiTransactionResult | null> {
    try {
      const response = await this.http.post("/buildTx", {
        route,
        fromAddress,
        toAddress,
        step: stepIndex,    // LI.FI allows specifying which step to build
        integrator: "swipass",
      });

      const tx = response.data.transactionRequest;
      if (!tx) return null;

      return {
        to: tx.to,
        from: fromAddress,
        data: tx.data,
        value: tx.value ?? "0x0",
        gasLimit: tx.gasLimit ?? "0x0",
        gasPrice: tx.gasPrice,
        chainId: tx.chainId,
      };
    } catch (err: any) {
      logger.error({ err: err.message, stepIndex }, "buildStepTransaction failed");
      return null;
    }
  }

  /**
   * Check status of a specific step's transaction.
   * For approvals, we just need to know if it's mined (success).
   * For swaps/bridges, LI.FI returns DONE/FAILED.
   */
  async getStepStatus(
    txHash: string,
    chainId: number,
    stepType: string
  ): Promise<"PENDING" | "CONFIRMED" | "SUCCESS" | "FAILED"> {
    try {
      // For approvals, LI.FI's /status also works if we provide the same chain for both.
      const res = await this.http.get("/status", {
        params: { txHash, fromChain: chainId, toChain: chainId },
      });
      const status = res.data?.status;
      if (status === "DONE") return stepType === "approval" ? "CONFIRMED" : "SUCCESS";
      if (status === "FAILED") return "FAILED";
      return "PENDING";
    } catch (err) {
      // If LI.FI doesn't recognize it, assume still pending
      return "PENDING";
    }
  }
}

// Export singleton
export const lifi = new LifiAdapter();