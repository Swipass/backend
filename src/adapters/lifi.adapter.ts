/**
 * LI.FI Adapter — v0.1 (Updated for current LI.FI API)
 *
 * Changes:
 * - buildTransaction now extracts transactionRequest directly from the stored quote (recommended way)
 * - Removed deprecated /advanced/routes call
 * - Better error handling and logging
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
      timeout: 12_000,
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
          integrator: "izipass",
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
   * FIXED: Build unsigned transaction from stored rawRoute (quote)
   * This is the current recommended approach by LI.FI.
   */
  async buildTransaction(
    rawRoute: Record<string, unknown>,
    fromAddress: string,
    toAddress: string
  ): Promise<LifiTransactionResult | null> {
    try {
      const route = rawRoute as any;

      let txReq = null;

      // 1. Direct transactionRequest (single-step routes)
      if (route.transactionRequest) {
        txReq = route.transactionRequest;
      }

      // 2. Multi-step routes
      if (!txReq && Array.isArray(route.includedSteps)) {
        for (const step of route.includedSteps) {
          // Skip non-executable steps
          if (!step?.transactionRequest) continue;

          // Prefer real execution steps
          if (step.type === "swap" || step.type === "cross") {
            txReq = step.transactionRequest;
            break;
          }

          // Fallback to any available tx
          if (!txReq) {
            txReq = step.transactionRequest;
          }
        }
      }

      // 3. Final guard
      if (!txReq) {
        logger.warn(
          {
            hasTopLevel: !!route.transactionRequest,
            steps: route.includedSteps?.length ?? 0,
          },
          "LI.FI: no executable transactionRequest found"
        );
        return null;
      }

      // 4. Normalize values (VERY IMPORTANT)
      const normalized: LifiTransactionResult = {
        to: txReq.to,
        from: fromAddress,
        data: txReq.data,
        value: txReq.value ?? "0x0",
        gasLimit: txReq.gasLimit ?? "0x0",
        gasPrice: txReq.gasPrice,
        chainId: txReq.chainId,
      };

      logger.info(
        {
          to: normalized.to,
          chainId: normalized.chainId,
          hasData: !!normalized.data,
        },
        "Transaction request built from route"
      );

      return normalized;
    } catch (err: unknown) {
      const e = err as { message: string };
      logger.error({ err: e.message }, "LI.FI buildTransaction failed");
      return null;
    }
  }

  async getStatus(
    txHash: string,
    fromChainId: number,
    toChainId: number
  ): Promise<"PENDING" | "BRIDGING" | "SUCCESS" | "FAILED"> {
    try {
      const res = await this.http.get("/status", {
        params: { txHash, fromChain: fromChainId, toChain: toChainId },
      });

      const status = res.data?.status as string;

      switch (status) {
        case "DONE":
          return "SUCCESS";
        case "FAILED":
          return "FAILED";
        case "PENDING":
        case "NOT_FOUND":
          return "PENDING";
        default:
          return "BRIDGING";
      }
    } catch {
      return "PENDING";
    }
  }
}

// Export singleton
export const lifi = new LifiAdapter();