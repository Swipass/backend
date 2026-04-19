/**
 * LI.FI Adapter — v0.3 (Reliable extraction, no /buildTx)
 *
 * Changes from previous version:
 * - Removed broken /buildTx POST (LI.FI no longer supports it reliably in 2026)
 * - Now extracts transactionRequest directly from the stored quote (official pattern)
 * - Robust fallback for multi-step routes
 * - Better logging for debugging
 * - Throws clear errors instead of silent failures
 */

import axios, { AxiosInstance } from "axios";
import { logger } from "../utils/logger";
import { SUPPORTED_CHAINS } from "../config/chains";

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
        if (step.type === "cross" && step.tool) bridges.push(step.tool as string);
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
      logger.error({ err: err.message, req }, "LI.FI getQuote failed");
      return null;
    }
  }

  /**
   * Extract transactionRequest for a specific step from the stored route.
   * This is the current recommended way (no /buildTx needed).
   */
  async buildStepTransaction(
    route: Record<string, unknown>,
    stepIndex: number,
    fromAddress: string,
    toAddress: string
  ): Promise<LifiTransactionResult> {
    try {
      const routeData = route as any;
      let txReq = routeData.transactionRequest;

      // Multi-step routes store tx per step
      if (!txReq && routeData.includedSteps?.length > stepIndex) {
        txReq = routeData.includedSteps[stepIndex]?.transactionRequest;
      }

      // Final fallback (rare)
      if (!txReq) {
        logger.warn({ stepIndex, hasIncludedSteps: !!routeData.includedSteps }, "No transactionRequest found in route");
        throw new Error("No transactionRequest available in LI.FI route for this step");
      }

      logger.info({
        stepIndex,
        to: txReq.to,
        chainId: txReq.chainId,
        hasData: !!txReq.data,
      }, "Transaction request extracted successfully");

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
      logger.error({
        stepIndex,
        error: err.message,
        routeHasTransactionRequest: !!(route as any).transactionRequest,
        includedStepsCount: (route as any).includedSteps?.length ?? 0,
      }, "Failed to extract transactionRequest");
      throw new Error(`Failed to get tx for step ${stepIndex}: ${err.message}`);
    }
  }

  async getStepStatus(
    txHash: string,
    chainId: number,
    stepType: string
  ): Promise<"PENDING" | "CONFIRMED" | "SUCCESS" | "FAILED"> {
    try {
      const res = await this.http.get("/status", {
        params: { txHash, fromChain: chainId, toChain: chainId },
      });
      const status = res.data?.status as string;

      if (status === "DONE") {
        return stepType === "approval" ? "CONFIRMED" : "SUCCESS";
      }
      if (status === "FAILED") return "FAILED";
      return "PENDING";
    } catch {
      return "PENDING";
    }
  }
}

export const lifi = new LifiAdapter();