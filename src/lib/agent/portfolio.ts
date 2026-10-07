/**
 * The agent's book: cash, marked positions, equity, and today's trade count.
 *
 * Paper cash is recomputed from the trade ledger (see `trading/paper.ts`); live cash
 * is the agent's USDC balance across its Privy server wallets.
 *
 * A live agent that pays for its own thinking (`llm.source: "usdc"`) keeps two runs'
 * worth of it, and the wallet floor, out of its trades: `thinkingReserveUsd`. That money
 * is still the agent's and still counts in its cash and equity; it is only left out of
 * what a buy may spend, the same way fees owed are.
 *
 * A known gap, for an agent that trades Solana AND Base: the book has one cash figure
 * for both chains, and the risk guard compares a buy with that one figure. So what is
 * held back comes off the total, not off the Solana wallet that actually pays for the
 * thinking: with $2 on Solana, $10 on Base and $0.85 held back, an $11 buy "fits", and a
 * $2 buy on Solana empties the wallet the reserve was meant to protect. The agent is
 * then held on `needs_funds` at its next run although it holds USDC on Base. Nothing is
 * lost and the owner is told to add USDC on Solana; closing the gap needs cash per chain
 * in the guard (`toRiskPortfolio` would have to know the order's chain, and every caller
 * to pass it), which is a change to every buy path and not one to make here. An agent
 * that trades Solana alone does not have it, and the first-trade preset leaves a
 * pay-per-use agent trading Solana alone.
 */
import { isDustPosition } from "@/lib/trading/positions";
import { nanoid } from "nanoid";
import { exitDistances } from "@/lib/pnl";
import { and, eq, gte } from "drizzle-orm";
import { agents, equitySnapshots, getDb, positions, tokens, trades, wallets } from "@/db";
import type { AgentConfig, AgentRiskWithSizing } from "@/db/schema";
import type { Position, TokenRef } from "@/server/types";
import type { AgentWalletRef } from "@/lib/x402/types";
import { netLiveCashUsd, platformFeeUsd } from "@/lib/platform/fee";
import { accruedFeesUsd } from "@/lib/platform/fees";
import { getMarks } from "@/lib/trading/prices";
import { getPaperCash } from "@/lib/trading/paper";
import { loadCachedScores } from "@/lib/trading/score-cache";
import { toTokenRef } from "@/lib/trading/tokens";
import { sizeCeiling, type RiskPortfolio } from "@/lib/trading/risk";
import { readSizing } from "@/lib/trading/sizing";
import { thinkingReserveUsd } from "./inference";

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
  /**
   * W7 H8: true when a live wallet balance could not be read, so `cashUsd` (and every
   * number derived from it) understates the book. Always false for a paper agent, whose
   * cash is recomputed from its own ledger. Nothing may write an equity snapshot while
   * this is true.
   */
  cashReadFailed: boolean;
  /**
   * USDC a live pay-per-use agent holds back from buys so it can go on paying for its
   * thinking: twice its limit for one run (what is left of this run, and the next one)
   * plus the wallet floor, and never more than its Solana wallet has. Part of `cashUsd`,
   * not on top of it. Absent or zero for every other agent.
   */
  thinkingReserveUsd?: number;
}

/**
 * What a buy may spend: cash, less what is held back for thinking. For an agent that
 * holds nothing back (every key agent, every paper agent) this is its cash.
 */
export function spendableCashUsd(portfolio: Pick<Portfolio, "cashUsd" | "thinkingReserveUsd">): number {
  const held = portfolio.thinkingReserveUsd ?? 0;
  if (!(held > 0)) return portfolio.cashUsd;
  return Math.max(0, Math.round((portfolio.cashUsd - held) * 1e6) / 1e6);
}

export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * USDC across the agent's live wallets, and whether every wallet actually answered
 * (W7 H8).
 *
 * A wallet we cannot read still contributes zero to the number — the run must go on, and
 * an agent with one unreadable wallet can still act on the one it can read. What changed
 * is that the caller is now *told*: a balance read that failed used to look identical to
 * a wallet holding nothing, and the equity snapshot written on top of it recorded a live
 * agent as having lost everything. A gap in the curve is honest; a zero is not.
 */
/**
 * A Solana wallet's USDC straight from the chain, or null when the RPC could not say.
 * Privy's balance endpoint is an indexer and can trail a fill by minutes — long enough
 * for a third approval to pass the cash check against money the first two already
 * spent. The chain has no such lag. A missing token account reads as 0 USDC.
 */
async function solanaUsdcOnChain(address: string): Promise<number | null> {
  try {
    const { PublicKey } = await import("@solana/web3.js");
    const { associatedTokenAddress, SOLANA_USDC_DECIMALS, SOLANA_USDC_MINT } = await import(
      "@/lib/wallets/solana-transfer"
    );
    const { getTokenAccountBalance } = await import("@/lib/wallets/solana-rpc");
    const ata = associatedTokenAddress(new PublicKey(address), SOLANA_USDC_MINT);
    const raw = await getTokenAccountBalance(ata.toBase58());
    return raw === null ? null : Number(raw) / 10 ** SOLANA_USDC_DECIMALS;
  } catch {
    return null;
  }
}

async function getLiveCash(walletRefs: AgentWalletRef[]): Promise<{ usd: number; complete: boolean; solanaUsd: number }> {
  const usable = walletRefs.filter((w) => !w.walletId.startsWith("paper_"));
  if (usable.length === 0) return { usd: 0, complete: true, solanaUsd: 0 };
  const { privy } = await import("@/lib/privy");
  const client = privy();
  let total = 0;
  // The Solana part on its own: pay-per-use thinking is paid from that wallet only.
  let solanaUsd = 0;
  let complete = true;
  for (const w of usable) {
    if (w.chain === "solana" && w.address) {
      const onChain = await solanaUsdcOnChain(w.address);
      if (onChain !== null) {
        total += onChain;
        solanaUsd += onChain;
        continue;
      }
    }
    try {
      const res = await client
        .wallets()
        .balance.get(w.walletId, { asset: "usdc", chain: w.chain === "solana" ? "solana" : "base" });
      for (const b of res.balances) {
        const raw = Number(b.raw_value);
        if (!Number.isFinite(raw)) continue;
        total += raw / 10 ** b.raw_value_decimals;
        if (w.chain === "solana") solanaUsd += raw / 10 ** b.raw_value_decimals;
      }
    } catch {
      complete = false;
    }
  }
  return { usd: total, complete, solanaUsd };
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

  // Live cash is the wallet balance *minus what the agent already owes the platform*.
  // The fees for every fill since the last sweep are still sitting in the wallet, but
  // they are spoken for; showing the raw balance would let the agent size a trade with
  // money it cannot keep, and the shortfall would surface as a failed settlement —
  // the worst possible place to find out. Paper cash nets its fees the same way, in
  // `computePaperCash`.
  let cashReadFailed = false;
  let cashUsd: number;
  let heldForThinking = 0;
  if (agent.mode === "paper") {
    cashUsd = await getPaperCash(agentId);
  } else {
    const live = await getLiveCash(await getAgentWallets(agentId));
    cashReadFailed = !live.complete;
    cashUsd = netLiveCashUsd(live.usd, await accruedFeesUsd(agentId));
    // A live agent that pays for its own thinking keeps two runs' worth of it out of its
    // trades: what the run in hand may still spend after a buy, and what the check before
    // the next run asks for. With one, its first cash-bound buy left it unable to think
    // again (`thinkingReserveUsd` has the arithmetic). Held back here, beside the fees,
    // and never more than the Solana wallet's USDC: that is the wallet that pays, and
    // USDC on another chain cannot stand in for it. Zero for a key agent.
    heldForThinking = Math.max(0, Math.min(thinkingReserveUsd(agent.config), live.solanaUsd, cashUsd));
  }

  // Buys only. The daily limit caps how much *new* exposure an agent may take on; a
  // stop-out, a take-profit or a manual sell reduces exposure and must never spend it —
  // seen live: 17 fills in a day, ten of them exits, and the guard refusing every new
  // proposal as "limit reached" while the book sat in cash.
  const todayRows = await db
    .select({ id: trades.id })
    .from(trades)
    .where(
      and(
        eq(trades.agentId, agentId),
        eq(trades.status, "filled"),
        eq(trades.side, "buy"),
        gte(trades.createdAt, startOfUtcDay()),
      ),
    );

  return {
    agentId,
    mode: agent.mode,
    cashUsd,
    // Every remainder still counts in equity; only the book is spared them.
    equityUsd: cashUsd + positionsValue,
    positions: view.filter((p) => !isDustPosition(p.valueUsd)),
    realizedPnlUsd,
    unrealizedPnlUsd,
    tradesToday: todayRows.length,
    startingUsd: Number(agent.paperStartingUsd),
    cashReadFailed,
    ...(heldForThinking > 0 ? { thinkingReserveUsd: heldForThinking } : {}),
  };
}

/**
 * Shape the risk guard consumes. Every buy is checked against this, so this is where
 * what is held back for thinking stops being spendable: the guard sees the cash a buy may
 * use, and the full equity for its concentration cap.
 */
export function toRiskPortfolio(portfolio: Portfolio): RiskPortfolio {
  return {
    cashUsd: spendableCashUsd(portfolio),
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

/**
 * Writes one `equity_snapshots` row. Called at the end of every run and on every marks
 * pass. Returns whether a row was actually written.
 *
 * Two W7 H8 rules, both about not recording a number we know to be wrong:
 *
 *  - **The mode is stamped on the point.** A paper book starts at `paperStartingUsd`
 *    (10,000 by default) and a live book at whatever was deposited. A series that mixes
 *    the two reads as a −99.9% crash from the instant an agent goes live, on its own card
 *    and on the public leaderboard. Readers filter to the agent's current mode; a null
 *    here means a row written before the column existed, which is treated as current.
 *  - **A failed balance read is a gap, not a zero.** When a live wallet could not be
 *    read, `cashUsd` understates the book by however much is in it — and a point drawn
 *    on that says the agent lost everything at 14:05 and got it back at 14:10. Missing
 *    the point is the honest outcome; the next pass is five minutes away.
 */
export async function snapshotEquity(portfolio: Portfolio): Promise<boolean> {
  if (portfolio.cashReadFailed) {
    console.warn(`[portfolio] ${portfolio.agentId}: skipping equity snapshot — a live balance read failed`);
    return false;
  }
  const db = await getDb();
  await db.insert(equitySnapshots).values({
    id: nanoid(),
    agentId: portfolio.agentId,
    equityUsd: portfolio.equityUsd.toFixed(6),
    cashUsd: portfolio.cashUsd.toFixed(6),
    mode: portfolio.mode,
  });
  return true;
}

/**
 * The largest buy the risk guard would actually let through right now, for a token not
 * already held, and the binding constraint (W7 H11).
 *
 * The sizing ceiling on its own is not the answer, and printing it alone was actively
 * misleading: a $10 wallet under the first-trade preset was told its clip was $2 while
 * `maxPositionPct` refused anything over $1. Three limits apply to every buy and the
 * smallest wins — the sizing mode, the concentration cap, and the cash the agent has
 * left after the platform's flat fee. The model should be told the number it has, and
 * why, rather than being made to discover it by being refused.
 */
export function effectiveTicketUsd(
  portfolio: Pick<Portfolio, "cashUsd" | "equityUsd" | "thinkingReserveUsd">,
  config: AgentConfig,
): { amountUsd: number; reason: string } {
  const ceiling = sizeCeiling(config, portfolio, {});
  const feeUsd = platformFeeUsd();
  const equity = portfolio.equityUsd > 0 ? portfolio.equityUsd : portfolio.cashUsd;
  // What the risk guard will compare a buy with (`toRiskPortfolio`), so the number the
  // model is told is the number it has.
  const held = portfolio.thinkingReserveUsd ?? 0;
  const spendable = spendableCashUsd(portfolio);
  const cashWords =
    held > 0 ? `cash $${portfolio.cashUsd.toFixed(2)} minus the $${held.toFixed(2)} held back to pay for thinking` : `cash $${portfolio.cashUsd.toFixed(2)}`;

  const limits: Array<{ amountUsd: number; reason: string }> = [
    {
      amountUsd: ceiling.amountUsd,
      reason: `${ceiling.effectiveMode.replace(/_/g, " ")} sizing — ${ceiling.explanation}`,
    },
    {
      amountUsd: Math.max(0, spendable - feeUsd),
      reason:
        feeUsd > 0
          ? `${cashWords} ${held > 0 ? "and" : "minus"} the $${feeUsd.toFixed(2)} Tocker fee charged on the fill`
          : cashWords,
    },
  ];
  if (equity > 0) {
    limits.push({
      amountUsd: (config.risk.maxPositionPct / 100) * equity,
      reason: `maxPositionPct ${config.risk.maxPositionPct}% of $${equity.toFixed(2)} equity`,
    });
  }

  const binding = limits.reduce((lowest, limit) => (limit.amountUsd < lowest.amountUsd ? limit : lowest));
  return { amountUsd: Math.max(0, binding.amountUsd), reason: binding.reason };
}

/** Compact, model-friendly rendering used by both the tick prompt and `get_portfolio`. */
export function describePortfolio(portfolio: Portfolio, config: AgentConfig): string {
  // The ceiling belongs in the book, not in a rejection. A model that is told "$0.97 is
  // your clip right now, and here is why" writes one good order; a model that has to
  // discover the number by being refused burns a step and a tool call to learn it.
  const ticket = effectiveTicketUsd(portfolio, config);
  const lines = [
    `Cash: $${portfolio.cashUsd.toFixed(2)} · Equity: $${portfolio.equityUsd.toFixed(2)} · Mode: ${portfolio.mode}`,
    `Realized PnL $${portfolio.realizedPnlUsd.toFixed(2)} · Unrealized PnL $${portfolio.unrealizedPnlUsd.toFixed(2)}`,
    `Trades today: ${portfolio.tradesToday}/${config.risk.maxDailyTrades}`,
    `Max ticket right now: $${ticket.amountUsd.toFixed(2)} — the binding limit is ${ticket.reason}. An order above this is rejected, not trimmed.` +
      (readSizing(config.risk as AgentRiskWithSizing).mode === "volatility_scaled"
        ? " A token that has been ranging widely gets a smaller ticket than this; size down when you see one."
        : "") +
      // A token already held eats into its own concentration headroom, so the real
      // ceiling for an add is lower than this. Saying so is cheaper than a rejection.
      (portfolio.positions.length > 0
        ? " Adding to a token you already hold has less room than this: the position you hold counts towards the same concentration cap."
        : ""),
  ];
  if ((portfolio.thinkingReserveUsd ?? 0) > 0) {
    // Said plainly, or a model that sees $5.00 of cash and a $4.20 ceiling goes looking for the rest.
    // And said to be private: the figure is worked out from a limit only the owner may
    // read, and a rationale, a post and a summary are public.
    lines.push(
      `Of that cash, $${(portfolio.thinkingReserveUsd ?? 0).toFixed(2)} is held back to pay for your own thinking and cannot be spent on a buy: $${spendableCashUsd(portfolio).toFixed(2)} is available to trade.` +
        " The amount held back follows a limit your owner set: like your other thresholds, never state it in a rationale, a post or your summary.",
    );
  }
  if (portfolio.cashReadFailed) {
    lines.push(
      "WARNING: at least one wallet balance could not be read this tick, so the cash figure above is too low. Do not open a new position on it.",
    );
  }
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
