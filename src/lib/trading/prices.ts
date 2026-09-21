/**
 * Price marks for PnL and for the paper executor.
 *
 * Solana: Jupiter Price API v3 (public). Base: DexScreener (public). Both are cached
 * for 30s, written back to `tokens.lastPriceUsd`, and fall back — in order — to the
 * stored price and then to the constant in `KNOWN_TOKENS`, so a run never dies just
 * because a price feed blinked.
 */
import { eq, inArray } from "drizzle-orm";
import { getDb, tokens } from "@/db";
import type { Chain } from "@/server/types";
import { fallbackPriceFor, jupiterBase, jupiterHeaders, tokenId } from "./tokens";

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; price: number }>();

export function resetPriceCache(): void {
  cache.clear();
}

function cached(id: string): number | null {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.price;
  return null;
}

function remember(id: string, price: number): void {
  cache.set(id, { at: Date.now(), price });
}

export async function fetchSolanaPrices(mints: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (mints.length === 0) return out;
  try {
    const res = await fetch(`${jupiterBase()}/price/v3?ids=${mints.join(",")}`, {
      headers: jupiterHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return out;
    const body: unknown = await res.json();
    if (!body || typeof body !== "object") return out;
    for (const [mint, entry] of Object.entries(body as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const price = (entry as Record<string, unknown>).usdPrice;
      if (typeof price === "number" && Number.isFinite(price)) out.set(mint, price);
    }
  } catch {
    // fall through to stored / constant prices
  }
  return out;
}

export function fetchBasePrices(addresses: string[]): Promise<Map<string, number>> {
  return fetchDexScreenerPrices(
    "base",
    addresses.filter((a) => a.startsWith("0x")),
  );
}

/**
 * DexScreener prices for one chain. The primary source on Base; on Solana the fallback
 * for whatever Jupiter's keyless price tier refused (it 429s under shared egress), so a
 * mark goes stale only when *both* public sources fail — the "Tocker lags the market"
 * feel was Jupiter refusing and the last stored mark standing in.
 */
export async function fetchDexScreenerPrices(chain: Chain, addresses: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const erc20 = Array.from(new Set(addresses));
  if (erc20.length === 0) return out;
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${erc20.slice(0, 30).join(",")}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return out;
    const body: unknown = await res.json();
    for (const row of Array.isArray(body) ? body : []) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const base = r.baseToken;
      if (!base || typeof base !== "object") continue;
      const addr = (base as Record<string, unknown>).address;
      const price = Number(r.priceUsd);
      if (typeof addr !== "string" || !Number.isFinite(price)) continue;
      // DexScreener returns one row per pair; keep the first (highest-liquidity) hit.
      // Exact first (base58 is case-sensitive), then case-insensitive for EVM addresses.
      const match = erc20.find((a) => a === addr) ?? erc20.find((a) => a.toLowerCase() === addr.toLowerCase());
      if (match && !out.has(match)) out.set(match, price);
    }
  } catch {
    // fall through
  }
  return out;
}

interface TokenKey {
  id: string;
  chain: Chain;
  address: string;
  stored: number | null;
}

/**
 * Marks for a set of `tokens.id` values. Returns `null` for anything we could not
 * price at all. Also refreshes `tokens.lastPriceUsd` for whatever we did price.
 */
export async function getMarks(ids: readonly string[]): Promise<Map<string, number | null>> {
  const unique = Array.from(new Set(ids));
  const out = new Map<string, number | null>();
  if (unique.length === 0) return out;

  const pending: string[] = [];
  for (const id of unique) {
    const hit = cached(id);
    if (hit !== null) out.set(id, hit);
    else pending.push(id);
  }
  if (pending.length === 0) return out;

  const db = await getDb();
  const rows = await db.select().from(tokens).where(inArray(tokens.id, pending));
  const keys: TokenKey[] = rows.map((r) => ({
    id: r.id,
    chain: r.chain,
    address: r.address,
    stored: r.lastPriceUsd === null ? null : Number(r.lastPriceUsd),
  }));
  for (const id of pending) {
    if (!keys.some((k) => k.id === id)) out.set(id, null);
  }

  const solanaMints = keys.filter((k) => k.chain === "solana").map((k) => k.address);
  const [jupiter, base] = await Promise.all([
    fetchSolanaPrices(solanaMints),
    fetchBasePrices(keys.filter((k) => k.chain === "base").map((k) => k.address)),
  ]);
  const unpriced = solanaMints.filter((mint) => !jupiter.has(mint));
  const solana = unpriced.length === 0 ? jupiter : new Map([...(await fetchDexScreenerPrices("solana", unpriced)), ...jupiter]);

  const updates: Array<{ id: string; price: number }> = [];
  for (const key of keys) {
    const live = key.chain === "solana" ? solana.get(key.address) : base.get(key.address);
    const price = live ?? key.stored ?? fallbackPriceFor(key.chain, key.address);
    if (price === undefined || price === null || !Number.isFinite(price)) {
      out.set(key.id, null);
      continue;
    }
    out.set(key.id, price);
    remember(key.id, price);
    if (live !== undefined) updates.push({ id: key.id, price });
  }

  for (const u of updates) {
    await db
      .update(tokens)
      .set({ lastPriceUsd: u.price.toFixed(12), priceUpdatedAt: new Date() })
      .where(eq(tokens.id, u.id));
  }

  return out;
}

/** Convenience: one token's mark by chain + address. */
export async function getPriceUsd(chain: Chain, address: string): Promise<number | null> {
  const marks = await getMarks([tokenId(chain, address)]);
  return marks.get(tokenId(chain, address)) ?? null;
}
