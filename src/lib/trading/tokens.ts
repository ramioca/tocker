/**
 * Token identity: constants for everything the demo needs (so mock mode never touches
 * the network), plus network lookups for anything else.
 *
 * `tokens.id` is always `${chain}:${address}`.
 */
import { and, eq, or } from "drizzle-orm";
import { getDb, tokens } from "@/db";
import type { Chain, TokenRef } from "@/server/types";

export const CAIP2_SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const CAIP2_BASE = "eip155:8453";

export function caip2For(chain: Chain): string {
  return chain === "solana" ? CAIP2_SOLANA : CAIP2_BASE;
}

export interface KnownToken {
  chain: Chain;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string | null;
  /** Used only when every price feed is unreachable (offline dev, mock runs). */
  fallbackPriceUsd: number;
}

export const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const SOL_MINT = "So11111111111111111111111111111111111111112";

export const KNOWN_TOKENS: KnownToken[] = [
  { chain: "solana", address: USDC_SOLANA, symbol: "USDC", name: "USD Coin", decimals: 6, logoUrl: null, fallbackPriceUsd: 1 },
  { chain: "solana", address: SOL_MINT, symbol: "SOL", name: "Solana", decimals: 9, logoUrl: null, fallbackPriceUsd: 99.86 },
  { chain: "solana", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", decimals: 5, logoUrl: null, fallbackPriceUsd: 0.0000026936 },
  { chain: "solana", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat", decimals: 6, logoUrl: null, fallbackPriceUsd: 0.5412 },
  { chain: "solana", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", decimals: 6, logoUrl: null, fallbackPriceUsd: 0.402 },
  { chain: "base", address: USDC_BASE, symbol: "USDC", name: "USD Coin", decimals: 6, logoUrl: null, fallbackPriceUsd: 1 },
  { chain: "base", address: "native", symbol: "ETH", name: "Ether", decimals: 18, logoUrl: null, fallbackPriceUsd: 3122.8 },
  { chain: "base", address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", symbol: "BRETT", name: "Brett", decimals: 18, logoUrl: null, fallbackPriceUsd: 0.004763 },
  { chain: "base", address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", symbol: "DEGEN", name: "Degen", decimals: 18, logoUrl: null, fallbackPriceUsd: 0.00312 },
  { chain: "base", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", symbol: "AERO", name: "Aerodrome", decimals: 18, logoUrl: null, fallbackPriceUsd: 0.7841 },
];

export function tokenId(chain: Chain, address: string): string {
  return `${chain}:${address}`;
}

export function quoteTokenAddress(chain: Chain): string {
  return chain === "solana" ? USDC_SOLANA : USDC_BASE;
}

export function quoteTokenId(chain: Chain): string {
  return tokenId(chain, quoteTokenAddress(chain));
}

function findKnown(chain: Chain, addressOrSymbol: string): KnownToken | undefined {
  const needle = addressOrSymbol.trim();
  const lower = needle.toLowerCase();
  return KNOWN_TOKENS.find(
    (t) => t.chain === chain && (t.address === needle || t.address.toLowerCase() === lower || t.symbol.toLowerCase() === lower),
  );
}

export function toTokenRef(row: {
  id: string;
  chain: Chain;
  address: string;
  symbol: string;
  name: string | null;
  logoUrl: string | null;
  decimals: number;
  lastPriceUsd: string | null;
}): TokenRef {
  return {
    id: row.id,
    chain: row.chain,
    address: row.address,
    symbol: row.symbol,
    name: row.name,
    logoUrl: row.logoUrl,
    decimals: row.decimals,
    lastPriceUsd: row.lastPriceUsd === null ? null : Number(row.lastPriceUsd),
  };
}

interface RemoteToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string | null;
  priceUsd: number | null;
}

async function lookupSolana(addressOrSymbol: string): Promise<RemoteToken | null> {
  try {
    const res = await fetch(`https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(addressOrSymbol)}`, {
      headers: jupiterHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const rows = Array.isArray(body) ? body : [];
    const first = rows[0];
    if (!first || typeof first !== "object") return null;
    const r = first as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : null;
    const decimals = typeof r.decimals === "number" ? r.decimals : null;
    if (!id || decimals === null) return null;
    return {
      address: id,
      symbol: typeof r.symbol === "string" ? r.symbol : addressOrSymbol.slice(0, 6),
      name: typeof r.name === "string" ? r.name : (typeof r.symbol === "string" ? r.symbol : "Unknown"),
      decimals,
      logoUrl: typeof r.icon === "string" ? r.icon : null,
      priceUsd: typeof r.usdPrice === "number" ? r.usdPrice : null,
    };
  } catch {
    return null;
  }
}

async function lookupBase(address: string): Promise<RemoteToken | null> {
  if (!address.startsWith("0x")) return null;
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/base/${address}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const rows = Array.isArray(body) ? body : [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const base = (row as Record<string, unknown>).baseToken;
      if (!base || typeof base !== "object") continue;
      const b = base as Record<string, unknown>;
      if (typeof b.address !== "string" || b.address.toLowerCase() !== address.toLowerCase()) continue;
      const priceUsd = Number((row as Record<string, unknown>).priceUsd);
      return {
        address: b.address,
        symbol: typeof b.symbol === "string" ? b.symbol : address.slice(0, 8),
        name: typeof b.name === "string" ? b.name : "Unknown",
        decimals: 18,
        logoUrl: null,
        priceUsd: Number.isFinite(priceUsd) ? priceUsd : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function jupiterHeaders(): Record<string, string> {
  const key = process.env.JUPITER_API_KEY?.trim();
  return key ? { "x-api-key": key } : {};
}

export interface TokenRecord extends TokenRef {
  fallbackPriceUsd: number | null;
}

/**
 * Resolves a mint/contract address *or* a symbol to a row in `tokens`, inserting it
 * if we have not seen it before. Known tokens resolve without any network call.
 */
export async function resolveToken(chain: Chain, addressOrSymbol: string): Promise<TokenRecord> {
  const db = await getDb();
  const needle = addressOrSymbol.trim();

  const existing = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.chain, chain), or(eq(tokens.address, needle), eq(tokens.symbol, needle.toUpperCase()))))
    .limit(1);
  if (existing[0]) {
    const known = findKnown(chain, existing[0].address);
    return { ...toTokenRef(existing[0]), fallbackPriceUsd: known?.fallbackPriceUsd ?? null };
  }

  const known = findKnown(chain, needle);
  const remote = known ? null : chain === "solana" ? await lookupSolana(needle) : await lookupBase(needle);
  const resolved = known
    ? { address: known.address, symbol: known.symbol, name: known.name, decimals: known.decimals, logoUrl: known.logoUrl, priceUsd: null }
    : remote;

  if (!resolved) {
    throw new Error(`Unknown token "${addressOrSymbol}" on ${chain}. Pass a full mint/contract address.`);
  }

  const id = tokenId(chain, resolved.address);
  const row = {
    id,
    chain,
    address: resolved.address,
    symbol: resolved.symbol.toUpperCase(),
    name: resolved.name,
    decimals: resolved.decimals,
    logoUrl: resolved.logoUrl,
    lastPriceUsd: resolved.priceUsd === null ? null : String(resolved.priceUsd),
    priceUpdatedAt: resolved.priceUsd === null ? null : new Date(),
  };
  await db.insert(tokens).values(row).onConflictDoNothing({ target: tokens.id });

  return {
    ...toTokenRef(row),
    fallbackPriceUsd: known?.fallbackPriceUsd ?? resolved.priceUsd ?? null,
  };
}

/** Ensures the USDC row for a chain exists and returns its id. */
export async function ensureQuoteToken(chain: Chain): Promise<string> {
  const token = await resolveToken(chain, quoteTokenAddress(chain));
  return token.id;
}

/** Inserts every constant in {@link KNOWN_TOKENS} that is missing. Used by the demo script. */
export async function seedKnownTokens(): Promise<void> {
  const db = await getDb();
  for (const t of KNOWN_TOKENS) {
    await db
      .insert(tokens)
      .values({
        id: tokenId(t.chain, t.address),
        chain: t.chain,
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        logoUrl: t.logoUrl,
      })
      .onConflictDoNothing({ target: tokens.id });
  }
}

export function fallbackPriceFor(chain: Chain, address: string): number | null {
  return findKnown(chain, address)?.fallbackPriceUsd ?? null;
}
