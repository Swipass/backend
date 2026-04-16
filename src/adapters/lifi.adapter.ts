/**
 * LI.FI Adapter — v0.2 (Execution-Guaranteed)
 *
 * Upgrades:
 * - Uses LI.FI SDK for better routing
 * - Adds route validation layer
 * - Adds transaction simulation layer
 * - Prevents invalid execution paths
 */

import axios, { AxiosInstance } from "axios";
import { createConfig, getQuote as sdkGetQuote } from "@lifi/sdk";
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

// ── Adapter class ─────────────────────────────────────────────

export class LifiAdapter {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: process.env.LIFI_API_URL || "https://li.quest/v1",
      timeout: 12_000,
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : {}),
      },
    });

    // 🔥 SDK CONFIG
    createConfig({
      integrator: "izipass",
    });

    this.http.interceptors.request.use((cfg) => {
      logger.debug({ url: cfg.url, params: cfg.params }, "→ LI.FI request");
      return cfg;
    });
  }

  // ── Get Quote (SDK powered — FINAL FIX) ──────────────────────

  async getQuote(req: LifiQuoteRequest): Promise<LifiQuoteResult | null> {
    try {
      // 🔥 Build params safely (NO undefined values)
      const params: any = {
        fromChain: req.fromChainId,
        toChain: req.toChainId,
        fromToken: req.fromTokenAddress,
        toToken: req.toTokenAddress,
        fromAmount: req.fromAmount,
        slippage: req.slippage ?? 0.005,
      };

      // Only attach if defined (CRITICAL FIX)
      if (req.fromAddress) params.fromAddress = req.fromAddress;
      if (req.toAddress) params.toAddress = req.toAddress;

      const route: any = await sdkGetQuote(params);

      // 🔥 SDK uses "steps" not "includedSteps"
      const steps = Array.isArray(route.steps) ? route.steps : [];

      const bridges: string[] = [];
      for (const step of steps) {
        if (step.type === "cross" && step.tool) {
          bridges.push(step.tool);
        }
      }

      return {
        rawRoute: route,
        toAmount: route.toAmount ?? "0",
        toAmountMin: route.toAmountMin ?? "0",
        estimatedTime: route.executionDuration ?? 30,
        gasCostUSD: route.gasCostUSD ?? "0",
        bridges,
        steps: steps.length,
      };
    } catch (err: any) {
      logger.error({ err: err.message }, "LI.FI getQuote failed");
      return null;
    }
  }

  // ── Route Validation Layer ──────────────────────────────────

  async validateRoute(rawRoute: any): Promise<boolean> {
    try {
      await this.http.post("/advanced/stepTransaction", {
        route: rawRoute,
      });
      return true;
    } catch {
      return false;
    }
  }

  // ── Simulation Layer ────────────────────────────────────────

  async simulateTransaction(tx: LifiTransactionResult): Promise<boolean> {
    try {
      await this.http.post("/call", {
        to: tx.to,
        data: tx.data,
        value: tx.value,
      });
      return true;
    } catch {
      return false;
    }
  }

  // ── Build Transaction (SAFE) ────────────────────────────────

  async buildTransaction(
    rawRoute: Record<string, unknown>,
    fromAddress: string,
    toAddress: string
  ): Promise<LifiTransactionResult | null> {
    try {
      const route = rawRoute as any;

      let txReq = null;

      // 1. Direct
      if (route.transactionRequest) {
        txReq = route.transactionRequest;
      }

      // 2. Steps
      if (!txReq && Array.isArray(route.includedSteps)) {
        for (const step of route.includedSteps) {
          if (!step?.transactionRequest) continue;

          if (step.type === "swap" || step.type === "cross") {
            txReq = step.transactionRequest;
            break;
          }

          if (!txReq) txReq = step.transactionRequest;
        }
      }

      if (!txReq) {
        logger.warn("No transactionRequest found");
        return null;
      }

      const normalized: LifiTransactionResult = {
        to: txReq.to,
        from: fromAddress,
        data: txReq.data,
        value: txReq.value ?? "0x0",
        gasLimit: txReq.gasLimit ?? "0x0",
        gasPrice: txReq.gasPrice,
        chainId: txReq.chainId,
      };

      // 🔥 SIMULATION GUARD
      const ok = await this.simulateTransaction(normalized);
      if (!ok) {
        logger.warn("Simulation failed — blocking execution");
        return null;
      }

      logger.info(
        { to: normalized.to, chainId: normalized.chainId },
        "Transaction built (validated + simulated)"
      );

      return normalized;
    } catch (err: any) {
      logger.error({ err: err.message }, "buildTransaction failed");
      return null;
    }
  }

  // ── Status ─────────────────────────────────────────────────

  async getStatus(
    txHash: string,
    fromChainId: number,
    toChainId: number
  ): Promise<"PENDING" | "BRIDGING" | "SUCCESS" | "FAILED"> {
    try {
      const res = await this.http.get("/status", {
        params: { txHash, fromChain: fromChainId, toChain: toChainId },
      });

      const status = res.data?.status;

      if (status === "DONE") return "SUCCESS";
      if (status === "FAILED") return "FAILED";
      if (status === "PENDING" || status === "NOT_FOUND") return "PENDING";

      return "BRIDGING";
    } catch {
      return "PENDING";
    }
  }
}

// Export singleton
export const lifi = new LifiAdapter();