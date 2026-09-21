/**
 * Jupiter Token API v2 — the backbone on Solana.
 *
 * Verified live (no key needed; `JUPITER_API_KEY` is sent as `x-api-key` when set):
 *   GET /tokens/v2/search?query=<mint|symbol>
 *   GET /tokens/v2/recent            new launches, newest first
 *   GET /tokens/v2/toptraded/24h
 *   GET /tokens/v2/toporganicscore/24h
 *
 * One record carries almost every scoring input we need: `audit`, `organicScore`,
 * `holderCount`, `liquidity`, `firstPool.createdAt` and the four `statsN` blocks.
 * Records from `/recent` are frequently skeletal — a four-holder token with $312 of
 * liquidity and no `audit` at all — so every field is parsed as optional.
 */
import fixture from "../fixtures/jupiter.json";
import { jupiterBase } from "./jupiter-host";
import type { JupiterAudit, JupiterStats, JupiterToken } from "../types";
import { asArray, asRecord, flag, getJson, isTokensMock, isoMs, num, str, TtlCache } from "./http";

/** Keyed or keyless host, decided per call so a key added at runtime is honoured. */
const base = () => `${jupiterBase()}/tokens/v2`;
/** Token records move fast; two minutes is long enough to de-duplicate one sweep. */
const TOKEN_TTL_MS = 120_000;
const FEED_TTL_MS = 60_000;

const tokenCache = new TtlCache<JupiterToken>(TOKEN_TTL_MS);
const feedCache = new TtlCache<JupiterToken[]>(FEED_TTL_MS);

export function resetJupiterCache(): void {
  tokenCache.clear();
  feedCache.clear();
}

function headers(): Record<string, string> {
  const key = process.env.JUPITER_API_KEY?.trim();
  return key ? { "x-api-key": key } : {};
}

function parseStats(value: unknown): JupiterStats | null {
  const r = asRecord(value);
  if (!r) return null;
  return {
    priceChange: num(r.priceChange),
    holderChange: num(r.holderChange),
    liquidityChange: num(r.liquidityChange),
    volumeChange: num(r.volumeChange),
    buyVolume: num(r.buyVolume),
    sellVolume: num(r.sellVolume),
    buyOrganicVolume: num(r.buyOrganicVolume),
    sellOrganicVolume: num(r.sellOrganicVolume),
    numBuys: num(r.numBuys),
    numSells: num(r.numSells),
    numTraders: num(r.numTraders),
    numOrganicBuyers: num(r.numOrganicBuyers),
    numNetBuyers: num(r.numNetBuyers),
  };
}

function parseAudit(value: unknown): JupiterAudit | null {
  const r = asRecord(value);
  if (!r) return null;
  return {
    mintAuthorityDisabled: flag(r.mintAuthorityDisabled),
    freezeAuthorityDisabled: flag(r.freezeAuthorityDisabled),
    topHoldersPercentage: num(r.topHoldersPercentage),
    devBalancePercentage: num(r.devBalancePercentage),
    devMints: num(r.devMints),
    isSus: flag(r.isSus),
  };
}

/** Vendor record → {@link JupiterToken}. Returns `null` when there is no usable `id`. */
export function parseJupiterToken(value: unknown): JupiterToken | null {
  const r = asRecord(value);
  if (!r) return null;
  const id = str(r.id);
  if (id === null) return null;
  const firstPool = asRecord(r.firstPool);
  return {
    id,
    name: str(r.name),
    symbol: str(r.symbol),
    icon: str(r.icon),
    decimals: num(r.decimals),
    dev: str(r.dev),
    circSupply: num(r.circSupply),
    totalSupply: num(r.totalSupply),
    tokenProgram: str(r.tokenProgram),
    holderCount: num(r.holderCount),
    fdv: num(r.fdv),
    mcap: num(r.mcap),
    usdPrice: num(r.usdPrice),
    liquidity: num(r.liquidity),
    stats5m: parseStats(r.stats5m),
    stats1h: parseStats(r.stats1h),
    stats6h: parseStats(r.stats6h),
    stats24h: parseStats(r.stats24h),
    firstPoolCreatedAtMs: firstPool ? isoMs(firstPool.createdAt) : null,
    createdAtMs: isoMs(r.createdAt),
    audit: parseAudit(r.audit),
    organicScore: num(r.organicScore),
    organicScoreLabel: str(r.organicScoreLabel),
    isVerified: flag(r.isVerified),
    tags: asArray(r.tags)
      .map(str)
      .filter((t): t is string => t !== null),
  };
}

function parseList(value: unknown): JupiterToken[] {
  return asArray(value)
    .map(parseJupiterToken)
    .filter((t): t is JupiterToken => t !== null);
}

// ---------- fixtures ----------

interface JupiterFixture {
  tokens: Record<string, unknown>;
  recent: string[];
  toptraded: string[];
  toporganic: string[];
}

const FIXTURE = fixture as unknown as JupiterFixture;

function fixtureTokens(ids: readonly string[]): JupiterToken[] {
  return ids.map((id) => parseJupiterToken(FIXTURE.tokens[id])).filter((t): t is JupiterToken => t !== null);
}

function fixtureLookup(query: string): JupiterToken | null {
  const direct = FIXTURE.tokens[query];
  if (direct) return parseJupiterToken(direct);
  const needle = query.toLowerCase();
  for (const raw of Object.values(FIXTURE.tokens)) {
    const parsed = parseJupiterToken(raw);
    if (parsed && parsed.symbol?.toLowerCase() === needle) return parsed;
  }
  return null;
}

// ---------- public API ----------

/** One token by mint (or symbol). `null` when Jupiter does not know it or is down. */
export async function getJupiterToken(mintOrSymbol: string): Promise<JupiterToken | null> {
  const query = mintOrSymbol.trim();
  if (query.length < 2) return null;

  const cached = tokenCache.get(query);
  if (cached.hit) return cached.value;

  const found = isTokensMock()
    ? fixtureLookup(query)
    : await (async () => {
        const body = await getJson(`${base()}/search?query=${encodeURIComponent(query)}`, headers());
        const rows = parseList(body);
        return rows.find((r) => r.id === query) ?? rows[0] ?? null;
      })();

  tokenCache.set(query, found);
  if (found) tokenCache.set(found.id, found);
  return found;
}

/**
 * A batch of mints. Jupiter's search accepts a comma-separated `query`, so this is
 * one request per 40 mints rather than one per mint.
 */
export async function getJupiterTokens(mints: readonly string[]): Promise<Map<string, JupiterToken>> {
  const out = new Map<string, JupiterToken>();
  const pending: string[] = [];
  for (const mint of new Set(mints)) {
    const cached = tokenCache.get(mint);
    if (cached.hit) {
      if (cached.value) out.set(mint, cached.value);
    } else {
      pending.push(mint);
    }
  }
  if (pending.length === 0) return out;

  if (isTokensMock()) {
    for (const mint of pending) {
      const found = fixtureLookup(mint);
      tokenCache.set(mint, found);
      if (found) out.set(mint, found);
    }
    return out;
  }

  for (let i = 0; i < pending.length; i += 40) {
    const batch = pending.slice(i, i + 40);
    const body = await getJson(`${base()}/search?query=${encodeURIComponent(batch.join(","))}`, headers());
    const rows = parseList(body);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const mint of batch) {
      const found = byId.get(mint) ?? null;
      tokenCache.set(mint, found);
      if (found) out.set(mint, found);
    }
  }
  return out;
}

async function feed(path: string, fixtureIds: readonly string[]): Promise<JupiterToken[]> {
  const cached = feedCache.get(path);
  if (cached.hit) return cached.value ?? [];

  const rows = isTokensMock() ? fixtureTokens(fixtureIds) : parseList(await getJson(`${base()}/${path}`, headers()));
  feedCache.set(path, rows);
  for (const row of rows) tokenCache.set(row.id, row);
  return rows;
}

/** Newly launched mints, newest first. Records here are often skeletal. */
export function getJupiterRecent(): Promise<JupiterToken[]> {
  return feed("recent", FIXTURE.recent);
}

export function getJupiterTopTraded(): Promise<JupiterToken[]> {
  return feed("toptraded/24h", FIXTURE.toptraded);
}

export function getJupiterTopOrganic(): Promise<JupiterToken[]> {
  return feed("toporganicscore/24h", FIXTURE.toporganic);
}
