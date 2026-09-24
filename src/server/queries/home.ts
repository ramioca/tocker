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
 *   lookup (which already degrades to zeros rather than throwing). A landing page
 *   must not be able to fail because a provider is having a bad afternoon.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { agents, equitySnapshots, getDb, positions, tokens, trades } from "@/db";
import { getUserWalletBalances } from "@/lib/wallets";
import { toNum } from "@/lib/money";
import { pnlOverWindow } from "@/lib/pnl";
import { proposalExpiresAt, sweepBeforeRead } from "@/lib/trading/proposals";
import { buildAgentCards, snapshotInCurrentMode, toTokenRef, toTradeRow } from "./_shared";
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

export interface HomeOverview {
  /** Spendable USDC in the user's own embedded wallets, summed across chains. */
  cashUsd: number;
  cashByWallet: HomeCashRow[];
  /** True when the user has no embedded wallet recorded yet (pre-first-login sync). */
  hasWallets: boolean;
  /** Latest equity across every agent — capital that is already working. */
  allocatedUsd: number;
  /** Cash + allocated. The only number on the page that is "everything". */
  totalEquityUsd: number;
  /** Sum of each agent's all-time PnL, so adding an agent never fakes a gain. */
  pnlUsd: number;
  /** Against the capital each agent started with. Null when nothing has a baseline. */
  pnlPct: number | null;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  /** Up to 60 points of combined equity, oldest first. Fewer than 2 = no chart. */
  sparkline: HomeEquityPoint[];
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

const SPARKLINE_POINTS = 60;

/** The agent rows this user owns, newest first. Shared by both reads. */
async function ownedAgents(userId: string) {
  const db = await getDb();
  return db.select().from(agents).where(eq(agents.ownerId, userId)).orderBy(desc(agents.createdAt));
}

/**
 * Sum every agent's equity curve into one.
 *
 * Each agent contributes from its own first snapshot onward, forward-filled at
 * every timestamp any agent reported. That makes the curve read as "capital at
 * work over time" — a new agent is a step up, because it is. The *return* number
 * deliberately does not come from this curve (see `pnlUsd`), so a deposit can
 * never be mistaken for a gain.
 */
function combineSeries(
  byAgent: Map<string, Array<{ at: number; equityUsd: number }>>,
): HomeEquityPoint[] {
  const stamps = [...new Set([...byAgent.values()].flatMap((s) => s.map((p) => p.at)))].sort(
    (a, b) => a - b,
  );
  if (stamps.length === 0) return [];

  // Thin to the last N stamps so a year of five-minute marks is not shipped to
  // the client; the shape survives, the payload does not balloon.
  const keep = stamps.slice(-SPARKLINE_POINTS);
  const cursors = new Map<string, number>();

  return keep.map((at) => {
    let total = 0;
    for (const [agentId, series] of byAgent) {
      let i = cursors.get(agentId) ?? 0;
      while (i + 1 < series.length && series[i + 1].at <= at) i += 1;
      cursors.set(agentId, i);
      const point = series[i];
      if (point && point.at <= at) total += point.equityUsd;
    }
    return { at: new Date(at).toISOString(), equityUsd: total };
  });
}

/**
 * The whole portfolio in one read: cash, capital at work, PnL and the agents.
 *
 * Nothing here throws on a partial failure — a wallet lookup that cannot reach
 * Privy resolves to zeros inside `getUserWalletBalances`, and an agent with no
 * snapshots simply contributes nothing.
 */
export async function getHomeOverview(userId: string): Promise<HomeOverview> {
  const db = await getDb();
  const rows = await ownedAgents(userId);
  const agentIds = rows.map((r) => r.id);

  const [cards, walletBalances, snapshots, positionRows] = await Promise.all([
    buildAgentCards(db, rows),
    getUserWalletBalances(userId),
    agentIds.length
      ? db
          .select({
            agentId: equitySnapshots.agentId,
            equityUsd: equitySnapshots.equityUsd,
            cashUsd: equitySnapshots.cashUsd,
            at: equitySnapshots.at,
          })
          .from(equitySnapshots)
          .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
          // Current mode only — see `snapshotInCurrentMode`.
          .where(and(inArray(equitySnapshots.agentId, agentIds), snapshotInCurrentMode()))
          .orderBy(equitySnapshots.agentId, equitySnapshots.at)
      : Promise.resolve([]),
    agentIds.length
      ? db
          .select({
            agentId: positions.agentId,
            amountToken: positions.amountToken,
            avgCostUsd: positions.avgCostUsd,
            realizedPnlUsd: positions.realizedPnlUsd,
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

  // ---- per-agent series, PnL and cost basis -------------------------------
  const seriesByAgent = new Map<string, Array<{ at: number; equityUsd: number }>>();
  const rawByAgent = new Map<string, Array<{ at: Date; equityUsd: number }>>();
  const latestByAgent = new Map<string, { equityUsd: number; cashUsd: number }>();

  for (const snapshot of snapshots) {
    const equityUsd = toNum(snapshot.equityUsd);
    const list = seriesByAgent.get(snapshot.agentId) ?? [];
    list.push({ at: snapshot.at.getTime(), equityUsd });
    seriesByAgent.set(snapshot.agentId, list);

    const raw = rawByAgent.get(snapshot.agentId) ?? [];
    raw.push({ at: snapshot.at, equityUsd });
    rawByAgent.set(snapshot.agentId, raw);

    latestByAgent.set(snapshot.agentId, { equityUsd, cashUsd: toNum(snapshot.cashUsd) });
  }

  let pnlUsd = 0;
  let basisUsd = 0;
  for (const [, raw] of rawByAgent) {
    const window = pnlOverWindow(raw, "all");
    if (!window) continue;
    pnlUsd += window.pnlUsd;
    basisUsd += Math.abs(window.startEquityUsd);
  }

  let allocatedUsd = 0;
  let agentCashUsd = 0;
  for (const row of rows) {
    const latest = latestByAgent.get(row.id);
    // An agent with no snapshot yet is still holding its paper float.
    allocatedUsd += latest ? latest.equityUsd : toNum(row.paperStartingUsd);
    agentCashUsd += latest ? latest.cashUsd : toNum(row.paperStartingUsd);
  }

  let realizedPnlUsd = 0;
  let costBasisUsd = 0;
  for (const position of positionRows) {
    realizedPnlUsd += toNum(position.realizedPnlUsd);
    costBasisUsd += toNum(position.amountToken) * toNum(position.avgCostUsd);
  }
  // Open positions are worth (agent equity − agent cash) at the last mark; what
  // they cost is the summed basis. The difference is the unrealised number.
  const unrealizedPnlUsd = allocatedUsd - agentCashUsd - costBasisUsd;

  const counts = {
    total: rows.length,
    live: rows.filter((r) => r.mode === "live").length,
    paper: rows.filter((r) => r.mode === "paper").length,
    active: rows.filter((r) => r.status === "active").length,
    paused: rows.filter((r) => r.status === "paused").length,
  };

  return {
    cashUsd,
    cashByWallet,
    hasWallets: walletBalances.length > 0,
    allocatedUsd,
    totalEquityUsd: cashUsd + allocatedUsd,
    pnlUsd,
    pnlPct: basisUsd > 0 ? (pnlUsd / basisUsd) * 100 : null,
    realizedPnlUsd,
    unrealizedPnlUsd,
    sparkline: combineSeries(seriesByAgent),
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

  return items.slice(0, limit);
}
