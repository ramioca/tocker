/**
 * The real tokens the landing's sample cards show. Values on the page stay
 * samples; only the identity is real. SOL's logo ships with the site (from the
 * Solana token list). TIBBIR's and Super Inu's load from DexScreener's image CDN
 * by contract address; if that fails, TokenIcon falls back to the symbol.
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
    logoUrl: "https://dd.dexscreener.com/ds-data/tokens/solana/6zemoTVh54EFoP5peMJ9tWiJxPp37Xsgu9dMhq73evw7.png",
  },
  SOL: {
    id: "solana:So11111111111111111111111111111111111111112",
    symbol: "SOL",
    name: "SOL",
    logoUrl: "/tokens/sol.png",
  },
} as const satisfies Record<string, Coin>;

export type CoinName = keyof typeof COINS;
