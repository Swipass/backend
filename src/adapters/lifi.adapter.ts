/**
 * LI.FI Adapter — v0.2 (Multi‑step support with /buildTx + fallback)
 *
 * Changes:
 * - Uses /buildTx endpoint to get fresh transaction for each step.
 * - Falls back to extracting transaction from stored route if /buildTx fails.
 * - Better error logging.
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
        if (step.type === "cross" && step.tool) bridges.push(step.tool);
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
    } catch (err: any) {
      if (err.response?.status === 404 || err.response?.status === 422) {
        logger.info({ req }, "LI.FI: no route available");
        return null;
      }
      logger.error({ err: err.message }, "LI.FI getQuote failed");
      return null;
    }
  }

  /**
   * Build transaction for a specific step.
   * Tries /buildTx first; if that fails (404), falls back to extracting from stored route.
   */
  async buildStepTransaction(
    route: Record<string, unknown>,
    stepIndex: number,
    fromAddress: string,
    toAddress: string
  ): Promise<LifiTransactionResult | null> {
    // Method 1: Try LI.FI's official /buildTx endpoint
    try {
      const response = await this.http.post("/buildTx", {
        route,
        fromAddress,
        toAddress,
        step: stepIndex,
        integrator: "swipass",
      });

      const tx = response.data.transactionRequest;
      if (tx) {
        logger.info({ stepIndex, to: tx.to }, "buildStepTransaction: using /buildTx");
        return {
          to: tx.to,
          from: fromAddress,
          data: tx.data,
          value: tx.value ?? "0x0",
          gasLimit: tx.gasLimit ?? "0x0",
          gasPrice: tx.gasPrice,
          chainId: tx.chainId,
        };
      }
    } catch (err: any) {
      if (err.response?.status === 404) {
        logger.warn({ stepIndex }, "/buildTx returned 404, falling back to route extraction");
      } else {
        logger.error({ err: err.message, stepIndex }, "buildStepTransaction /buildTx failed");
      }
      // Continue to fallback
    }

    // Method 2: Fallback – extract transaction from stored route
    try {
      const routeData = route as any;
      let txReq = null;

      // Single-step route might have top-level transactionRequest
      if (routeData.transactionRequest) {
        txReq = routeData.transactionRequest;
      }

      // Multi-step route: find the step by index
      if (!txReq && Array.isArray(routeData.includedSteps)) {
        const step = routeData.includedSteps[stepIndex];
        if (step?.transactionRequest) {
          txReq = step.transactionRequest;
        }
      }

      if (!txReq) {
        logger.error({ stepIndex, hasSteps: !!routeData.includedSteps }, "No transactionRequest found in fallback");
        return null;
      }

      logger.info({ stepIndex, to: txReq.to }, "buildStepTransaction: using fallback extraction");
      return {
        to: txReq.to,
        from: fromAddress,
        data: txReq.data,
        value: txReq.value ?? "0x0",
        gasLimit: txReq.gasLimit ?? "0x0",
        gasPrice: txReq.gasPrice,
        chainId: txReq.chainId,
      };
    } catch (err: any) {
      logger.error({ err: err.message, stepIndex }, "Fallback extraction failed");
      return null;
    }
  }

  /**
   * Check status of a specific step's transaction.
   */
  async getStepStatus(
    txHash: string,
    chainId: number,
    stepType: string
  ): Promise<"PENDING" | "CONFIRMED" | "SUCCESS" | "FAILED"> {
    try {
      const res = await this.http.get("/status", {
        params: { txHash, fromChain: chainId, toChain: chainId },
      });
      const status = res.data?.status;
      if (status === "DONE") return stepType === "approval" ? "CONFIRMED" : "SUCCESS";
      if (status === "FAILED") return "FAILED";
      return "PENDING";
    } catch {
      return "PENDING";
    }
  }
}

export const lifi = new LifiAdapter();