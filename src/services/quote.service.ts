/**
 * Quote Service — builds and caches LI.FI quotes with Izipass fee applied.
 */
import { nanoid } from "nanoid";
import { prisma } from "../lib/database";
import { cacheGet, cacheSet } from "../lib/redis";
import { lifi } from "../adapters/lifi.adapter";
import { getChain, getTokensForChain } from "../config/chains";
import { logger } from "../utils/logger";

export interface QuoteRequest {
  fromChain: string;   // slug e.g. "ethereum"
  toChain: string;
  fromToken: string;   // symbol e.g. "USDC"
  toToken: string;
  fromAmount: string;  // raw amount in smallest unit
  fromAddress?: string;
  recipientAddress?: string;
  slippage?: number;
}

export interface QuoteResponse {
  id: string;
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  fromTokenLogoUrl: string;
  toTokenLogoUrl: string;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  fee: {
    percentage: number;
    amount: string;
    token: string;
  };
  estimatedTime: number;
  gasCostUSD: string;
  bridges: string[];
  expiresAt: string;
}

/** Get current active fee config from DB */
async function getFeePct(): Promise<number> {
  const cfg = await prisma.feeConfig.findFirst({ where: { isActive: true } });
  return cfg?.feePct ?? 0.003;
}

/**
 * Build a quote: fetch from LI.FI, subtract Izipass fee, store in DB.
 * Quotes are cached for 20 seconds (they expire at 30s).
 */
export async function buildQuote(req: QuoteRequest): Promise<QuoteResponse> {
  // ── Validate chain slugs ────────────────────────────────────
  const fromChainCfg = getChain(req.fromChain);
  const toChainCfg = getChain(req.toChain);

  if (!fromChainCfg || !toChainCfg) {
    throw new Error(
      `Unsupported chain. Supported: ${["ethereum","arbitrum","optimism","base","polygon","avalanche","bnb"].join(", ")}`
    );
  }

  // ── Resolve token contract addresses ───────────────────────
  const fromTokens = getTokensForChain(req.fromChain);
  const toTokens = getTokensForChain(req.toChain);

  const fromTokenCfg = fromTokens.find(
    (t) => t.symbol.toUpperCase() === req.fromToken.toUpperCase()
  );
  const toTokenCfg = toTokens.find(
    (t) => t.symbol.toUpperCase() === req.toToken.toUpperCase()
  );

  if (!fromTokenCfg) {
    throw new Error(`Token ${req.fromToken} not supported on ${req.fromChain}`);
  }
  if (!toTokenCfg) {
    throw new Error(`Token ${req.toToken} not supported on ${req.toChain}`);
  }

  // ── Check cache ─────────────────────────────────────────────
  const cacheKey = `quote:${req.fromChain}:${req.toChain}:${req.fromToken}:${req.toToken}:${req.fromAmount}`;
  const cached = await cacheGet<QuoteResponse>(cacheKey);
  if (cached && new Date(cached.expiresAt) > new Date()) {
    logger.debug({ cacheKey }, "Quote cache hit");
    return cached;
  }

  // ── Fetch from LI.FI ────────────────────────────────────────
  const lifiQuote = await lifi.getQuote({
    fromChainId: fromChainCfg.lifiId,
    toChainId: toChainCfg.lifiId,
    fromTokenAddress: fromTokenCfg.address,
    toTokenAddress: toTokenCfg.address,
    fromAmount: req.fromAmount,
    fromAddress: req.fromAddress,
    toAddress: req.recipientAddress,
    slippage: req.slippage ?? 0.005,
  });

  if (!lifiQuote) {
    throw new Error(
      "No route available for this pair right now. " +
        "Try a different amount or token — liquidity can be temporarily thin."
    );
  }

  // ── Apply Izipass fee ────────────────────────────────────────
  const feePct = await getFeePct();
  const toAmountBig = BigInt(lifiQuote.toAmount);
  const feeAmount = (toAmountBig * BigInt(Math.round(feePct * 10_000))) / BigInt(10_000);
  const toAmountAfterFee = toAmountBig - feeAmount;
  const toAmountMinBig = BigInt(lifiQuote.toAmountMin);
  const toAmountMinAfterFee = toAmountMinBig > feeAmount
    ? toAmountMinBig - feeAmount
    : 0n;

  // ── Persist quote ────────────────────────────────────────────
  const quoteId = nanoid(16);
  const expiresAt = new Date(Date.now() + 30_000); // 30 second TTL

  try {
    await prisma.quote.create({
      data: {
        id: quoteId,
        fromChainId: fromChainCfg.lifiId,
        toChainId: toChainCfg.lifiId,
        fromChain: req.fromChain,
        toChain: req.toChain,
        fromToken: req.fromToken.toUpperCase(),
        toToken: req.toToken.toUpperCase(),
        fromTokenAddr: fromTokenCfg.address,
        toTokenAddr: toTokenCfg.address,
        fromAmount: req.fromAmount,
        toAmount: toAmountAfterFee.toString(),
        toAmountMin: toAmountMinAfterFee.toString(),
        feePct,
        feeAmount: feeAmount.toString(),
        estimatedTime: lifiQuote.estimatedTime,
        aggregator: "lifi",
        routeData: lifiQuote.rawRoute as object,
        expiresAt,
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to persist quote — continuing anyway");
  }

  const response: QuoteResponse = {
    id: quoteId,
    fromChain: req.fromChain,
    toChain: req.toChain,
    fromToken: req.fromToken.toUpperCase(),
    toToken: req.toToken.toUpperCase(),
    fromTokenLogoUrl: fromTokenCfg.logoUrl,
    toTokenLogoUrl: toTokenCfg.logoUrl,
    fromAmount: req.fromAmount,
    toAmount: toAmountAfterFee.toString(),
    toAmountMin: toAmountMinAfterFee.toString(),
    fee: {
      percentage: feePct,
      amount: feeAmount.toString(),
      token: req.toToken.toUpperCase(),
    },
    estimatedTime: lifiQuote.estimatedTime,
    gasCostUSD: lifiQuote.gasCostUSD,
    bridges: lifiQuote.bridges,
    expiresAt: expiresAt.toISOString(),
  };

  // Cache result
  await cacheSet(cacheKey, response, 20);

  logger.info(
    { quoteId, from: `${req.fromToken}@${req.fromChain}`, to: `${req.toToken}@${req.toChain}` },
    "Quote created"
  );

  return response;
}

/** Retrieve a stored quote by ID */
export async function getQuoteById(id: string) {
  return prisma.quote.findUnique({ where: { id } });
}
