/**
 * The real tokens the landing's sample cards show. Values on the page stay
 * samples; only the identity is real. SOL's logo (from the Solana token list) and
 * Super Inu's (supplied by the team; DexScreener has none for this mint) ship with
 * the site, as 96px WebP copies (the page draws them at 32px at most; the full-size
 * PNGs next to them are the sources). The rest load from DexScreener's image CDN
 * by contract address; if one fails, TokenIcon falls back to the symbol.
 */
export type Coin = { id: string; symbol: string; name: string; logoUrl: string };

export const COINS = {
  TIBBIR: {
    id: "base:0xa4a2e2ca3fbfe21aed83471d28b6f65a233c6e00",
    symbol: "TIBBIR",
    name: "TIBBIR",
    logoUrl: "https://dd.dexscreener.com/ds-data/tokens/base/0xa4a2e2ca3fbfe21aed83471d28b6f65a233c6e00.png",
  },
  "SUPER INU": {
    id: "solana:6zemoTVh54EFoP5peMJ9tWiJxPp37Xsgu9dMhq73evw7",
    symbol: "SI",
    name: "SUPER INU",
    logoUrl: "/tokens/super-inu-96.webp",
  },
  SOL: {
    id: "solana:So11111111111111111111111111111111111111112",
    symbol: "SOL",
    name: "SOL",
    logoUrl: "/tokens/sol-96.webp",
  },
  BRETT: {
    id: "base:0x532f27101965dd16442e59d40670faf5ebb142e4",
    symbol: "BRETT",
    name: "BRETT",
    logoUrl: "https://dd.dexscreener.com/ds-data/tokens/base/0x532f27101965dd16442e59d40670faf5ebb142e4.png",
  },
  BONK: {
    id: "solana:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    symbol: "BONK",
    name: "BONK",
    logoUrl: "https://dd.dexscreener.com/ds-data/tokens/solana/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263.png",
  },
  WIF: {
    id: "solana:EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    symbol: "WIF",
    name: "WIF",
    logoUrl: "https://dd.dexscreener.com/ds-data/tokens/solana/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm.png",
  },
} as const satisfies Record<string, Coin>;

export type CoinName = keyof typeof COINS;
