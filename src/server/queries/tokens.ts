import "server-only";
import { and, asc, desc, eq, gte, ne, or, sql } from "drizzle-orm";
import { agents, getDb, positions, tokenScores, tokens, trades, type Db } from "@/db";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { toNum, toNumOrNull } from "@/lib/money";
import { unrealized } from "@/lib/pnl";
import { getScoreHistory } from "@/lib/tokens/history";
import { universeKey } from "@/lib/tokens";
import type { AgentCard, Chain, ScoreHistoryPoint, TokenPage, TokenRef, TokenScore, TradeRow } from "@/server/types";
import { loadTokens, toTokenRef, toTradeRow } from "./_shared";

/**
 * Token pages are public, so every score on one is computed under the platform's
 * **default** universe — never an agent's. An agent's gates are part of its
 * strategy: a public blocker reading "liquidity below floor" computed against
 * someone's private threshold would publish that threshold.
 */
const PUBLIC_UNIVERSE = DEFAULT_AGENT_CONFIG.universe;
const PUBLIC_UNIVERSE_KEY = universeKey(PUBLIC_UNIVERSE);

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
async function cachedScore(db: Db, id: string): Promise<TokenScore | null> {
  const [row] = await db.select().from(tokenScores).where(eq(tokenScores.id, id)).limit(1);
  if (!row) return null;
  // A row scored under a different universe carries that universe's verdict and
  // blockers. Reusing it here would leak another operator's thresholds.
  if (row.universeKey !== PUBLIC_UNIVERSE_KEY) return null;

  const c = row.components;
  return {
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
      sentiment: c.sentiment ?? null,
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
 */
export async function getTokenPage(
  chain: Chain,
  address: string,
  viewerId?: string | null,
): Promise<TokenPage | null> {
  if (!address || address.length < 3) return null;
  const db = await getDb();
  const id = `${chain}:${address}`;

  const [tokenRows, score] = await Promise.all([
    db.select().from(tokens).where(eq(tokens.id, id)).limit(1),
    cachedScore(db, id),
  ]);

  const tokenRow = tokenRows[0];
  // Nothing known at all and no score: still a valid page, just an empty one.
  const token = tokenRow ? toTokenRef(tokenRow) : placeholderToken(chain, address, score);

  // A private agent's holdings and fills are visible to its owner only.
  const visibleAgent = viewerId
    ? or(eq(agents.isPublic, true), eq(agents.ownerId, viewerId))
    : eq(agents.isPublic, true);

  const since = new Date(Date.now() - FLOW_WINDOW_DAYS * 86_400_000);

  const [history, holderRows, tradeRows, flowRows] = await Promise.all([
    getScoreHistory(id, { days: 30 }),
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
      .where(and(eq(positions.tokenId, id), visibleAgent, ne(agents.status, "draft"))),
    db
      .select({ trade: trades })
      .from(trades)
      .innerJoin(agents, eq(agents.id, trades.agentId))
      .where(and(eq(trades.tokenId, id), eq(trades.status, "filled"), visibleAgent))
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
        and(eq(trades.tokenId, id), eq(trades.status, "filled"), gte(trades.createdAt, since), visibleAgent),
      ),
  ]);

  const mark = token.lastPriceUsd ?? score?.priceUsd ?? null;

  const holders = holderRows
    .filter((row) => toNum(row.amountToken) > 1e-12)
    .map((row) => {
      const amount = toNum(row.amountToken);
      const u = unrealized(amount, toNum(row.avgCostUsd), mark);
      return {
        agent: {
          id: row.agentId,
          slug: row.slug,
          name: row.name,
          avatarSeed: row.avatarSeed,
          mode: row.mode,
        } satisfies Pick<AgentCard, "id" | "slug" | "name" | "avatarSeed" | "mode">,
        valueUsd: u.valueUsd,
        unrealizedPnlPct: u.pnlPct,
      };
    })
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  const tokenMap = await loadTokens(db, tradeRows.map((r) => r.trade.tokenId));
  const recentTrades: TradeRow[] = tradeRows.flatMap((r) => {
    const ref = tokenMap.get(r.trade.tokenId) ?? token;
    return [toTradeRow(r.trade, ref)];
  });

  const flow = flowRows[0];

  return {
    token,
    score,
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
 * ⌘K token search. Symbol or address, over tokens we have actually seen — the
 * palette should jump to a page with something on it.
 */
export async function searchTokens(query: string, limit = 8): Promise<TokenRef[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const db = await getDb();
  const like = `%${q.toLowerCase()}%`;
  const rows = await db
    .select()
    .from(tokens)
    .where(
      or(
        sql`lower(${tokens.symbol}) like ${like}`,
        sql`lower(${tokens.name}) like ${like}`,
        sql`lower(${tokens.address}) like ${like}`,
      ),
    )
    .orderBy(asc(sql`length(${tokens.symbol})`), asc(tokens.symbol))
    .limit(Math.min(25, Math.max(1, limit)));
  return rows.map(toTokenRef);
}

export interface BlocklistTarget {
  id: string;
  slug: string;
  name: string;
  /** Already on this agent's blocklist — the menu item is then inert. */
  blocked: boolean;
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
  }));
}
