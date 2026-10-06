import "server-only";
/**
 * Reads for `/home` — the signed-in landing page.
 *
 * Two rules shape this file:
 *
 * - **Everything is scoped to one user.** Every query here takes `userId` and
 *   filters on `agents.ownerId` / `trades.ownerId`. There is no "viewer" concept
 *   and no public variant: Home is your own book, and nothing in it is derived
 *   from anyone else's agents.
 * - **Read-only.** No mutation, no scoring, no network beyond the wallet balance
 *   lookup (which never throws: a wallet it could not read comes back flagged, and
 *   the page says the balance is unavailable rather than printing a zero). A landing
 *   page must not be able to fail because a provider is having a bad afternoon.
 */
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { agents, equitySnapshots, getDb, positions, tokens, trades } from "@/db";
import { getUserWalletBalances } from "@/lib/wallets";
import { splitPnl, toNum } from "@/lib/money";
import { proposalExpiresAt, sweepBeforeRead } from "@/lib/trading/proposals";
import {
  attachRealizedPnl,
  buildAgentCards,
  loadAgentAggregates,
  loadDailyCloses,
  snapshotInCurrentMode,
  toTokenRef,
  toTradeRow,
} from "./_shared";
import type { AgentCard, Chain, TradeRow } from "@/server/types";

/** One point on the combined equity curve: every agent's book, summed. */
export interface HomeEquityPoint {
  at: string;
  equityUsd: number;
}

export interface HomeCashRow {
  chain: Chain;
  address: string;
  usdcUsd: number;
  nativeAsset: string;
  nativeAmount: number;
}

/**
 * One side of the book. Real money and paper are never summed: a paper agent is born
 * holding a $10,000 notional, and adding that to a $12 wallet does not make a bigger
 * number, it makes a meaningless one (the same rule as `/money`).
 */
export interface HomeBook {
  /** Latest equity across this side's agents. */
  equityUsd: number;
  /** Realised + unrealised — the `/money` definition, so the headline adds up to its wells. */
  pnlUsd: number;
  /** Against the capital each agent started this book with. Null when nothing has a baseline. */
  pnlPct: number | null;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  /** This side's combined equity at up to 60 daily closes, oldest first. Fewer than 2 = no chart. */
  sparkline: HomeEquityPoint[];
}

export interface HomeOverview {
  /** Spendable USDC in the user's own embedded wallets, summed across chains. */
  cashUsd: number;
  /**
   * True when a wallet's balance could not be read just now. `cashUsd` and
   * `totalEquityUsd` are then missing whatever that wallet holds, and the page says the
   * balance is unavailable instead of printing them as the answer.
   */
  cashUnavailable: boolean;
  cashByWallet: HomeCashRow[];
  /** True when the user has no embedded wallet recorded yet (pre-first-login sync). */
  hasWallets: boolean;
  /** Latest equity across **live** agents — real capital that is already working. */
  allocatedUsd: number;
  /** Cash + live allocated. Real money only; paper is in `paper` and never added here. */
  totalEquityUsd: number;
  /** Live agents' realised + unrealised, so it reconciles with the two fields below. */
  pnlUsd: number;
  /** Against the capital each live agent started with. Null when nothing has a baseline. */
  pnlPct: number | null;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  /** Live agents' combined equity at up to 60 daily closes, oldest first. Fewer than 2 = no chart. */
  sparkline: HomeEquityPoint[];
  /** The simulated side, kept apart so it can be shown and labelled as such. */
  paper: HomeBook;
  agents: AgentCard[];
  counts: { total: number; live: number; paper: number; active: number; paused: number };
}

export type HomeActivityKind = "buy" | "sell" | "exit" | "proposal";

export interface HomeActivityItem {
  id: string;
  kind: HomeActivityKind;
  at: string;
  /** Set for proposals only — the clock the owner is racing. */
  expiresAt: string | null;
  agent: { id: string; slug: string; name: string; avatarSeed: string | null; mode: "paper" | "live" };
  trade: TradeRow;
}

/** The chart's reach: one point per UTC day an agent was marked, and this many of them. */
const SPARKLINE_POINTS = 60;
const DAY_MS = 86_400_000;

/** The agent rows this user owns, newest first. Shared by both reads. */
async function ownedAgents(userId: string) {
  const db = await getDb();
  return db.select().from(agents).where(eq(agents.ownerId, userId)).orderBy(desc(agents.createdAt));
}

/**
 * Sum every agent's daily closes into one curve, a point per UTC day.
 *
 * Each agent contributes from its own first snapshot onward, forward-filled on
 * every day any agent was marked. That makes the curve read as "capital at
 * work over time" — a new agent is a step up, because it is. The *return* number
 * deliberately does not come from this curve (see `pnlUsd`), so a deposit can
 * never be mistaken for a gain.
 *
 * `byAgent` holds each agent's last snapshot of each UTC day, oldest first. A day's
 * point sits at the latest of those, so it is the summed book as it stood when that day
 * was last marked. `carried` is what an agent was worth before the series in hand
 * begins: it stands in until that agent's first close, so an agent that has not been
 * marked for a while still counts for what it holds.
 *
 * Marks land every five minutes. Thinning to the newest sixty *stamps* drew the last
 * few hours and called it the curve; sixty days is what the chart is for.
 */
export function combineDailyCloses(
  byAgent: Map<string, Array<{ at: number; equityUsd: number }>>,
  carried: Map<string, number> = new Map(),
): HomeEquityPoint[] {
  const lastStampOfDay = new Map<number, number>();
  for (const series of byAgent.values()) {
    for (const point of series) {
      const day = Math.floor(point.at / DAY_MS);
      const held = lastStampOfDay.get(day);
      if (held === undefined || point.at > held) lastStampOfDay.set(day, point.at);
    }
  }
  const stamps = [...lastStampOfDay.values()].sort((a, b) => a - b);
  if (stamps.length === 0) return [];

  const keep = stamps.slice(-SPARKLINE_POINTS);
  const agentIds = new Set([...byAgent.keys(), ...carried.keys()]);
  const cursors = new Map<string, number>();

  return keep.map((at) => {
    let total = 0;
    for (const agentId of agentIds) {
      const series = byAgent.get(agentId) ?? [];
      let i = cursors.get(agentId) ?? 0;
      while (i + 1 < series.length && series[i + 1].at <= at) i += 1;
      cursors.set(agentId, i);
      const point = series[i];
      if (point && point.at <= at) total += point.equityUsd;
      else total += carried.get(agentId) ?? 0;
    }
    return { at: new Date(at).toISOString(), equityUsd: total };
  });
}

/**
 * The whole portfolio in one read: cash, capital at work, PnL and the agents.
 *
 * Nothing here throws on a partial failure — a wallet that could not be read comes
 * back from `getUserWalletBalances` flagged (`cashUnavailable`), and an agent with no
 * snapshots simply contributes nothing.
 *
 * It never reads the snapshot history. Latest equity, cash and each live book's basis
 * are the two marks `loadAgentAggregates` already fetches for the cards; the chart is
 * one close per agent per day for the last sixty days, plus the one mark before them
 * that an agent not marked since is still worth.
 */
export async function getHomeOverview(userId: string): Promise<HomeOverview> {
  const db = await getDb();
  const rows = await ownedAgents(userId);
  const agentIds = rows.map((r) => r.id);
  const chartSince = new Date(Date.now() - SPARKLINE_POINTS * DAY_MS);

  const [aggregates, walletBalances, closes, carriedRows, positionRows] = await Promise.all([
    loadAgentAggregates(db, agentIds),
    getUserWalletBalances(userId),
    loadDailyCloses(db, agentIds, chartSince),
    agentIds.length
      ? db
          .selectDistinctOn([equitySnapshots.agentId], {
            agentId: equitySnapshots.agentId,
            equityUsd: equitySnapshots.equityUsd,
          })
          .from(equitySnapshots)
          .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
          // Current mode only — see `snapshotInCurrentMode`.
          .where(
            and(inArray(equitySnapshots.agentId, agentIds), snapshotInCurrentMode(), lt(equitySnapshots.at, chartSince)),
          )
          .orderBy(equitySnapshots.agentId, desc(equitySnapshots.at), desc(equitySnapshots.id))
      : Promise.resolve([]),
    agentIds.length
      ? db
          .select({
            agentId: positions.agentId,
            amountToken: positions.amountToken,
            avgCostUsd: positions.avgCostUsd,
          })
          .from(positions)
          .where(inArray(positions.agentId, agentIds))
      : Promise.resolve([]),
  ]);

  // ---- cash: the user's own embedded wallets, USDC only -------------------
  const cashByWallet: HomeCashRow[] = walletBalances.map((wallet) => {
    const usdc = wallet.balances.find((b) => b.asset.toLowerCase() === "usdc");
    const native = wallet.balances.find((b) => b.asset.toLowerCase() !== "usdc");
    return {
      chain: wallet.chain,
      address: wallet.address,
      // USDC is a dollar; a missing display value is not a reason to show nothing.
      usdcUsd: usdc ? (usdc.usd ?? usdc.amount) : 0,
      nativeAsset: native?.asset ?? (wallet.chain === "base" ? "eth" : "sol"),
      nativeAmount: native?.amount ?? 0,
    };
  });
  const cashUsd = cashByWallet.reduce((sum, row) => sum + row.usdcUsd, 0);
  // A wallet that could not be read contributed nothing above. That is a gap, not an
  // empty wallet, and the page must not print the sum as if it were the whole of it.
  const cashUnavailable = walletBalances.some((wallet) => wallet.readFailed === true);

  // The cards print these same aggregates, so the header and the cards under it agree.
  const cards = await buildAgentCards(db, rows, aggregates);

  // ---- per-agent series, PnL and cost basis -------------------------------
  const seriesByAgent = new Map<string, Array<{ at: number; equityUsd: number }>>();
  for (const [agentId, points] of closes) {
    seriesByAgent.set(
      agentId,
      points.map((p) => ({ at: new Date(p.at).getTime(), equityUsd: p.equityUsd })),
    );
  }
  const carriedByAgent = new Map(carriedRows.map((r) => [r.agentId, toNum(r.equityUsd)]));

  const costBasisByAgent = new Map<string, number>();
  for (const position of positionRows) {
    costBasisByAgent.set(
      position.agentId,
      (costBasisByAgent.get(position.agentId) ?? 0) +
        toNum(position.amountToken) * toNum(position.avgCostUsd),
    );
  }

  const bookFor = (mode: "paper" | "live"): HomeBook => {
    let equityUsd = 0;
    let capitalUsd = 0;
    let realizedPnlUsd = 0;
    let unrealizedPnlUsd = 0;
    const series = new Map<string, Array<{ at: number; equityUsd: number }>>();
    const carried = new Map<string, number>();

    for (const row of rows) {
      if (row.mode !== mode) continue;
      const agg = aggregates.get(row.id);
      // The latest mark, or nothing when the book has never been marked.
      const latest = agg && agg.equityUsd !== null ? { equityUsd: agg.equityUsd, cashUsd: agg.cashUsd ?? 0 } : null;
      // Every agent of this side gets an entry, in the order the totals above are summed
      // in, so the curve's last point adds up the same way the headline does.
      series.set(row.id, seriesByAgent.get(row.id) ?? []);
      const before = carriedByAgent.get(row.id);
      if (before !== undefined) carried.set(row.id, before);

      // Before its first mark a paper agent is still holding its whole float; a live
      // one has not been read yet, and counting a notional there would be inventing money.
      const agentEquity = latest ? latest.equityUsd : mode === "paper" ? toNum(row.paperStartingUsd) : 0;
      // A paper book is measured from its notional. A live one from its first live mark
      // plus what was deposited since, less what was withdrawn, so money moved is never
      // counted as money made; its percent is taken on what was put in.
      const agentBasis = mode === "paper" ? toNum(row.paperStartingUsd) : (agg?.startEquityUsd ?? 0);
      const agentCapital = mode === "paper" ? toNum(row.paperStartingUsd) : (agg?.capitalUsd ?? 0);
      // Headline is equity − basis, as on the agent cards below it; open is positions at
      // the last mark less their cost, and realised is the rest. No mark yet means no
      // open number, not a loss.
      const split = splitPnl({
        equityUsd: agentEquity,
        cashUsd: latest ? latest.cashUsd : null,
        basisUsd: agentBasis,
        costBasisUsd: costBasisByAgent.get(row.id) ?? 0,
      });
      equityUsd += agentEquity;
      capitalUsd += agentCapital;
      realizedPnlUsd += split.realizedPnlUsd;
      unrealizedPnlUsd += split.unrealizedPnlUsd;
    }

    const pnlUsd = realizedPnlUsd + unrealizedPnlUsd;
    return {
      equityUsd,
      pnlUsd,
      pnlPct: capitalUsd > 0 ? (pnlUsd / capitalUsd) * 100 : null,
      realizedPnlUsd,
      unrealizedPnlUsd,
      sparkline: combineDailyCloses(series, carried),
    };
  };
  const live = bookFor("live");
  const paper = bookFor("paper");

  const counts = {
    total: rows.length,
    live: rows.filter((r) => r.mode === "live").length,
    paper: rows.filter((r) => r.mode === "paper").length,
    active: rows.filter((r) => r.status === "active").length,
    paused: rows.filter((r) => r.status === "paused").length,
  };

  return {
    cashUsd,
    cashUnavailable,
    cashByWallet,
    hasWallets: walletBalances.length > 0,
    allocatedUsd: live.equityUsd,
    totalEquityUsd: cashUsd + live.equityUsd,
    pnlUsd: live.pnlUsd,
    pnlPct: live.pnlPct,
    realizedPnlUsd: live.realizedPnlUsd,
    unrealizedPnlUsd: live.unrealizedPnlUsd,
    sparkline: live.sparkline,
    paper,
    agents: cards,
    counts,
  };
}

function kindOf(trade: typeof trades.$inferSelect): HomeActivityKind {
  if (trade.status === "proposed") return "proposal";
  if (trade.origin === "guardian") return "exit";
  return trade.side;
}

/**
 * The recent-activity strip: this user's own fills, the exits the guardian took
 * on their behalf, and any proposal still waiting on a decision.
 *
 * Proposals are swept for expiry first, so nothing here offers a decision the
 * runtime would refuse. Ordering is newest-first with pending proposals lifted to
 * the top — they are the only rows with a clock on them.
 */
export async function getHomeActivity(userId: string, limit = 8): Promise<HomeActivityItem[]> {
  await sweepBeforeRead({ ownerId: userId });

  const db = await getDb();
  const rows = await db
    .select({ trade: trades, agent: agents, token: tokens })
    .from(trades)
    .innerJoin(agents, eq(agents.id, trades.agentId))
    .innerJoin(tokens, eq(tokens.id, trades.tokenId))
    .where(
      and(
        eq(trades.ownerId, userId),
        inArray(trades.status, ["proposed", "filled", "failed", "rejected"]),
      ),
    )
    .orderBy(desc(trades.createdAt))
    .limit(Math.max(1, Math.min(40, limit * 3)));

  const items: HomeActivityItem[] = rows.map(({ trade, agent, token }) => ({
    id: trade.id,
    kind: kindOf(trade),
    at: (trade.filledAt ?? trade.proposedAt ?? trade.createdAt).toISOString(),
    expiresAt:
      trade.status === "proposed"
        ? proposalExpiresAt(trade.proposedAt ?? trade.createdAt, agent.config).toISOString()
        : null,
    agent: {
      id: agent.id,
      slug: agent.slug,
      name: agent.name,
      avatarSeed: agent.avatarSeed,
      mode: agent.mode,
    },
    // Home is the signed-in user's own agents only (`trades.ownerId = userId` above).
    trade: toTradeRow(trade, toTokenRef(token), { isOwner: true }),
  }));

  items.sort((a, b) => {
    const pending = Number(b.kind === "proposal") - Number(a.kind === "proposal");
    if (pending !== 0) return pending;
    return new Date(b.at).getTime() - new Date(a.at).getTime();
  });

  const shown = items.slice(0, limit);
  await attachRealizedPnl(
    db,
    shown.map((item) => item.trade),
  );
  return shown;
}
