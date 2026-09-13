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
 */
import { and, asc, eq } from "drizzle-orm";
import { agents, getDb, positions, tokens, trades } from "@/db";
import { getPortfolio, toRiskPortfolio } from "@/lib/agent/portfolio";
import { getTokenScore } from "@/lib/tokens";
import { toNum } from "@/lib/money";
import { proposalExpiresAt, sweepBeforeRead } from "@/lib/trading/proposals";
import { riskGuard, type OrderIntent, type RiskPortfolio } from "@/lib/trading/risk";
import type { AgentConfig } from "@/db/schema";
import type { Chain, PendingProposalsSummary, ProposalRow, TokenScore } from "@/server/types";
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
  const score = trade.side === "buy" ? await scoreQuietly(chain, token.address, token.symbol, agent.config) : null;
  const verdict = riskGuard({ id: agent.id, mode: agent.mode, config: agent.config }, portfolio, order, score);

  return {
    ...toTradeRow(trade, toTokenRef(token)),
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
