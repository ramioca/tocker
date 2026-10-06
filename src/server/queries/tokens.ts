import "server-only";
import { and, asc, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { agents, getDb, positions, publicTokenScores, tokenScores, tokens, trades, type Db } from "@/db";
import { toNum, toNumOrNull } from "@/lib/money";
import { unrealized } from "@/lib/pnl";
import { getScoreHistory, isNoData } from "@/lib/tokens/history";
import { PUBLIC_UNIVERSE_KEY } from "@/lib/tokens";
import type {
  AgentCard,
  Chain,
  ScoreHistoryPoint,
  TokenMarketFacts,
  TokenPage,
  TokenRef,
  TokenScore,
  TradeRow,
} from "@/server/types";
import { loadTokens, toTokenRef, toTradeRow } from "./_shared";
import { canonicalTokenAddress, isCaseInsensitiveAddress, tokenIdSpellings } from "./token-address";

/**
 * Token pages are public, so every score on one is computed under the platform's
 * **default** universe — never an agent's. An agent's gates are part of its
 * strategy: a public blocker reading "liquidity below floor" computed against
 * someone's private threshold would publish that threshold.
 */
export { PUBLIC_UNIVERSE_KEY };

const RECENT_TRADE_LIMIT = 20;
const FLOW_WINDOW_DAYS = 30;

/**
 * Reads the shared score cache without scoring. A token page is a public, free
 * surface that anyone can hit with any address, so it never fans out to the
 * providers on render — that is what the explicit "score it" action is for
 * (`src/server/actions/blocklist.ts` → `scoreTokenNow`). No TTL is applied
 * either: an hour-old score is still the last thing we knew, and the page says
 * when it was taken.
 */
async function cachedScore(
  db: Db,
  id: string,
): Promise<{ score: TokenScore | null; marketFacts: TokenMarketFacts | null }> {
  const [[cacheRow], publicRow] = await Promise.all([
    db.select().from(tokenScores).where(eq(tokenScores.id, id)).limit(1),
    // The public reading lives in its own row, which no agent's rescore can replace.
    // Unreadable (a database not yet migrated) is "none yet", not a broken page.
    db
      .select()
      .from(publicTokenScores)
      .where(eq(publicTokenScores.id, id))
      .limit(1)
      .then((rows) => rows[0] ?? null)
      .catch(() => null),
  ]);
  if (!cacheRow && !publicRow) return { score: null, marketFacts: null };

  // Market facts are the same under any universe, so they come from whichever reading
  // is newest, whoever took it. Only these fields leave that row.
  const marketRow = publicRow && (!cacheRow || publicRow.scoredAt >= cacheRow.scoredAt) ? publicRow : cacheRow!;
  const marketFacts: TokenMarketFacts = {
    priceUsd: toNumOrNull(marketRow.priceUsd),
    liquidityUsd: toNumOrNull(marketRow.liquidityUsd),
    volume24hUsd: toNumOrNull(marketRow.volume24hUsd),
    marketCapUsd: toNumOrNull(marketRow.marketCapUsd),
    holderCount: marketRow.holderCount,
    ageHours: toNumOrNull(marketRow.ageHours),
    priceChange24hPct: toNumOrNull(marketRow.priceChange24hPct),
    measuredAt: marketRow.scoredAt.toISOString(),
  };

  // A cache row scored under a different universe carries that universe's verdict and
  // blockers; reusing it here would leak another operator's thresholds. Before the
  // public table existed, a cache row under the public key was the public reading, so it
  // still stands in for a token that has not been scored in public since.
  const row = publicRow ?? (cacheRow?.universeKey === PUBLIC_UNIVERSE_KEY ? cacheRow : null);
  if (!row) return { score: null, marketFacts };
  // A reading no provider answered is an outage, not a verdict: "0 · avoid, 6 gates
  // failed" on a token that simply could not be looked up. New ones are no longer
  // cached (`getTokenScore`); this keeps any already stored off the public page.
  if (
    isNoData({
      sources: row.sources,
      priceUsd: toNumOrNull(row.priceUsd),
      liquidityUsd: toNumOrNull(row.liquidityUsd),
      holderCount: row.holderCount,
    })
  ) {
    return { score: null, marketFacts };
  }

  const c = row.components;
  const score: TokenScore = {
    tokenId: row.id,
    chain: row.chain as Chain,
    address: row.address,
    symbol: row.symbol,
    name: null,
    total: toNum(row.total),
    verdict: row.verdict,
    components: {
      safety: c.safety ?? 0,
      liquidity: c.liquidity ?? 0,
      organic: c.organic ?? 0,
      distribution: c.distribution ?? 0,
      momentum: c.momentum ?? 0,
      gecko: c.gecko ?? null,
      sentiment: c.sentiment ?? null,
      smartMoney: c.smartMoney ?? null,
    },
    blockers: row.blockers,
    warnings: row.warnings,
    priceUsd: toNumOrNull(row.priceUsd),
    liquidityUsd: toNumOrNull(row.liquidityUsd),
    volume24hUsd: toNumOrNull(row.volume24hUsd),
    marketCapUsd: toNumOrNull(row.marketCapUsd),
    holderCount: row.holderCount,
    ageHours: toNumOrNull(row.ageHours),
    priceChange24hPct: toNumOrNull(row.priceChange24hPct),
    sources: row.sources,
    scoredAt: row.scoredAt.toISOString(),
  };
  return { score, marketFacts };
}

/**
 * The `tokens` rows for one token. One, by id, for a Solana mint or the native alias.
 * For a Base contract, every row whose address is that contract in any letter-case: an
 * EVM address is case-insensitive, and rows have been written under more than one
 * spelling (see `token-address.ts`). Matched on the lowercased address rather than on a
 * list of spellings, so a row under a spelling nobody thought of is still found.
 *
 * Ordered so the first row is the one the page calls the token, the same one whatever
 * the URL said: the checksum spelling when it has a row, then lowercase, then by id.
 */
async function tokenRowsFor(db: Db, chain: Chain, address: string): Promise<Array<typeof tokens.$inferSelect>> {
  if (!isCaseInsensitiveAddress(chain, address)) {
    return db.select().from(tokens).where(eq(tokens.id, `${chain}:${address}`)).limit(1);
  }
  const lower = address.toLowerCase();
  const rows = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.chain, chain), sql`lower(${tokens.address}) = ${lower}`));
  const preferred = [canonicalTokenAddress(chain, address), lower];
  const rank = (spelling: string) => {
    const at = preferred.indexOf(spelling);
    return at === -1 ? preferred.length : at;
  };
  return rows.sort((a, b) => rank(a.address) - rank(b.address) || a.id.localeCompare(b.id));
}

type CachedReading = Awaited<ReturnType<typeof cachedScore>>;

/**
 * One reading out of several, for a token whose scores sit under more than one spelling
 * of its id: the newest public verdict, and the newest market facts. Newest, because that
 * is what the page claims to show ("the last thing we knew"), and it must not depend on
 * which spelling the visitor arrived with.
 */
function newestReading(readings: readonly CachedReading[]): CachedReading {
  let score: TokenScore | null = null;
  let marketFacts: TokenMarketFacts | null = null;
  for (const reading of readings) {
    // ISO timestamps from `toISOString()`: they sort as text.
    if (reading.score && (score === null || reading.score.scoredAt > score.scoredAt)) score = reading.score;
    if (reading.marketFacts && (marketFacts === null || reading.marketFacts.measuredAt > marketFacts.measuredAt)) {
      marketFacts = reading.marketFacts;
    }
  }
  return { score, marketFacts };
}

/** A token we have no row for still deserves a page — build the reference from the URL. */
function placeholderToken(chain: Chain, address: string, score: TokenScore | null): TokenRef {
  return {
    id: `${chain}:${address}`,
    chain,
    address,
    symbol: score?.symbol ?? `${address.slice(0, 4)}…${address.slice(-4)}`,
    name: score?.name ?? null,
    logoUrl: null,
    decimals: chain === "base" ? 18 : 9,
    lastPriceUsd: score?.priceUsd ?? null,
  };
}

/**
 * Everything on `/tokens/[chain]/[address]`.
 *
 * Public throughout: scores, fills and PnL on a token are the record. What is
 * never here is *why* an agent bought it — no config, no universe, no transcript.
 * `viewerId` only widens visibility to the viewer's own private agents, so an
 * operator can see their own position on a token page.
 *
 * A Base contract is one token whatever the letter-case of `address`: the rows under
 * every spelling of it are read together, so the result is the same for all of them.
 * Nothing stored is rewritten (see `token-address.ts`).
 */
export async function getTokenPage(
  chain: Chain,
  address: string,
  viewerId?: string | null,
): Promise<TokenPage | null> {
  if (!address || address.length < 3) return null;
  const db = await getDb();

  const tokenRows = await tokenRowsFor(db, chain, address);
  // Every id a row about this token may be keyed by: the token rows that exist, and the
  // spellings a score can have been written under before any trade made a row. One id
  // for a Solana mint; usually two for a Base contract.
  const ids = [...new Set([...tokenRows.map((row) => row.id), ...tokenIdSpellings(chain, address)])];

  // A private agent's holdings and fills are visible to its owner only.
  const visibleAgent = visibleAgentFor(viewerId);

  const since = new Date(Date.now() - FLOW_WINDOW_DAYS * 86_400_000);

  const [readings, histories, holderRows, tradeRows, flowRows] = await Promise.all([
    Promise.all(ids.map((id) => cachedScore(db, id))),
    // Public readings only: an agent's total moves with its clip size and paid signals,
    // and its verdict with its gates.
    Promise.all(ids.map((id) => getScoreHistory(id, { days: 30, universeKey: PUBLIC_UNIVERSE_KEY }))),
    db
      .select({
        agentId: agents.id,
        slug: agents.slug,
        name: agents.name,
        avatarSeed: agents.avatarSeed,
        mode: agents.mode,
        amountToken: positions.amountToken,
        avgCostUsd: positions.avgCostUsd,
      })
      .from(positions)
      .innerJoin(agents, eq(agents.id, positions.agentId))
      .where(and(inArray(positions.tokenId, ids), visibleAgent, ne(agents.status, "draft"))),
    db
      .select({ trade: trades, ownerId: agents.ownerId })
      .from(trades)
      .innerJoin(agents, eq(agents.id, trades.agentId))
      .where(and(inArray(trades.tokenId, ids), eq(trades.status, "filled"), visibleAgent))
      .orderBy(desc(trades.createdAt), desc(trades.id))
      .limit(RECENT_TRADE_LIMIT),
    db
      .select({
        buys: sql<number>`sum(case when ${trades.side} = 'buy' then 1 else 0 end)::int`,
        sells: sql<number>`sum(case when ${trades.side} = 'sell' then 1 else 0 end)::int`,
        netFlow: sql<string>`coalesce(sum(case when ${trades.side} = 'buy' then ${trades.amountUsd} else -${trades.amountUsd} end), 0)`,
      })
      .from(trades)
      .innerJoin(agents, eq(agents.id, trades.agentId))
      .where(
        and(inArray(trades.tokenId, ids), eq(trades.status, "filled"), gte(trades.createdAt, since), visibleAgent),
      ),
  ]);

  const { score, marketFacts } = newestReading(readings);
  // Oldest first, as one id's history already is.
  const history =
    histories.length === 1 ? histories[0] : histories.flat().sort((a, b) => a.at.localeCompare(b.at));

  const tokenRow = tokenRows[0];
  // Nothing known at all and no score: still a valid page, just an empty one.
  const token = tokenRow ? toTokenRef(tokenRow) : placeholderToken(chain, address, score);

  const mark =
    token.lastPriceUsd ??
    // A second row for the same contract may be the one the marks pass has priced.
    tokenRows.slice(1).map((row) => toTokenRef(row).lastPriceUsd).find((price) => price !== null) ??
    score?.priceUsd ??
    null;

  // One line per agent. An agent can hold one contract under two stored spellings, and
  // that is one holding: the amounts add up, at their weighted average cost.
  const held = new Map<
    string,
    { agent: Pick<AgentCard, "id" | "slug" | "name" | "avatarSeed" | "mode">; amount: number; avgCostUsd: number }
  >();
  for (const row of holderRows) {
    const amount = toNum(row.amountToken);
    if (!(amount > 1e-12)) continue;
    const avgCostUsd = toNum(row.avgCostUsd);
    const existing = held.get(row.agentId);
    if (existing) {
      const total = existing.amount + amount;
      existing.avgCostUsd = (existing.amount * existing.avgCostUsd + amount * avgCostUsd) / total;
      existing.amount = total;
      continue;
    }
    held.set(row.agentId, {
      agent: { id: row.agentId, slug: row.slug, name: row.name, avatarSeed: row.avatarSeed, mode: row.mode },
      amount,
      avgCostUsd,
    });
  }
  const holders = [...held.values()]
    .map((holding) => {
      const u = unrealized(holding.amount, holding.avgCostUsd, mark);
      return { agent: holding.agent, valueUsd: u.valueUsd, unrealizedPnlPct: u.pnlPct };
    })
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  const tokenMap = await loadTokens(db, tradeRows.map((r) => r.trade.tokenId));
  const recentTrades: TradeRow[] = tradeRows.flatMap((r) => {
    const ref = tokenMap.get(r.trade.tokenId) ?? token;
    return [toTradeRow(r.trade, ref, { isOwner: Boolean(viewerId) && r.ownerId === viewerId })];
  });

  const flow = flowRows[0];

  return {
    token,
    score,
    marketFacts,
    history,
    holders,
    recentTrades,
    stats: {
      agentBuys30d: Number(flow?.buys ?? 0),
      agentSells30d: Number(flow?.sells ?? 0),
      netFlowUsd30d: toNum(flow?.netFlow ?? "0"),
    },
  };
}

/** Price series pulled out of score history, for the token page sparkline. */
export function priceSeries(history: readonly ScoreHistoryPoint[]): Array<{ at: string; priceUsd: number }> {
  return history.flatMap((p) => (p.priceUsd === null ? [] : [{ at: p.at, priceUsd: p.priceUsd }]));
}

/**
 * ⌘K token search. Symbol, name or address, over tokens the platform has actually
 * seen — the palette should only ever jump to a page with something on it.
 *
 * An empty query lists the table (bounded) rather than returning nothing, because
 * the palette filters its own items and needs a set to filter.
 */
export async function searchTokens(query: string, limit = 8): Promise<TokenRef[]> {
  const q = query.trim().toLowerCase();
  const db = await getDb();
  const like = `%${q}%`;
  const rows = await db
    .select()
    .from(tokens)
    .where(
      q.length === 0
        ? undefined
        : or(
            sql`lower(${tokens.symbol}) like ${like}`,
            sql`lower(${tokens.name}) like ${like}`,
            sql`lower(${tokens.address}) like ${like}`,
          ),
    )
    // Shortest symbol first: "SOL" should beat "SOLANA-INU" on the query "sol".
    .orderBy(asc(sql`length(${tokens.symbol})`), asc(tokens.symbol))
    .limit(Math.min(50, Math.max(1, limit)));
  return rows.map(toTokenRef);
}

/**
 * Slug and name for a set of agent ids, so a token page's trade rows can link to
 * whoever made them. Public fields only — no config, ever.
 */
export async function agentRefs(ids: readonly string[]): Promise<Record<string, { slug: string; name: string }>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return {};
  const db = await getDb();
  const rows = await db
    .select({ id: agents.id, slug: agents.slug, name: agents.name })
    .from(agents)
    .where(inArray(agents.id, unique));
  return Object.fromEntries(rows.map((row) => [row.id, { slug: row.slug, name: row.name }]));
}

export interface BlocklistTarget {
  id: string;
  slug: string;
  name: string;
  /** Already on this agent's blocklist — the menu item is then inert. */
  blocked: boolean;
  /** Trades this token's chain. An agent that does not has nothing to block here. */
  onChain: boolean;
}

/**
 * The viewer's own agents, and whether each already blocks this token.
 *
 * Reading `config.universe.blocklist` here is not a privacy hole: these are the
 * viewer's own agents, and the only thing that reaches the client is a boolean
 * per agent — never the list, never anyone else's.
 */
export async function myAgentsForBlocklist(
  viewerId: string,
  chain: Chain,
  address: string,
): Promise<BlocklistTarget[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: agents.id, slug: agents.slug, name: agents.name, config: agents.config })
    .from(agents)
    .where(eq(agents.ownerId, viewerId))
    .orderBy(asc(agents.name));

  const wanted = address.toLowerCase();
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    blocked: (row.config?.universe?.blocklist ?? []).some(
      (entry) => entry.chain === chain && entry.address.toLowerCase() === wanted,
    ),
    onChain: (row.config?.chains ?? []).includes(chain),
  }));
}

/** Longest trade id a `?trade=` link can carry; anything longer is not one of ours. */
export const MAX_TRADE_ID_LENGTH = 64;

/**
 * The one fill a `?trade=<id>` link names — a fill notification's "see the receipt", an
 * admin's Recent fills row — when it may be shown on this token's page.
 *
 * Same visibility as the table it lands in (`visibleAgentFor`): a public agent's fill,
 * or one of the viewer's own. It must also be on *this* token and filled. Any miss is
 * `null`, and the caller says the same thing for every miss, so a private trade's id
 * reveals nothing about whether it exists.
 */
export async function getTokenTrade(
  tradeId: string,
  token: TokenRef,
  viewerId: string | null,
): Promise<TradeRow | null> {
  if (tradeId.length === 0 || tradeId.length > MAX_TRADE_ID_LENGTH) return null;
  const db = await getDb();
  const [row] = await db
    .select({ trade: trades, ownerId: agents.ownerId })
    .from(trades)
    .innerJoin(agents, eq(agents.id, trades.agentId))
    .where(
      and(
        eq(trades.id, tradeId),
        // "This token" in any spelling of its address, as `getTokenPage` lists its fills.
        inArray(trades.tokenId, [...new Set([token.id, ...tokenIdSpellings(token.chain, token.address)])]),
        eq(trades.status, "filled"),
        visibleAgentFor(viewerId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return toTradeRow(row.trade, token, { isOwner: Boolean(viewerId) && row.ownerId === viewerId });
}

/** A private agent's holdings and fills are visible to its owner only. */
function visibleAgentFor(viewerId: string | null | undefined) {
  return viewerId ? or(eq(agents.isPublic, true), eq(agents.ownerId, viewerId)) : eq(agents.isPublic, true);
}
