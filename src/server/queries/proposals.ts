import "server-only";
/**
 * Reads for approval mode.
 *
 * Two rules shape this file:
 *
 * - **Owner only.** A proposal carries the agent's rationale *before* it is public, and
 *   the reason it may no longer be valid quotes the agent's own thresholds — both are
 *   strategy. Every read here returns nothing for anyone but the owner.
 * - **Never offer a stale Approve.** Each read sweeps expired proposals first and then
 *   re-runs the risk guard read-only, so a card whose Approve button is enabled is one
 *   the runtime would actually accept.
 *
 * Every open proposal also carries a live market read ({@link marketStats}) — the
 * deepest pool's buyers, reserve and move, plus the GT Score and a price line. It is
 * free data behind the GeckoTerminal rate limiter, it is fetched per proposal in
 * parallel, and every piece of it is allowed to fail: a proposal with no market read
 * is a card full of dashes, never a failed page.
 */
import { and, asc, eq } from "drizzle-orm";
import { agents, getDb, positions, tokens, trades } from "@/db";
import { getPortfolio, toRiskPortfolio } from "@/lib/agent/portfolio";
import { getTokenScore } from "@/lib/tokens";
import { getScoreHistory } from "@/lib/tokens/history";
import { deepestGeckoPool, getGeckoTokenInfo, getGeckoTokenPools } from "@/lib/tokens/providers/geckoterminal";
import { deriveSafety } from "@/components/agents/proposals/proposal-stats";
import { toNum } from "@/lib/money";
import { proposalExpiresAt, sweepBeforeRead } from "@/lib/trading/proposals";
import { riskGuard, type OrderIntent, type RiskPortfolio } from "@/lib/trading/risk";
import type { AgentConfig } from "@/db/schema";
import type {
  Chain,
  PendingProposalsSummary,
  ProposalRow,
  ProposalStats,
  TokenScore,
  TradeScore,
} from "@/server/types";
import { toTokenRef, toTradeRow } from "./_shared";

type TradeRecord = typeof trades.$inferSelect;
type AgentRecord = typeof agents.$inferSelect;
type TokenRecord = typeof tokens.$inferSelect;

/** Scores a token for a validity check. A scoring outage is not a reason to lie. */
async function scoreQuietly(
  chain: Chain,
  address: string,
  symbol: string,
  config: AgentConfig,
): Promise<TokenScore | null> {
  try {
    return await getTokenScore({
      chain,
      address,
      universe: config.universe,
      maxTradeUsd: config.risk.maxTradeUsd,
      dataSources: config.dataSources,
      symbolHint: symbol,
    });
  } catch {
    return null;
  }
}

/** Anything a free provider can refuse. A refusal is a dash on the card, never a throw. */
async function quietly<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

/** How many recorded prices the card's sparkline draws. */
const SPARKLINE_POINTS = 24;

/**
 * What the token looks like *now*, beside the frozen score the agent decided on.
 *
 * All of it is optional and all of it is free: the deepest GeckoTerminal pool (cached
 * for a minute by the provider, and behind its rate limiter — never bypassed), the
 * recorded price history, and, only when the snapshot carries no GT Score, one token
 * info lookup. A launch-day proposal lives for five minutes, so the point of this read
 * is the two numbers nothing else has: who is buying in the last five minutes, and how
 * deep the pool they would route through actually is.
 */
async function marketStats(
  chain: Chain,
  token: TokenRecord,
  frozen: TradeScore | null,
  now: number,
): Promise<Omit<ProposalStats, "safety">> {
  const frozenGecko = typeof frozen?.components?.gecko === "number" ? frozen.components.gecko : null;

  const [pools, history] = await Promise.all([
    quietly(() => getGeckoTokenPools(chain, token.address), []),
    quietly(() => getScoreHistory(token.id, { days: 1, limit: 1_000 }), []),
  ]);

  const pool = deepestGeckoPool(pools, token.address);
  // Age is the *token's*, so it comes from the earliest pool, not the deepest one — a
  // token an hour old can spawn a new pool a minute ago.
  const firstPoolAt = pools.reduce<number | null>(
    (earliest, candidate) =>
      candidate.createdAtMs === null ? earliest : earliest === null ? candidate.createdAtMs : Math.min(earliest, candidate.createdAtMs),
    null,
  );
  const ageMinutes =
    firstPoolAt !== null
      ? Math.max(0, (now - firstPoolAt) / 60_000)
      : typeof frozen?.ageHours === "number"
        ? frozen.ageHours * 60
        : null;

  // Only when the snapshot has none: by this point the scoring pass has usually already
  // warmed the provider's ten-minute info cache, so this is a cache hit or a token
  // GeckoTerminal genuinely has no record of.
  const gtScore =
    frozenGecko ?? (await quietly(() => getGeckoTokenInfo(chain, token.address), null))?.gtScore ?? null;

  const sparkline = history
    .map((point) => point.priceUsd)
    .filter((price): price is number => typeof price === "number" && Number.isFinite(price))
    .slice(-SPARKLINE_POINTS);

  return {
    ageMinutes,
    buyers5m: pool?.buyersM5 ?? null,
    buyersH1: pool?.buyersH1 ?? null,
    reserveUsd: pool?.reserveUsd ?? null,
    // `GeckoPool` carries no m5 price change today — see `ProposalStats`.
    priceChangeM5Pct: null,
    priceChangeH1Pct: pool?.priceChange1hPct ?? null,
    gtScore,
    sparkline,
  };
}

async function buildRow(
  trade: TradeRecord,
  agent: AgentRecord,
  token: TokenRecord,
  portfolio: RiskPortfolio,
): Promise<ProposalRow> {
  const chain = trade.chain as Chain;
  const requestedUsd = toNum(trade.requestedUsd ?? trade.amountUsd);
  const order: OrderIntent = {
    chain,
    side: trade.side,
    tokenId: token.id,
    tokenAddress: token.address,
    symbol: token.symbol,
    amountUsd: requestedUsd,
  };
  const base = toTradeRow(trade, toTokenRef(token));

  // The guard re-check and the market read are independent, so they race rather than
  // queue: an operator with three proposals open waits for the slowest one, not the sum.
  const [score, stats] = await Promise.all([
    trade.side === "buy" ? scoreQuietly(chain, token.address, token.symbol, agent.config) : Promise.resolve(null),
    marketStats(chain, token, base.score, Date.now()),
  ]);
  const verdict = riskGuard({ id: agent.id, mode: agent.mode, config: agent.config }, portfolio, order, score);

  return {
    ...base,
    ...stats,
    // The fresh re-score is the last resort for a GT Score: the frozen snapshot is what
    // the agent decided on, and it wins when it has one.
    gtScore: stats.gtScore ?? score?.components.gecko ?? null,
    ageMinutes: stats.ageMinutes ?? (typeof score?.ageHours === "number" ? score.ageHours * 60 : null),
    // Badges read the *frozen* snapshot: the operator is judging the call the agent
    // made, not a re-score taken seconds later under the same rules.
    safety: deriveSafety(base.score),
    expiresAt: proposalExpiresAt(trade.proposedAt ?? trade.createdAt, agent.config).toISOString(),
    stillValid: verdict.ok,
    invalidReason: verdict.ok ? null : verdict.reason,
    agentSlug: agent.slug,
    agentName: agent.name,
    agentAvatarSeed: agent.avatarSeed,
  };
}

/**
 * Every proposal waiting on this agent's owner, oldest first (the one closest to
 * expiring is the one to decide). Empty for anyone who is not the owner.
 */
export async function listProposals(agentId: string, viewerId?: string | null): Promise<ProposalRow[]> {
  if (!viewerId) return [];
  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent || agent.ownerId !== viewerId) return [];

  await sweepBeforeRead({ agentId });

  const rows = await db
    .select({ trade: trades, token: tokens })
    .from(trades)
    .innerJoin(tokens, eq(tokens.id, trades.tokenId))
    .where(and(eq(trades.agentId, agentId), eq(trades.status, "proposed")))
    .orderBy(asc(trades.proposedAt));
  if (rows.length === 0) return [];

  const portfolio = toRiskPortfolio(await getPortfolio(agentId));
  // Scored in parallel: one proposal's provider timeout must not queue behind another's.
  return Promise.all(rows.map((row) => buildRow(row.trade, agent, row.token, portfolio)));
}

/** One proposal by id, owner-gated. Used by the notifications page's inline cards. */
export async function getProposal(tradeId: string, viewerId?: string | null): Promise<ProposalRow | null> {
  if (!viewerId) return null;
  const db = await getDb();
  const [row] = await db
    .select({ trade: trades, agent: agents, token: tokens })
    .from(trades)
    .innerJoin(agents, eq(agents.id, trades.agentId))
    .innerJoin(tokens, eq(tokens.id, trades.tokenId))
    .where(eq(trades.id, tradeId))
    .limit(1);
  if (!row || row.agent.ownerId !== viewerId) return null;
  if (row.trade.status !== "proposed") return null;
  const portfolio = toRiskPortfolio(await getPortfolio(row.agent.id));
  return buildRow(row.trade, row.agent, row.token, portfolio);
}

/**
 * Every proposal waiting on this *user*, across all their agents. This is what the
 * notifications page renders inline, so a proposal notification is actionable there.
 */
export async function listMyProposals(viewerId?: string | null): Promise<ProposalRow[]> {
  if (!viewerId) return [];
  await sweepBeforeRead({ ownerId: viewerId });

  const db = await getDb();
  const rows = await db
    .select({ trade: trades, agent: agents, token: tokens })
    .from(trades)
    .innerJoin(agents, eq(agents.id, trades.agentId))
    .innerJoin(tokens, eq(tokens.id, trades.tokenId))
    .where(and(eq(trades.ownerId, viewerId), eq(trades.status, "proposed")))
    .orderBy(asc(trades.proposedAt));
  if (rows.length === 0) return [];

  // One portfolio read per agent, not per proposal.
  const byAgent = new Map<string, RiskPortfolio>();
  for (const agentId of new Set(rows.map((r) => r.agent.id))) {
    byAgent.set(agentId, toRiskPortfolio(await getPortfolio(agentId)));
  }
  return Promise.all(
    rows.map((row) => buildRow(row.trade, row.agent, row.token, byAgent.get(row.agent.id)!)),
  );
}

/**
 * The island's poll: a count and the newest proposal, with no scoring or guard work —
 * this runs every 15 seconds for every signed-in user, so it stays two cheap queries.
 */
export async function getPendingProposalsSummary(viewerId?: string | null): Promise<PendingProposalsSummary> {
  if (!viewerId) return { count: 0, latest: null };
  await sweepBeforeRead({ ownerId: viewerId });

  const db = await getDb();
  const rows = await db
    .select({
      tradeId: trades.id,
      agentId: agents.id,
      agentSlug: agents.slug,
      agentName: agents.name,
      config: agents.config,
      side: trades.side,
      symbol: tokens.symbol,
      requestedUsd: trades.requestedUsd,
      amountUsd: trades.amountUsd,
      proposedAt: trades.proposedAt,
      createdAt: trades.createdAt,
    })
    .from(trades)
    .innerJoin(agents, eq(agents.id, trades.agentId))
    .innerJoin(tokens, eq(tokens.id, trades.tokenId))
    .where(and(eq(trades.ownerId, viewerId), eq(trades.status, "proposed")))
    .orderBy(asc(trades.proposedAt));

  const newest = rows.at(-1);
  return {
    count: rows.length,
    latest: newest
      ? {
          tradeId: newest.tradeId,
          agentId: newest.agentId,
          agentSlug: newest.agentSlug,
          agentName: newest.agentName,
          side: newest.side,
          symbol: newest.symbol,
          requestedUsd: toNum(newest.requestedUsd ?? newest.amountUsd),
          expiresAt: proposalExpiresAt(newest.proposedAt ?? newest.createdAt, newest.config).toISOString(),
        }
      : null,
  };
}

/** The token amount an agent currently holds — the manual sell form's ceiling. */
export async function getHeldAmount(agentId: string, tokenId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ amountToken: positions.amountToken })
    .from(positions)
    .where(and(eq(positions.agentId, agentId), eq(positions.tokenId, tokenId)))
    .limit(1);
  return toNum(row?.amountToken);
}
