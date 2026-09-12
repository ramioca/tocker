/**
 * GeckoTerminal — the Base new-pool and trending-pool feeds.
 *
 * Verified live, no key:
 *   GET /api/v2/networks/base/new_pools        pools created in the last minutes/hours
 *   GET /api/v2/networks/base/trending_pools   what Base is trading right now
 *
 * DexScreener's cross-chain profile and boost feeds are dominated by Solana, so on
 * their own they surface roughly one Base token per sweep. This provider only
 * supplies *addresses*; DexScreener still enriches them (liquidity, age, volume),
 * so there is one market-data path for Base, not two.
 *
 * The free tier allows ~30 requests a minute; the one-minute feed cache keeps a
 * sweep to two calls regardless of how many agents are ticking.
 */
import fixture from "../fixtures/geckoterminal.json";
import { asArray, asRecord, getJson, isTokensMock, str, TtlCache } from "./http";

const BASE_URL = "https://api.geckoterminal.com/api/v2/networks/base";
const FEED_TTL_MS = 60_000;

export type GeckoFeed = "new_pools" | "trending_pools";

const feedCache = new TtlCache<string[]>(FEED_TTL_MS);

export function resetGeckoTerminalCache(): void {
  feedCache.clear();
}

/** `"base_0xabc…"` → `"0xabc…"`; anything malformed → null. */
function addressFromId(id: string | null): string | null {
  if (!id) return null;
  const match = /^base_(0x[0-9a-fA-F]{40})$/.exec(id);
  return match ? match[1]!.toLowerCase() : null;
}

/** Base-token addresses of the pools in one feed, newest/most-trending first, deduped. */
export function parsePoolTokens(body: unknown): string[] {
  const data = asArray(asRecord(body)?.data);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of data) {
    const pool = asRecord(raw);
    const baseToken = asRecord(asRecord(asRecord(pool?.relationships)?.base_token)?.data);
    const address = addressFromId(str(baseToken?.id));
    if (address && !seen.has(address)) {
      seen.add(address);
      out.push(address);
    }
  }
  return out;
}

export async function getGeckoPoolTokens(feed: GeckoFeed): Promise<string[]> {
  if (isTokensMock()) return parsePoolTokens((fixture as Record<string, unknown>)[feed]);
  const cached = feedCache.get(feed);
  if (cached.hit) return cached.value ?? [];
  const body = await getJson(`${BASE_URL}/${feed}?page=1`);
  // A failed call is negative-cached (for a tenth of the TTL) so an outage or a
  // rate-limit does not turn every agent tick into another doomed request.
  const tokens = body === null ? null : parsePoolTokens(body);
  feedCache.set(feed, tokens);
  return tokens ?? [];
}
