/**
 * The agent's book: cash, marked positions, equity, and today's trade count.
 *
 * Paper cash is recomputed from the trade ledger (see `trading/paper.ts`); live cash
 * is the agent's USDC balance across its Privy server wallets.
 */
import { nanoid } from "nanoid";
import { exitDistances } from "@/lib/pnl";
import { and, eq, gte } from "drizzle-orm";
import { agents, equitySnapshots, getDb, positions, tokens, trades, wallets } from "@/db";
import type { AgentConfig } from "@/db/schema";
import type { Position, TokenRef } from "@/server/types";
import type { AgentWalletRef } from "@/lib/x402/types";
import { getMarks } from "@/lib/trading/prices";
import { getPaperCash } from "@/lib/trading/paper";
import { loadCachedScores } from "@/lib/trading/score-cache";
import { toTokenRef } from "@/lib/trading/tokens";
import type { RiskPortfolio } from "@/lib/trading/risk";

export interface Portfolio {
  agentId: string;
  mode: "paper" | "live";
  cashUsd: number;
  equityUsd: number;
  positions: Position[];
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  tradesToday: number;
  startingUsd: number;
}

export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** USDC across the agent's live wallets. Missing/failed lookups count as zero. */
async function getLiveCash(walletRefs: AgentWalletRef[]): Promise<number> {
  const usable = walletRefs.filter((w) => !w.walletId.startsWith("paper_"));
  if (usable.length === 0) return 0;
  const { privy } = await import("@/lib/privy");
  const client = privy();
  let total = 0;
  for (const w of usable) {
    try {
      const res = await client
        .wallets()
        .balance.get(w.walletId, { asset: "usdc", chain: w.chain === "solana" ? "solana" : "base" });
      for (const b of res.balances) {
        const raw = Number(b.raw_value);
        if (Number.isFinite(raw)) total += raw / 10 ** b.raw_value_decimals;
      }
    } catch {
      // a wallet we cannot read contributes nothing rather than failing the run
    }
  }
  return total;
}

export async function getAgentWallets(agentId: string): Promise<AgentWalletRef[]> {
  const db = await getDb();
  const rows = await db.select().from(wallets).where(eq(wallets.agentId, agentId));
  return rows.map((r) => ({ chain: r.chain, walletId: r.id, address: r.address }));
}

export async function getPortfolio(agentId: string): Promise<Portfolio> {
  const db = await getDb();
  const agentRows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  const agent = agentRows[0];
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const held = await db
    .select({ position: positions, token: tokens })
    .from(positions)
    .innerJoin(tokens, eq(positions.tokenId, tokens.id))
    .where(eq(positions.agentId, agentId));

  const marks = await getMarks(held.map((h) => h.token.id));
  // Display/prompt only: the latest cached score per holding, so "74 at entry → 41 now"
  // can be shown without rescoring. Buys still go through getTokenScore.
  const cachedScores = await loadCachedScores(held.map((h) => h.token.id));

  let unrealizedPnlUsd = 0;
  let realizedPnlUsd = 0;
  let positionsValue = 0;
  const view: Position[] = held
    .filter((h) => Number(h.position.amountToken) > 0)
    .map((h) => {
      const token: TokenRef = toTokenRef(h.token);
      const amountToken = Number(h.position.amountToken);
      const avgCostUsd = Number(h.position.avgCostUsd);
      const mark = marks.get(h.token.id) ?? null;
      const valueUsd = mark === null ? null : amountToken * mark;
      const costBasis = amountToken * avgCostUsd;
      const unrealized = valueUsd === null ? null : valueUsd - costBasis;
      const realized = Number(h.position.realizedPnlUsd);
      realizedPnlUsd += realized;
      if (valueUsd !== null) positionsValue += valueUsd;
      if (unrealized !== null) unrealizedPnlUsd += unrealized;
      return {
        token: { ...token, lastPriceUsd: mark ?? token.lastPriceUsd },
        amountToken,
        avgCostUsd,
        markPriceUsd: mark,
        valueUsd,
        unrealizedPnlUsd: unrealized,
        unrealizedPnlPct: unrealized === null || costBasis === 0 ? null : (unrealized / costBasis) * 100,
        realizedPnlUsd: realized,
        openedAt: h.position.openedAt?.toISOString() ?? null,
        peakPriceUsd: h.position.peakPriceUsd === null ? null : Number(h.position.peakPriceUsd),
        entryScore: h.position.entryScore === null ? null : Number(h.position.entryScore),
        entryLiquidityUsd: h.position.entryLiquidityUsd === null ? null : Number(h.position.entryLiquidityUsd),
        currentScore: cachedScores.get(h.token.id)?.total ?? null,
        ...exitDistances({
          unrealizedPct: unrealized === null || costBasis === 0 ? null : (unrealized / costBasis) * 100,
          stopLossPct: agent.config.risk.stopLossPct,
          takeProfitPct: agent.config.risk.takeProfitPct,
        }),
      };
    });

  // Realized PnL from fully-closed positions still lives on the (zero-amount) rows.
  for (const h of held) {
    if (Number(h.position.amountToken) > 0) continue;
    realizedPnlUsd += Number(h.position.realizedPnlUsd);
  }

  const cashUsd =
    agent.mode === "paper" ? await getPaperCash(agentId) : await getLiveCash(await getAgentWallets(agentId));

  const todayRows = await db
    .select({ id: trades.id })
    .from(trades)
    .where(and(eq(trades.agentId, agentId), eq(trades.status, "filled"), gte(trades.createdAt, startOfUtcDay())));

  return {
    agentId,
    mode: agent.mode,
    cashUsd,
    equityUsd: cashUsd + positionsValue,
    positions: view,
    realizedPnlUsd,
    unrealizedPnlUsd,
    tradesToday: todayRows.length,
    startingUsd: Number(agent.paperStartingUsd),
  };
}

/** Shape the risk guard consumes. */
export function toRiskPortfolio(portfolio: Portfolio): RiskPortfolio {
  return {
    cashUsd: portfolio.cashUsd,
    equityUsd: portfolio.equityUsd,
    tradesToday: portfolio.tradesToday,
    positions: portfolio.positions.map((p) => ({
      tokenId: p.token.id,
      chain: p.token.chain,
      address: p.token.address,
      symbol: p.token.symbol,
      amountToken: p.amountToken,
      valueUsd: p.valueUsd,
    })),
  };
}

/** Writes one `equity_snapshots` row. Called at the end of every run. */
export async function snapshotEquity(portfolio: Portfolio): Promise<void> {
  const db = await getDb();
  await db.insert(equitySnapshots).values({
    id: nanoid(),
    agentId: portfolio.agentId,
    equityUsd: portfolio.equityUsd.toFixed(6),
    cashUsd: portfolio.cashUsd.toFixed(6),
  });
}

/** Compact, model-friendly rendering used by both the tick prompt and `get_portfolio`. */
export function describePortfolio(portfolio: Portfolio, config: AgentConfig): string {
  const lines = [
    `Cash: $${portfolio.cashUsd.toFixed(2)} · Equity: $${portfolio.equityUsd.toFixed(2)} · Mode: ${portfolio.mode}`,
    `Realized PnL $${portfolio.realizedPnlUsd.toFixed(2)} · Unrealized PnL $${portfolio.unrealizedPnlUsd.toFixed(2)}`,
    `Trades today: ${portfolio.tradesToday}/${config.risk.maxDailyTrades}`,
  ];
  if (portfolio.positions.length === 0) {
    lines.push("Positions: none.");
  } else {
    lines.push("Positions:");
    for (const p of portfolio.positions) {
      const value = p.valueUsd === null ? "unpriced" : `$${p.valueUsd.toFixed(2)}`;
      const pnl = p.unrealizedPnlPct === null ? "" : ` (${p.unrealizedPnlPct >= 0 ? "+" : ""}${p.unrealizedPnlPct.toFixed(1)}%)`;
      lines.push(
        `  ${p.token.symbol} [${p.token.chain}] ${p.amountToken.toLocaleString("en-US", { maximumFractionDigits: 6 })} · ${value}${pnl} · avg cost $${p.avgCostUsd.toPrecision(6)} · ${p.token.address}`,
      );
    }
  }
  return lines.join("\n");
}
