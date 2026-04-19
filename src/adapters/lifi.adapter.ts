/**
 * LI.FI Adapter — v0.3 (Reliable /buildTx only)
 *
 * - Uses /buildTx exclusively (no fallback).
 * - Logs full request/response on error.
 * - Throws if /buildTx fails.
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
   * Build transaction for a specific step using LI.FI's /buildTx endpoint.
   * Throws if it fails – no fallback.
   */
  async buildStepTransaction(
    route: Record<string, unknown>,
    stepIndex: number,
    fromAddress: string,
    toAddress: string
  ): Promise<LifiTransactionResult> {
    const payload = {
      route,
      fromAddress,
      toAddress,
      step: stepIndex,
      integrator: "swipass",
    };

    try {
      const response = await this.http.post("/buildTx", payload);
      const tx = response.data.transactionRequest;
      if (!tx) {
        throw new Error("No transactionRequest in /buildTx response");
      }

      logger.info({ stepIndex, to: tx.to, chainId: tx.chainId }, "/buildTx success");
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
      // Log the full request and response for debugging
      logger.error({
        stepIndex,
        error: err.message,
        responseStatus: err.response?.status,
        responseData: err.response?.data,
        requestPayload: { ...payload, route: "[[stored route object]]" }, // hide huge route
      }, "/buildTx failed");
      throw new Error(`LI.FI /buildTx failed for step ${stepIndex}: ${err.message}`);
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