/**
 * DexScreener — the market-data backbone on Base (and the new-launch feed).
 *
 * Verified live, no key:
 *   GET /token-pairs/v1/base/<addr>        every pair for one token
 *   GET /token-profiles/latest/v1          recent profiles across chains
 *   GET /token-boosts/top/v1               boosted tokens across chains
 *
 * A token usually trades in several pools. We sum liquidity and volume across them
 * and take price / price-change from the deepest pair, because the deepest pool is
 * the one an agent's order would actually route through. Age comes from the *oldest*
 * `pairCreatedAt` we can see: a token is as old as its first market, and some pairs
 * (Aerodrome, in practice) omit the field entirely.
 */
import fixture from "../fixtures/dexscreener.json";
import type { DexScreenerProfile, DexScreenerToken, DexTxnCounts } from "../types";
import { asArray, asRecord, getJson, isTokensMock, mapLimit, MAX_CONCURRENCY, num, str, TtlCache } from "./http";

const BASE = "https://api.dexscreener.com";
const TOKEN_TTL_MS = 120_000;
const FEED_TTL_MS = 60_000;

const tokenCache = new TtlCache<DexScreenerToken>(TOKEN_TTL_MS);
const feedCache = new TtlCache<DexScreenerProfile[]>(FEED_TTL_MS);

export function resetDexScreenerCache(): void {
  tokenCache.clear();
  feedCache.clear();
}

interface DexFixture {
  pairs: Record<string, unknown[]>;
  profiles: unknown[];
  boosts: unknown[];
}

const FIXTURE = fixture as unknown as DexFixture;

function txns(value: unknown): DexTxnCounts | null {
  const r = asRecord(value);
  if (!r) return null;
  return { buys: num(r.buys), sells: num(r.sells) };
}

function addTxns(a: DexTxnCounts | null, b: DexTxnCounts | null): DexTxnCounts | null {
  if (a === null) return b;
  if (b === null) return a;
  return {
    buys: a.buys === null && b.buys === null ? null : (a.buys ?? 0) + (b.buys ?? 0),
    sells: a.sells === null && b.sells === null ? null : (a.sells ?? 0) + (b.sells ?? 0),
  };
}

/** Collapses every pair for one token into a single view. `null` when there is none. */
export function collapsePairs(address: string, rawPairs: readonly unknown[]): DexScreenerToken | null {
  interface Row {
    liquidityUsd: number;
    priceUsd: number | null;
    priceChange: Record<string, unknown>;
    volume: Record<string, unknown>;
    txns: Record<string, unknown>;
    fdv: number | null;
    marketCap: number | null;
    createdAtMs: number | null;
    dexId: string | null;
    symbol: string | null;
    name: string | null;
    imageUrl: string | null;
  }

  const rows: Row[] = [];
  for (const raw of rawPairs) {
    const p = asRecord(raw);
    if (!p) continue;
    const base = asRecord(p.baseToken);
    if (!base) continue;
    const baseAddress = str(base.address);
    // DexScreener also returns pairs where our token is the *quote* asset; skip those.
    if (baseAddress === null || baseAddress.toLowerCase() !== address.toLowerCase()) continue;
    rows.push({
      liquidityUsd: num(asRecord(p.liquidity)?.usd) ?? 0,
      priceUsd: num(p.priceUsd),
      priceChange: asRecord(p.priceChange) ?? {},
      volume: asRecord(p.volume) ?? {},
      txns: asRecord(p.txns) ?? {},
      fdv: num(p.fdv),
      marketCap: num(p.marketCap),
      createdAtMs: num(p.pairCreatedAt),
      dexId: str(p.dexId),
      symbol: str(base.symbol),
      name: str(base.name),
      imageUrl: str(asRecord(p.info)?.imageUrl),
    });
  }
  if (rows.length === 0) return null;

  const deepest = rows.reduce((best, r) => (r.liquidityUsd > best.liquidityUsd ? r : best), rows[0] as Row);
  const sum = (key: string, from: (r: Row) => Record<string, unknown>): number | null => {
    let total: number | null = null;
    for (const r of rows) {
      const v = num(from(r)[key]);
      if (v !== null) total = (total ?? 0) + v;
    }
    return total;
  };
  const ages = rows.map((r) => r.createdAtMs).filter((v): v is number => v !== null && v > 0);

  return {
    address,
    symbol: deepest.symbol,
    name: deepest.name,
    imageUrl: rows.find((r) => r.imageUrl !== null)?.imageUrl ?? null,
    priceUsd: deepest.priceUsd,
    liquidityUsd: rows.reduce((total, r) => total + r.liquidityUsd, 0),
    volume24hUsd: sum("h24", (r) => r.volume),
    volume6hUsd: sum("h6", (r) => r.volume),
    volume1hUsd: sum("h1", (r) => r.volume),
    priceChange5mPct: num(deepest.priceChange.m5),
    priceChange1hPct: num(deepest.priceChange.h1),
    priceChange6hPct: num(deepest.priceChange.h6),
    priceChange24hPct: num(deepest.priceChange.h24),
    txns5m: rows.map((r) => txns(r.txns.m5)).reduce(addTxns, null),
    txns1h: rows.map((r) => txns(r.txns.h1)).reduce(addTxns, null),
    txns6h: rows.map((r) => txns(r.txns.h6)).reduce(addTxns, null),
    txns24h: rows.map((r) => txns(r.txns.h24)).reduce(addTxns, null),
    fdv: deepest.fdv,
    marketCap: deepest.marketCap,
    pairCreatedAtMs: ages.length > 0 ? Math.min(...ages) : null,
    pairCount: rows.length,
    dexIds: Array.from(new Set(rows.map((r) => r.dexId).filter((d): d is string => d !== null))),
  };
}

/** Every pair for one Base token, collapsed. `null` when unlisted or DexScreener is down. */
export async function getDexScreenerToken(address: string): Promise<DexScreenerToken | null> {
  const key = address.toLowerCase();
  const cached = tokenCache.get(key);
  if (cached.hit) return cached.value;

  const raw = isTokensMock()
    ? (FIXTURE.pairs[key] ?? null)
    : await getJson(`${BASE}/token-pairs/v1/base/${encodeURIComponent(address)}`);
  const parsed = raw === null ? null : collapsePairs(address, asArray(raw));
  tokenCache.set(key, parsed);
  return parsed;
}

/** Batched lookup, capped at {@link MAX_CONCURRENCY} in-flight requests. */
export async function getDexScreenerTokens(addresses: readonly string[]): Promise<Map<string, DexScreenerToken>> {
  const unique = Array.from(new Set(addresses.map((a) => a.toLowerCase())));
  const results = await mapLimit(unique, MAX_CONCURRENCY, (address) => getDexScreenerToken(address));
  const out = new Map<string, DexScreenerToken>();
  results.forEach((token, i) => {
    if (token) out.set(unique[i] as string, token);
  });
  return out;
}

function parseProfiles(value: unknown): DexScreenerProfile[] {
  return asArray(value)
    .map((raw) => {
      const r = asRecord(raw);
      const chainId = r ? str(r.chainId) : null;
      const tokenAddress = r ? str(r.tokenAddress) : null;
      if (!r || chainId === null || tokenAddress === null) return null;
      return { chainId, tokenAddress, icon: str(r.icon), url: str(r.url) };
    })
    .filter((p): p is DexScreenerProfile => p !== null);
}

async function profileFeed(path: string, fixtureRows: readonly unknown[]): Promise<DexScreenerProfile[]> {
  const cached = feedCache.get(path);
  if (cached.hit) return cached.value ?? [];
  const rows = parseProfiles(isTokensMock() ? fixtureRows : await getJson(`${BASE}/${path}`));
  feedCache.set(path, rows);
  return rows;
}

/** Newly profiled tokens across every chain — filter by `chainId` at the call site. */
export function getLatestTokenProfiles(): Promise<DexScreenerProfile[]> {
  return profileFeed("token-profiles/latest/v1", FIXTURE.profiles);
}

/** Boosted (paid-promotion) tokens. The closest thing DexScreener has to "trending". */
export function getTopBoostedTokens(): Promise<DexScreenerProfile[]> {
  return profileFeed("token-boosts/top/v1", FIXTURE.boosts);
}
