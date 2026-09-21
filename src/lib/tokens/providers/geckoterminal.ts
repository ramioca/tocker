/**
 * GeckoTerminal — new pools, trending pools, and the GT Score. Free, keyless, and
 * the same two endpoints on every network, so this module is per-network rather
 * than Base-only.
 *
 * Verified live 2026-09-21, no key:
 *   GET /api/v2/networks/<net>/new_pools?include=base_token&page=N
 *       20 pools a page, newest first. `attributes` carries `name`,
 *       `pool_created_at`, `reserve_in_usd` (null or ~0 for seconds-old pools),
 *       `volume_usd.hN`, `price_change_percentage.hN` and
 *       `transactions.hN = { buys, sells, buyers, sellers }`. `included[]` carries the
 *       base token's `{ address, name, symbol, decimals, image_url }`.
 *   GET /api/v2/networks/<net>/trending_pools?include=base_token&page=N
 *       same shape, ranked by what the network is trading now.
 *   GET /api/v2/networks/<net>/tokens/<address>/info
 *       `data.attributes.gt_score` (0-100) plus `gt_score_details`
 *       `{ pool, transaction, creation, info, holders }`, `holders.count` and
 *       `holders.distribution_percentage.top_10`, `mint_authority` /
 *       `freeze_authority` ("yes" | "no" | null) and `is_honeypot`
 *       (boolean on Base, the string "unknown" on Solana).
 *
 * **Every request must send `accept: application/json;version=20230302`.** The
 * unversioned default is a different, older payload.
 *
 * ## Rate limit
 *
 * The free tier allows ~30 requests a minute *for the whole process*, so this is the
 * one provider with its own limiter rather than just a cache: {@link geckoJson}
 * serialises slot acquisition, spaces calls {@link MIN_SPACING_MS} apart and refuses
 * to start a request that cannot get a slot inside {@link MAX_WAIT_MS}. A refused call
 * returns `null`, exactly like a network failure — a rate limit degrades a sweep, it
 * never fails one. On top of that the pool feeds are cached for a minute and token
 * info for ten, so N agents ticking in the same minute cost what one agent costs.
 *
 * Note that `/info` answers 200 for tokens GeckoTerminal has barely seen (a
 * minutes-old pump.fun mint comes back with `gt_score` in the twenties and
 * `gt_score_details.creation: 0`), so "has an info record" is not itself a quality
 * signal — the caller has to read the score. See `discover.ts`.
 */
import type { Chain } from "@/server/types";
import baseFixture from "../fixtures/geckoterminal.json";
import newPoolsFixture from "../fixtures/geckoterminal-new-pools.json";
import tokenInfoFixture from "../fixtures/geckoterminal-token-info.json";
import { asArray, asRecord, getJson, isoMs, isTokensMock, num, str, TtlCache } from "./http";

const API_URL = "https://api.geckoterminal.com/api/v2";
/** Required on every call; the unversioned response is a different shape. */
const ACCEPT = "application/json;version=20230302";

const FEED_TTL_MS = 60_000;
/** Token info moves slowly — a GT Score is not recomputed every minute. */
const INFO_TTL_MS = 600_000;

/** Kept under the documented ~30/min so a retry inside `getJson` still fits. */
export const RATE_LIMIT_PER_MIN = 25;
/** Minimum gap between two GeckoTerminal requests from this process. */
export const MIN_SPACING_MS = 250;
/** A request that cannot get a slot this soon is abandoned rather than queued. */
export const MAX_WAIT_MS = 10_000;

export type GeckoFeed = "new_pools" | "trending_pools";

/** The base token of a pool, from the response's `included[]`. */
export interface GeckoPoolToken {
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  imageUrl: string | null;
}

/** One row of a `new_pools` / `trending_pools` page, normalised. */
export interface GeckoPool {
  /** The pool's own address, not the token's. */
  poolAddress: string | null;
  /** Pair name as GeckoTerminal writes it, e.g. `"TTF / SOL"`. */
  name: string | null;
  createdAtMs: number | null;
  /** Total reserve in USD — the pool's liquidity. Often null/0 seconds after launch. */
  reserveUsd: number | null;
  volume1hUsd: number | null;
  volume24hUsd: number | null;
  priceUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  priceChange1hPct: number | null;
  priceChange6hPct: number | null;
  priceChange24hPct: number | null;
  buysH1: number | null;
  sellsH1: number | null;
  /** Distinct buying wallets in the last hour — the cheapest "is anyone here" signal. */
  buyersH1: number | null;
  sellersH1: number | null;
  dexId: string | null;
  token: GeckoPoolToken;
}

/** `gt_score_details`. Each sub-score is 0-100. */
export interface GeckoScoreDetails {
  pool: number | null;
  transaction: number | null;
  /** 0 for a token whose creation GeckoTerminal has not assessed (i.e. brand new). */
  creation: number | null;
  info: number | null;
  holders: number | null;
}

export interface GeckoTokenInfo {
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  imageUrl: string | null;
  /** 0-100. GeckoTerminal's own composite. */
  gtScore: number | null;
  gtScoreDetails: GeckoScoreDetails;
  holderCount: number | null;
  /** Percent (0-100) of supply held by the top 10 holders. */
  top10HolderPct: number | null;
  /** Percent (0-100) still held by the deployer. */
  devHoldingPct: number | null;
  /** `"yes"` | `"no"` | null, as reported. Not used for gating — see `score.ts`. */
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** `true` only when GeckoTerminal says so; `"unknown"` arrives as `null`. */
  isHoneypot: boolean | null;
}

const feedCache = new TtlCache<GeckoPool[]>(FEED_TTL_MS);
const infoCache = new TtlCache<GeckoTokenInfo>(INFO_TTL_MS);

export function resetGeckoTerminalCache(): void {
  feedCache.clear();
  infoCache.clear();
  stamps.length = 0;
  gate = Promise.resolve();
}

// ---------- the rate limiter ----------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Epoch ms of every request started in the last minute. */
const stamps: number[] = [];
/** Serialises *slot acquisition* only; the HTTP calls themselves still overlap. */
let gate: Promise<unknown> = Promise.resolve();

/** Takes a rate-limit slot, waiting if it can. False = do not make this request. */
async function acquire(): Promise<boolean> {
  const started = Date.now();
  for (;;) {
    const now = Date.now();
    while (stamps.length > 0 && now - (stamps[0] as number) >= 60_000) stamps.shift();
    const last = stamps[stamps.length - 1] ?? 0;
    const spacing = Math.max(0, last + MIN_SPACING_MS - now);
    const window = stamps.length < RATE_LIMIT_PER_MIN ? 0 : Math.max(0, (stamps[0] as number) + 60_000 - now);
    const wait = Math.max(spacing, window);
    if (wait === 0) {
      stamps.push(now);
      return true;
    }
    if (now - started + wait > MAX_WAIT_MS) return false;
    await sleep(wait);
  }
}

/** GETs a GeckoTerminal URL under the rate limit. `null` for any failure or refusal. */
async function geckoJson(path: string): Promise<unknown> {
  const slot = gate.then(acquire);
  gate = slot.then(
    () => undefined,
    () => undefined,
  );
  if (!(await slot)) return null;
  return getJson(`${API_URL}${path}`, { accept: ACCEPT });
}

// ---------- parsing ----------

/** `"<net>_<address>"` ids, validated per network so a cross-network row is dropped. */
const ID_PATTERN: Record<Chain, RegExp> = {
  base: /^base_(0x[0-9a-fA-F]{40})$/,
  solana: /^solana_([1-9A-HJ-NP-Za-km-z]{32,44})$/,
};

/** EVM addresses are compared lowercased; base58 mints are case-sensitive. */
function normaliseAddress(address: string, network: Chain): string {
  return network === "base" ? address.toLowerCase() : address;
}

/** `"base_0xabc…"` → `"0xabc…"`; anything malformed or off-network → null. */
function addressFromId(id: string | null, network: Chain): string | null {
  if (!id) return null;
  const match = ID_PATTERN[network].exec(id);
  return match ? normaliseAddress(match[1] as string, network) : null;
}

/**
 * Base-token addresses of the pools in one feed, newest/most-trending first, deduped.
 *
 * Addresses come from the relationship id rather than `included[]`, so this works
 * whether or not the request asked for the include.
 */
export function parsePoolTokens(body: unknown, network: Chain = "base"): string[] {
  const data = asArray(asRecord(body)?.data);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of data) {
    const pool = asRecord(raw);
    const baseToken = asRecord(asRecord(asRecord(pool?.relationships)?.base_token)?.data);
    const address = addressFromId(str(baseToken?.id), network);
    if (address && !seen.has(address)) {
      seen.add(address);
      out.push(address);
    }
  }
  return out;
}

function parseIncludedTokens(body: unknown, network: Chain): Map<string, GeckoPoolToken> {
  const out = new Map<string, GeckoPoolToken>();
  for (const raw of asArray(asRecord(body)?.included)) {
    const record = asRecord(raw);
    const id = str(record?.id);
    if (id === null || str(record?.type) !== "token") continue;
    const attributes = asRecord(record?.attributes);
    const rawAddress = str(attributes?.address);
    const address = rawAddress === null ? addressFromId(id, network) : normaliseAddress(rawAddress, network);
    if (address === null) continue;
    out.set(id, {
      address,
      name: str(attributes?.name),
      symbol: str(attributes?.symbol),
      decimals: num(attributes?.decimals),
      imageUrl: str(attributes?.image_url),
    });
  }
  return out;
}

/**
 * One pool page → {@link GeckoPool}[], in the order GeckoTerminal returned them.
 *
 * A pool whose base token cannot be identified is dropped: there is nothing to trade.
 * When the request omitted `include=base_token` the token is still identified from the
 * relationship id, just without a name, symbol or decimals.
 */
export function parseGeckoPools(body: unknown, network: Chain): GeckoPool[] {
  const included = parseIncludedTokens(body, network);
  const out: GeckoPool[] = [];

  for (const raw of asArray(asRecord(body)?.data)) {
    const pool = asRecord(raw);
    const attributes = asRecord(pool?.attributes);
    const relationships = asRecord(pool?.relationships);
    const baseTokenId = str(asRecord(asRecord(relationships?.base_token)?.data)?.id);

    const token =
      (baseTokenId === null ? null : included.get(baseTokenId)) ??
      (() => {
        const address = addressFromId(baseTokenId, network);
        return address === null
          ? null
          : { address, name: null, symbol: null, decimals: null, imageUrl: null };
      })();
    if (token === null) continue;

    const txnsH1 = asRecord(asRecord(attributes?.transactions)?.h1);
    const volume = asRecord(attributes?.volume_usd);
    const change = asRecord(attributes?.price_change_percentage);

    out.push({
      poolAddress: str(attributes?.address),
      name: str(attributes?.name),
      createdAtMs: isoMs(attributes?.pool_created_at),
      reserveUsd: num(attributes?.reserve_in_usd),
      volume1hUsd: num(volume?.h1),
      volume24hUsd: num(volume?.h24),
      priceUsd: num(attributes?.base_token_price_usd),
      fdvUsd: num(attributes?.fdv_usd),
      marketCapUsd: num(attributes?.market_cap_usd),
      priceChange1hPct: num(change?.h1),
      priceChange6hPct: num(change?.h6),
      priceChange24hPct: num(change?.h24),
      buysH1: num(txnsH1?.buys),
      sellsH1: num(txnsH1?.sells),
      buyersH1: num(txnsH1?.buyers),
      sellersH1: num(txnsH1?.sellers),
      dexId: str(asRecord(asRecord(relationships?.dex)?.data)?.id),
      token,
    });
  }
  return out;
}

/**
 * GeckoTerminal reports flags as booleans on Base and as `"yes"` / `"no"` /
 * `"unknown"` strings on Solana. Only a definite yes is `true`; `"unknown"` is `null`,
 * because an unanswered honeypot check must never read as a passed one.
 */
function honeypotFlag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const text = str(value)?.toLowerCase() ?? null;
  if (text === null) return null;
  if (text === "true" || text === "yes" || text === "1") return true;
  if (text === "false" || text === "no" || text === "0") return false;
  return null;
}

/** One `/info` response → {@link GeckoTokenInfo}. `null` when there is no payload. */
export function parseGeckoTokenInfo(body: unknown, network: Chain, fallbackAddress?: string): GeckoTokenInfo | null {
  const attributes = asRecord(asRecord(asRecord(body)?.data)?.attributes);
  if (attributes === null) return null;

  const rawAddress = str(attributes.address) ?? fallbackAddress ?? null;
  if (rawAddress === null) return null;

  const details = asRecord(attributes.gt_score_details);
  const holders = asRecord(attributes.holders);
  const distribution = asRecord(holders?.distribution_percentage);

  return {
    address: normaliseAddress(rawAddress, network),
    name: str(attributes.name),
    symbol: str(attributes.symbol),
    decimals: num(attributes.decimals),
    imageUrl: str(attributes.image_url),
    gtScore: num(attributes.gt_score),
    gtScoreDetails: {
      pool: num(details?.pool),
      transaction: num(details?.transaction),
      creation: num(details?.creation),
      info: num(details?.info),
      holders: num(details?.holders),
    },
    holderCount: num(holders?.count),
    top10HolderPct: num(distribution?.top_10),
    devHoldingPct: num(attributes.developer_holding_percentage),
    mintAuthority: str(attributes.mint_authority),
    freezeAuthority: str(attributes.freeze_authority),
    isHoneypot: honeypotFlag(attributes.is_honeypot),
  };
}

// ---------- fetching ----------

/**
 * Fixtures for `TOKENS_MOCK=1`. The Solana new-pools page is a real capture; every
 * other feed is empty rather than invented, and `/info` answers only for the tokens
 * we actually captured, so mock mode never fabricates a GT Score for an arbitrary
 * mint. (A consequence worth knowing: `gecko_launches` returns nothing under
 * `TOKENS_MOCK=1`, because no token on a real new-pools page is Gecko-rated yet.)
 */
function mockPoolBody(network: Chain, feed: GeckoFeed): unknown {
  if (network === "solana") return feed === "new_pools" ? newPoolsFixture : { data: [] };
  return (baseFixture as Record<string, unknown>)[feed] ?? { data: [] };
}

function mockInfoBody(network: Chain, address: string): unknown {
  const key = `${network}:${normaliseAddress(address, network)}`;
  return (tokenInfoFixture as Record<string, unknown>)[key] ?? null;
}

/**
 * One page of a pool feed for one network. Cached for a minute, negatively too, so an
 * outage or a rate limit does not turn every agent tick into another doomed request.
 */
export async function getGeckoPools(network: Chain, feed: GeckoFeed, page = 1): Promise<GeckoPool[]> {
  if (isTokensMock()) return page === 1 ? parseGeckoPools(mockPoolBody(network, feed), network) : [];

  const key = `${network}:${feed}:${page}`;
  const cached = feedCache.get(key);
  if (cached.hit) return cached.value ?? [];

  const body = await geckoJson(`/networks/${network}/${feed}?include=base_token&page=${page}`);
  const pools = body === null ? null : parseGeckoPools(body, network);
  feedCache.set(key, pools);
  return pools ?? [];
}

/**
 * GeckoTerminal's own read on one token: the GT Score, its sub-scores, holders and
 * the honeypot flag. `null` when GeckoTerminal has no record of the token, when the
 * request failed, or when the rate limiter refused it — all three mean "no GT Score",
 * and no caller may treat any of them as a reason to fail.
 */
export async function getGeckoTokenInfo(network: Chain, address: string): Promise<GeckoTokenInfo | null> {
  if (address.length < 3) return null;
  if (isTokensMock()) return parseGeckoTokenInfo(mockInfoBody(network, address), network, address);

  const key = `${network}:${normaliseAddress(address, network)}`;
  const cached = infoCache.get(key);
  if (cached.hit) return cached.value;

  const body = await geckoJson(`/networks/${network}/tokens/${encodeURIComponent(address)}/info`);
  const info = body === null ? null : parseGeckoTokenInfo(body, network, address);
  infoCache.set(key, info);
  return info;
}

/**
 * Base-token addresses of one feed. The original Base-only entry point, kept because
 * `sweepBase` wants addresses and lets DexScreener do the enriching.
 */
export async function getGeckoPoolTokens(feed: GeckoFeed, network: Chain = "base"): Promise<string[]> {
  const pools = await getGeckoPools(network, feed, 1);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const pool of pools) {
    if (seen.has(pool.token.address)) continue;
    seen.add(pool.token.address);
    out.push(pool.token.address);
  }
  return out;
}
