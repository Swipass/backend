/**
 * SUPPORTED CHAINS & TOKENS — v0.1
 *
 * We deliberately limit to chains and tokens with guaranteed deep
 * liquidity on LI.FI. Adding a chain/token here is the ONLY thing
 * needed to surface it in the bridge UI.
 *
 * LI.FI chain IDs:  https://apidocs.li.fi/reference/getChains
 * Token addresses:  verified via LI.FI token list
 */

export interface ChainConfig {
  id: string;          // internal slug (matches LI.FI key)
  lifiId: number;      // LI.FI numeric chain ID
  name: string;
  shortName: string;
  icon: string;        // emoji fallback (replaced by logo in UI)
  logoUrl: string;     // token logo from trustwallet assets
  explorerUrl: string;
  nativeSymbol: string;
  rpcUrl?: string;     // optional fallback RPC
}

export interface TokenConfig {
  symbol: string;
  name: string;
  address: string;     // "0x0000…" = native; contract address otherwise
  decimals: number;
  logoUrl: string;
  chains: string[];    // which chains this token exists on (by slug)
}

// ── Supported chains ─────────────────────────────────────────
export const SUPPORTED_CHAINS: ChainConfig[] = [
  {
    id: "ethereum",
    lifiId: 1,
    name: "Ethereum",
    shortName: "ETH",
    icon: "Ξ",
    logoUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
    explorerUrl: "https://etherscan.io",
    nativeSymbol: "ETH",
  },
  {
    id: "arbitrum",
    lifiId: 42161,
    name: "Arbitrum",
    shortName: "ARB",
    icon: "A",
    logoUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png",
    explorerUrl: "https://arbiscan.io",
    nativeSymbol: "ETH",
  },
  {
    id: "optimism",
    lifiId: 10,
    name: "Optimism",
    shortName: "OP",
    icon: "O",
    logoUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/info/logo.png",
    explorerUrl: "https://optimistic.etherscan.io",
    nativeSymbol: "ETH",
  },
  {
    id: "base",
    lifiId: 8453,
    name: "Base",
    shortName: "BASE",
    icon: "B",
    logoUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png",
    explorerUrl: "https://basescan.org",
    nativeSymbol: "ETH",
  },
  {
    id: "polygon",
    lifiId: 137,
    name: "Polygon",
    shortName: "POL",
    icon: "P",
    logoUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png",
    explorerUrl: "https://polygonscan.com",
    nativeSymbol: "MATIC",
  },
  {
    id: "avalanche",
    lifiId: 43114,
    name: "Avalanche",
    shortName: "AVAX",
    icon: "▲",
    logoUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/info/logo.png",
    explorerUrl: "https://snowtrace.io",
    nativeSymbol: "AVAX",
  },
  {
    id: "bnb",
    lifiId: 56,
    name: "BNB Chain",
    shortName: "BNB",
    icon: "B",
    logoUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/info/logo.png",
    explorerUrl: "https://bscscan.com",
    nativeSymbol: "BNB",
  },
];

// ── Token logo base URLs ──────────────────────────────────────
const TW = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";
const CG = "https://assets.coingecko.com/coins/images";

// ── Supported tokens per chain ───────────────────────────────
// Only tokens with reliable, deep liquidity across our chains.
export const SUPPORTED_TOKENS: Record<string, TokenConfig[]> = {
  ethereum: [
    { symbol: "ETH",  name: "Ethereum",         address: "0x0000000000000000000000000000000000000000", decimals: 18, logoUrl: `${TW}/ethereum/info/logo.png`,                                      chains: ["ethereum","arbitrum","optimism","base"] },
    { symbol: "USDC", name: "USD Coin",          address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6,  logoUrl: `${CG}/6319/small/usdc.png`,                                           chains: ["ethereum","arbitrum","optimism","base","polygon","avalanche","bnb"] },
    { symbol: "USDT", name: "Tether USD",        address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6,  logoUrl: `${CG}/325/small/Tether.png`,                                           chains: ["ethereum","arbitrum","optimism","polygon","avalanche","bnb"] },
    { symbol: "WBTC", name: "Wrapped Bitcoin",   address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8,  logoUrl: `${TW}/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png`, chains: ["ethereum","arbitrum","optimism","polygon"] },
    { symbol: "DAI",  name: "Dai Stablecoin",    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, logoUrl: `${CG}/9956/small/Badge_Dai.png`,                                       chains: ["ethereum","arbitrum","optimism","polygon","avalanche","bnb"] },
    { symbol: "WETH", name: "Wrapped Ether",     address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, logoUrl: `${TW}/ethereum/info/logo.png`,                                          chains: ["ethereum","arbitrum","optimism","base","polygon"] },
  ],
  arbitrum: [
    { symbol: "ETH",  name: "Ethereum",         address: "0x0000000000000000000000000000000000000000", decimals: 18, logoUrl: `${TW}/ethereum/info/logo.png`,                                      chains: ["ethereum","arbitrum","optimism","base"] },
    { symbol: "USDC", name: "USD Coin",          address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6,  logoUrl: `${CG}/6319/small/usdc.png`,                                           chains: ["ethereum","arbitrum","optimism","base","polygon","avalanche","bnb"] },
    { symbol: "USDT", name: "Tether USD",        address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6,  logoUrl: `${CG}/325/small/Tether.png`,                                           chains: ["ethereum","arbitrum","optimism","polygon","avalanche","bnb"] },
    { symbol: "WBTC", name: "Wrapped Bitcoin",   address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8,  logoUrl: `${TW}/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png`, chains: ["ethereum","arbitrum","optimism","polygon"] },
    { symbol: "ARB",  name: "Arbitrum",          address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18, logoUrl: `${CG}/16547/small/photo_2023-03-29_21.47.00.jpeg`,                      chains: ["arbitrum"] },
  ],
  optimism: [
    { symbol: "ETH",  name: "Ethereum",         address: "0x0000000000000000000000000000000000000000", decimals: 18, logoUrl: `${TW}/ethereum/info/logo.png`,                                      chains: ["ethereum","arbitrum","optimism","base"] },
    { symbol: "USDC", name: "USD Coin",          address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6,  logoUrl: `${CG}/6319/small/usdc.png`,                                           chains: ["ethereum","arbitrum","optimism","base","polygon","avalanche","bnb"] },
    { symbol: "USDT", name: "Tether USD",        address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6,  logoUrl: `${CG}/325/small/Tether.png`,                                           chains: ["ethereum","arbitrum","optimism","polygon","avalanche","bnb"] },
    { symbol: "OP",   name: "Optimism",          address: "0x4200000000000000000000000000000000000042", decimals: 18, logoUrl: `${CG}/25244/small/Optimism.png`,                                        chains: ["optimism"] },
  ],
  base: [
    { symbol: "ETH",  name: "Ethereum",         address: "0x0000000000000000000000000000000000000000", decimals: 18, logoUrl: `${TW}/ethereum/info/logo.png`,                                      chains: ["ethereum","arbitrum","optimism","base"] },
    { symbol: "USDC", name: "USD Coin",          address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6,  logoUrl: `${CG}/6319/small/usdc.png`,                                           chains: ["ethereum","arbitrum","optimism","base","polygon","avalanche","bnb"] },
    { symbol: "DAI",  name: "Dai Stablecoin",    address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, logoUrl: `${CG}/9956/small/Badge_Dai.png`,                                       chains: ["ethereum","arbitrum","optimism","polygon","avalanche","bnb"] },
  ],
  polygon: [
    { symbol: "MATIC",name: "Polygon",           address: "0x0000000000000000000000000000000000000000", decimals: 18, logoUrl: `${TW}/polygon/info/logo.png`,                                      chains: ["polygon"] },
    { symbol: "USDC", name: "USD Coin",          address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", decimals: 6,  logoUrl: `${CG}/6319/small/usdc.png`,                                           chains: ["ethereum","arbitrum","optimism","base","polygon","avalanche","bnb"] },
    { symbol: "USDT", name: "Tether USD",        address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6,  logoUrl: `${CG}/325/small/Tether.png`,                                           chains: ["ethereum","arbitrum","optimism","polygon","avalanche","bnb"] },
    { symbol: "WETH", name: "Wrapped Ether",     address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18, logoUrl: `${TW}/ethereum/info/logo.png`,                                          chains: ["ethereum","arbitrum","optimism","base","polygon"] },
    { symbol: "DAI",  name: "Dai Stablecoin",    address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18, logoUrl: `${CG}/9956/small/Badge_Dai.png`,                                       chains: ["ethereum","arbitrum","optimism","polygon","avalanche","bnb"] },
  ],
  avalanche: [
    { symbol: "AVAX", name: "Avalanche",         address: "0x0000000000000000000000000000000000000000", decimals: 18, logoUrl: `${TW}/avalanchec/info/logo.png`,                                   chains: ["avalanche"] },
    { symbol: "USDC", name: "USD Coin",          address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6,  logoUrl: `${CG}/6319/small/usdc.png`,                                           chains: ["ethereum","arbitrum","optimism","base","polygon","avalanche","bnb"] },
    { symbol: "USDT", name: "Tether USD",        address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6,  logoUrl: `${CG}/325/small/Tether.png`,                                           chains: ["ethereum","arbitrum","optimism","polygon","avalanche","bnb"] },
  ],
  bnb: [
    { symbol: "BNB",  name: "BNB",               address: "0x0000000000000000000000000000000000000000", decimals: 18, logoUrl: `${TW}/binance/info/logo.png`,                                      chains: ["bnb"] },
    { symbol: "USDC", name: "USD Coin",          address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, logoUrl: `${CG}/6319/small/usdc.png`,                                           chains: ["ethereum","arbitrum","optimism","base","polygon","avalanche","bnb"] },
    { symbol: "USDT", name: "Tether USD",        address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, logoUrl: `${CG}/325/small/Tether.png`,                                           chains: ["ethereum","arbitrum","optimism","polygon","avalanche","bnb"] },
    { symbol: "BUSD", name: "Binance USD",       address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", decimals: 18, logoUrl: `${CG}/14882/small/200x200.png`,                                       chains: ["bnb"] },
  ],
};

/** Helper: get tokens available for a given chain slug */
export function getTokensForChain(chainSlug: string): TokenConfig[] {
  return SUPPORTED_TOKENS[chainSlug] ?? [];
}

/** Helper: get chain config by slug */
export function getChain(chainSlug: string): ChainConfig | undefined {
  return SUPPORTED_CHAINS.find((c) => c.id === chainSlug);
}

/** Helper: get chain config by lifiId */
export function getChainByLifiId(lifiId: number): ChainConfig | undefined {
  return SUPPORTED_CHAINS.find((c) => c.lifiId === lifiId);
}
