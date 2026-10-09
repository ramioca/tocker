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
 *
 * An agent with a position limit (`risk.maxOpenPositions`) has its buys waiting for
 * approval read as well, on every read. And a book that is about to judge a real buy
 * (`getPortfolio(id, { forBuy: true })`) reads two more things for an agent with a
 * position limit or a cash reserve (`risk.cashReserveUsd`): its buys in flight, placed
 * and not settled, and, under a reserve, its Base USDC from the chain instead of the
 * indexer. The guard is handed all of it by `toRiskPortfolio`; see `BuyInFlight` and
 * `getLiveCash`. Nothing of the kind is read for an agent with neither setting, or for a
 * book that is read for any other reason: a sell, an exit, a prompt, a page.
 */
import { isDustPosition } from "@/lib/trading/positions";
import { nanoid } from "nanoid";
import { exitDistances } from "@/lib/pnl";
import { and, eq, gt, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { agents, equitySnapshots, getDb, inferencePayments, positions, tokens, trades, wallets } from "@/db";
import type { AgentConfig, AgentRiskWithSizing } from "@/db/schema";
import type { Chain, Position, TokenRef } from "@/server/types";
import type { AgentWalletRef } from "@/lib/x402/types";
import { toNum } from "@/lib/money";
import { buyCostUsd, formatFeeRate, netLiveCashUsd, platformFeeBps } from "@/lib/platform/fee";
import { accruedFeesUsd } from "@/lib/platform/fees";
import { getMarks } from "@/lib/trading/prices";
import { getPaperCash } from "@/lib/trading/paper";
import { loadCachedScores } from "@/lib/trading/score-cache";
import { USDC_BASE, toTokenRef } from "@/lib/trading/tokens";
import { proposalExpiresAt } from "@/lib/trading/proposal-ttl";
import { SUBMITTED_STALE_MS } from "@/lib/trading/settle";
import {
  buyingCashUsd,
  positionRoom,
  readCashReserveUsd,
  readMaxOpenPositions,
  ticketCeiling,
  type RiskPortfolio,
} from "@/lib/trading/risk";
import { readSizing } from "@/lib/trading/sizing";
import { dbErrorForLog } from "@/lib/security/redact";
import { PAYMENT_IN_FLIGHT_MS, thinkSource, thinkingReserveUsd } from "./inference";

/**
 * A buy of the agent's that has passed the risk guard and has not settled: its row is
 * `pending` or `submitted`. It is not a position yet and its cash has not left, so a
 * second buy from another request in those seconds (a run's and the owner's, an approval
 * and a buy by hand) would be judged on a book that shows neither.
 */
export interface BuyInFlight {
  tradeId: string;
  tokenId: string;
  /** The order's size with its fee: what the cash will be down by when it fills. */
  costUsd: number;
  /** When it was placed: the moment an approval was claimed, or the row was written. */
  at: number;
  /** It is a proposal its owner approved (the others were placed by a run or by hand). */
  approved: boolean;
}

/**
 * How long a `pending` or `submitted` buy is taken to be in flight. The same two minutes
 * after which the marks pass calls a `submitted` row abandoned (`sweepSubmittedTrades`):
 * a quote, a swap and its confirmation fit well inside it, and a row left behind by an
 * invocation that died must not hold a slot, or cash, for good.
 */
export const BUY_IN_FLIGHT_MS = SUBMITTED_STALE_MS;

/**
 * How far behind a fill an indexed balance is allowed for. The code's own notes say
 * Privy's balance endpoint "can trail a fill by minutes"; five is one cron pass. A guess
 * with a margin, not a measurement, and it only ever makes the reserve stricter.
 */
export const INDEXER_LAG_MS = 5 * 60_000;

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
  /**
   * Set only for a live agent that pays for its own thinking: the moment just before its
   * wallets were read for this book. `snapshotEquity` uses it to tell whether one of the
   * agent's paid steps was in flight at that read. Absent for every other agent.
   */
  cashReadAt?: Date;
  /**
   * Set only for an agent with a position limit (`risk.maxOpenPositions`): the tokens
   * with a buy still waiting for its owner's approval, which count against that limit
   * beside what is held. Absent for every other agent, and nothing is read for them.
   */
  pendingBuyTokenIds?: string[];
  /**
   * Set only on a book read to judge a buy (`forBuy`), for an agent with a position
   * limit or a cash reserve, and only while it has any: its buys in flight
   * ({@link BuyInFlight}). Absent on every other book, and nothing is read for them.
   */
  buysInFlight?: BuyInFlight[];
  /**
   * Set only on a book read to judge a buy (`forBuy`), for a live agent with a cash
   * reserve whose balance had to come from the indexer (the chain did not answer): what
   * its buys of the last {@link INDEXER_LAG_MS} moved, which that balance may not show
   * yet. Part of `cashUsd`, and set against the reserve only. Absent on every other
   * book, and whenever the chain answered.
   */
  cashUnseenUsd?: number;
}

/**
 * The book with nothing in flight: what it is judged on once every buy still settling is
 * left out. An approval asks the guard a second time on this when it has been refused, to
 * tell a refusal that will still stand in a minute from one that only the buys in flight
 * explain. It is never what a buy is let through on.
 */
export function withoutBuysInFlight(portfolio: Portfolio): Portfolio {
  if (portfolio.buysInFlight === undefined && portfolio.cashUnseenUsd === undefined) return portfolio;
  const settled = { ...portfolio };
  delete settled.buysInFlight;
  delete settled.cashUnseenUsd;
  return settled;
}

/** The parts of the book that say what a buy may spend. */
type BookCash = Pick<Portfolio, "cashUsd" | "thinkingReserveUsd" | "buysInFlight" | "cashUnseenUsd">;

/**
 * The proposal an approval is carrying out. Its row was moved to `pending` when the owner
 * tapped Approve, before the book was read, so it is among the buys in flight: it must
 * not be counted against itself.
 */
export interface DecidingProposal {
  tradeId: string;
  /** When it was claimed (`decidedAt`). */
  at: number;
}

/**
 * The buys in flight that count against an order. Every one of them, unless the order is
 * a proposal being approved: then not its own row, and not another approved proposal
 * claimed after it. Two approvals tapped together each find the other in flight; with no
 * order between them, under a limit with room for one, neither would go through however
 * often they were tapped again. So the earlier claim goes first and the later one is
 * judged with it counted.
 */
function buysCounted(portfolio: Pick<Portfolio, "buysInFlight">, deciding?: DecidingProposal): BuyInFlight[] {
  const inFlight = portfolio.buysInFlight ?? [];
  if (!deciding) return inFlight;
  return inFlight.filter((buy) => {
    if (buy.tradeId === deciding.tradeId) return false;
    const later = buy.at > deciding.at || (buy.at === deciding.at && buy.tradeId > deciding.tradeId);
    return !(buy.approved && later);
  });
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

/**
 * The book's cash as the risk guard is handed it: what a buy may spend before the owner's
 * reserve, how much of the agent's cash that already leaves out, and how much of it is
 * already spoken for (buys in flight, and buys a lagging balance may not show yet).
 */
function guardCash(
  portfolio: BookCash,
  deciding?: DecidingProposal,
): Pick<RiskPortfolio, "cashUsd" | "cashHeldBackUsd" | "cashSpokenForUsd"> {
  const held = portfolio.thinkingReserveUsd ?? 0;
  const spokenFor =
    buysCounted(portfolio, deciding).reduce((sum, buy) => sum + buy.costUsd, 0) + (portfolio.cashUnseenUsd ?? 0);
  return {
    cashUsd: spendableCashUsd(portfolio),
    ...(held > 0 ? { cashHeldBackUsd: held } : {}),
    ...(spokenFor > 0 ? { cashSpokenForUsd: Math.round(spokenFor * 1e6) / 1e6 } : {}),
  };
}

/**
 * What a buy may spend once the owner's cash reserve (`risk.cashReserveUsd`) is set aside
 * as well: the figure the risk guard clears a buy against. For an agent with no reserve
 * this is {@link spendableCashUsd}.
 */
export function cashForBuysUsd(portfolio: BookCash, config: AgentConfig): number {
  return buyingCashUsd(config.risk, guardCash(portfolio));
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

const BASE_USDC_DECIMALS = 6;

/** How long a buy waits for the Base chain to say what a wallet holds before the indexer is asked instead. */
const BASE_CASH_READ_MS = 5_000;

/**
 * A Base wallet's USDC straight from the chain, or null when the RPC could not say, or
 * did not say in time: the order waiting on this is a buy inside a run.
 */
async function baseUsdcOnChain(address: string): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { readBaseTokenBalance } = await import("@/lib/trading/base");
    const tooSlow = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), BASE_CASH_READ_MS);
    });
    const raw = await Promise.race([readBaseTokenBalance(USDC_BASE, address), tooSlow]);
    return raw === null ? null : Number(raw) / 10 ** BASE_USDC_DECIMALS;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `baseFromChain` is asked for when a buy is about to be judged for an agent with a cash
 * reserve, and at no other time. A Base wallet is otherwise read from Privy's indexer,
 * as it always was, and a figure that trails a fill is harmless to the plain cash rule:
 * a buy the money is not there for fails at the venue. The reserve has no such backstop,
 * because the money IS there, so back-to-back buys on a balance that had not caught up
 * went straight through it. With the flag a Base wallet is read from the chain first, as
 * a Solana one always is.
 *
 * `indexed` names the chains whose figure came from the indexer all the same (the chain
 * did not answer), so the caller can allow for what such a balance may not show yet.
 */
async function getLiveCash(
  walletRefs: AgentWalletRef[],
  options: { baseFromChain?: boolean } = {},
): Promise<{ usd: number; complete: boolean; solanaUsd: number; indexed: Chain[] }> {
  const usable = walletRefs.filter((w) => !w.walletId.startsWith("paper_"));
  if (usable.length === 0) return { usd: 0, complete: true, solanaUsd: 0, indexed: [] };
  const { privy } = await import("@/lib/privy");
  const client = privy();
  let total = 0;
  // The Solana part on its own: pay-per-use thinking is paid from that wallet only.
  let solanaUsd = 0;
  let complete = true;
  const indexed = new Set<Chain>();
  for (const w of usable) {
    if (w.chain === "solana" && w.address) {
      const onChain = await solanaUsdcOnChain(w.address);
      if (onChain !== null) {
        total += onChain;
        solanaUsd += onChain;
        continue;
      }
    }
    if (options.baseFromChain === true && w.chain === "base" && w.address) {
      const onChain = await baseUsdcOnChain(w.address);
      if (onChain !== null) {
        total += onChain;
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
      indexed.add(w.chain);
    } catch {
      complete = false;
    }
  }
  return { usd: total, complete, solanaUsd, indexed: [...indexed] };
}

export async function getAgentWallets(agentId: string): Promise<AgentWalletRef[]> {
  const db = await getDb();
  const rows = await db.select().from(wallets).where(eq(wallets.agentId, agentId));
  return rows.map((r) => ({ chain: r.chain, walletId: r.id, address: r.address }));
}

/**
 * `forBuy` says this book is about to be put before the risk guard with a real buy. The
 * three places that do that pass it: the model's `place_trade`, a buy placed by hand, and
 * the approval of a proposed buy. For an agent with a position limit or a cash reserve
 * the book then also carries what such a buy must not be judged without (the agent's
 * buys in flight, and under a reserve a balance that does not trail its own fills). A
 * new path that places buys has to pass it too, or those two rules are judged on a book
 * that can be a few seconds, or a few minutes, behind.
 *
 * Without it, and for every agent with neither setting, the book is read as it always
 * was. A sell never passes it, so no exit waits on any of this.
 */
export async function getPortfolio(agentId: string, options: { forBuy?: boolean } = {}): Promise<Portfolio> {
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

  const positionLimit = readMaxOpenPositions(agent.config.risk);
  const reserveUsd = readCashReserveUsd(agent.config.risk);
  // Whether there is anything more to read: a buy is being judged, under a rule that a
  // book a moment behind would let it slip past.
  const judgingBuy = options.forBuy === true && (positionLimit !== null || reserveUsd > 0);

  // Live cash is the wallet balance *minus what the agent already owes the platform*.
  // The fees for every fill since the last sweep are still sitting in the wallet, but
  // they are spoken for; showing the raw balance would let the agent size a trade with
  // money it cannot keep, and the shortfall would surface as a failed settlement —
  // the worst possible place to find out. Paper cash nets its fees the same way, in
  // `computePaperCash`.
  let cashReadFailed = false;
  let cashUsd: number;
  let heldForThinking = 0;
  let cashReadAt: Date | null = null;
  // The chains whose balance came from the indexer. Only ever looked at under a reserve.
  let indexedChains: Chain[] = [];
  if (agent.mode === "paper") {
    // From the balance read above, the one reported as `startingUsd` below: a paper buy
    // and a paper mark each ask whether that balance still stands as they are written.
    cashUsd = await getPaperCash(agentId, Number(agent.paperStartingUsd));
  } else {
    const walletRefs = await getAgentWallets(agentId);
    // Noted before the first wallet is asked, and only for an agent that pays for its own
    // thinking: a payment that had not landed by now is not in the balances below.
    if (thinkSource(agent.config) === "usdc") cashReadAt = new Date();
    // For a buy under a cash reserve Base is read from the chain; every other book's
    // wallets are read exactly as they were (see `getLiveCash`).
    const live = await getLiveCash(walletRefs, judgingBuy && reserveUsd > 0 ? { baseFromChain: true } : {});
    indexedChains = live.indexed;
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

  // The buys still waiting for the owner, for the one rule that counts them: a position
  // limit. Read only when the agent has one, so every other book is read exactly as it
  // was. A proposal past its time is dead whether or not the sweep has been by, and one
  // made in the other mode can never fill (`decideProposal`), so neither takes a slot.
  let pendingBuyTokenIds: string[] | null = null;
  if (positionLimit !== null) {
    const waiting = await db
      .select({ tokenId: trades.tokenId, proposedAt: trades.proposedAt, createdAt: trades.createdAt })
      .from(trades)
      .where(
        and(
          eq(trades.agentId, agentId),
          eq(trades.status, "proposed"),
          eq(trades.side, "buy"),
          eq(trades.isPaper, agent.mode === "paper"),
        ),
      );
    const now = Date.now();
    pendingBuyTokenIds = [
      ...new Set(
        waiting
          .filter((row) => proposalExpiresAt(row.proposedAt ?? row.createdAt, agent.config).getTime() > now)
          .map((row) => row.tokenId),
      ),
    ];
  }

  // The buys in flight, for the two rules a second buy could slip past while the first
  // is still filling: the position limit and the cash reserve. Read only when a buy is
  // being judged for an agent with one of them. Placed in this mode, and recently: a row
  // an invocation left behind when it died is not a buy that is about to land.
  let buysInFlight: BuyInFlight[] = [];
  let cashUnseenUsd = 0;
  if (judgingBuy) {
    const nowMs = Date.now();
    const feeBps = platformFeeBps();
    const placed = await db
      .select({
        id: trades.id,
        tokenId: trades.tokenId,
        amountUsd: trades.amountUsd,
        requestedUsd: trades.requestedUsd,
        proposedAt: trades.proposedAt,
        decidedAt: trades.decidedAt,
        createdAt: trades.createdAt,
      })
      .from(trades)
      .where(
        and(
          eq(trades.agentId, agentId),
          inArray(trades.status, ["pending", "submitted"]),
          eq(trades.side, "buy"),
          eq(trades.isPaper, agent.mode === "paper"),
        ),
      );
    buysInFlight = placed
      // An approved proposal was written when it was proposed and placed when it was
      // claimed, which is `decidedAt`; every other order is placed as its row is written.
      .map((row) => ({ row, at: (row.decidedAt ?? row.createdAt).getTime() }))
      .filter(({ at }) => nowMs - at < BUY_IN_FLIGHT_MS)
      .map(({ row, at }) => ({
        tradeId: row.id,
        tokenId: row.tokenId,
        costUsd: buyCostUsd(toNum(row.requestedUsd ?? row.amountUsd), feeBps),
        at,
        approved: row.proposedAt !== null,
      }));

    // A balance from the indexer can still show money a buy of the last few minutes has
    // already spent. Under a reserve those buys are taken off it. (When it has caught up
    // they are taken off twice, for a few minutes, which refuses a buy and never lets one
    // through; and it happens only when the chain itself could not be read.)
    if (reserveUsd > 0 && agent.mode === "live" && indexedChains.length > 0) {
      const settled = await db
        .select({ amountUsd: trades.amountUsd })
        .from(trades)
        .where(
          and(
            eq(trades.agentId, agentId),
            eq(trades.status, "filled"),
            eq(trades.side, "buy"),
            eq(trades.isPaper, false),
            inArray(trades.chain, indexedChains),
            gte(trades.filledAt, new Date(nowMs - INDEXER_LAG_MS)),
          ),
        );
      cashUnseenUsd = settled.reduce((sum, row) => sum + toNum(row.amountUsd), 0);
    }
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
    ...(cashReadAt ? { cashReadAt } : {}),
    ...(pendingBuyTokenIds ? { pendingBuyTokenIds } : {}),
    ...(buysInFlight.length > 0 ? { buysInFlight } : {}),
    ...(cashUnseenUsd > 0 ? { cashUnseenUsd } : {}),
  };
}

/**
 * Whether one of the agent's paid steps was in flight when its wallet was read at
 * `readAt`: signed within `PAYMENT_IN_FLIGHT_MS` of that moment, and either not resolved
 * yet or resolved only afterwards.
 *
 * Such a payment's transfer may or may not be in the balance that was read, and nothing
 * here can tell which. A row resolved BEFORE the read is not in flight: the receipt that
 * resolved it says its transfer had settled, so the balance holds it. (That is taken on
 * the gateway's word, and for an answered step with no receipt on no word at all:
 * `thinkingFlowAtSql` says what follows if it is wrong.) Nor is a row signed longer ago
 * than a transfer can take to land, whatever its status: if it landed at all, it landed
 * before the read.
 *
 * Never throws. If the ledger cannot be read the answer is "no", and the mark is written
 * as it always was: a mark that may sit on the wrong side of one step's price is better
 * than a book with no marks.
 */
async function paidStepInFlight(agentId: string, readAt: Date): Promise<boolean> {
  try {
    const db = await getDb();
    const from = new Date(readAt.getTime() - PAYMENT_IN_FLIGHT_MS);
    const until = new Date(readAt.getTime() + PAYMENT_IN_FLIGHT_MS);
    const rows = await db
      .select({ id: inferencePayments.id })
      .from(inferencePayments)
      .where(
        and(
          eq(inferencePayments.agentId, agentId),
          // The ledger's index is on (agent, created). A row is written, then signed, so
          // one signed in the window was created no earlier than a little before it.
          gte(inferencePayments.createdAt, new Date(from.getTime() - PAYMENT_IN_FLIGHT_MS)),
          isNotNull(inferencePayments.signedAt),
          gt(inferencePayments.signedAt, from),
          // A signature dated far ahead of this clock is a broken clock, not a payment in flight.
          lte(inferencePayments.signedAt, until),
          or(isNull(inferencePayments.resolvedAt), gte(inferencePayments.resolvedAt, readAt)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    console.warn(`[portfolio] ${agentId}: could not tell whether a paid step was in flight: ${dbErrorForLog(err)}`);
    return false;
  }
}

/**
 * Shape the risk guard consumes. Every buy is checked against this, so this is where
 * what is held back for thinking stops being spendable: the guard sees the cash a buy may
 * use, and the full equity for its concentration cap.
 */
export function toRiskPortfolio(portfolio: Portfolio, deciding?: DecidingProposal): RiskPortfolio {
  // Only an approval passes `deciding`: the proposal it is carrying out is itself in
  // flight by then, and is left out of what it is judged against (`buysCounted`).
  const inFlight = buysCounted(portfolio, deciding);
  return {
    // What a buy may spend, and what of the agent's cash that leaves out: the guard sets
    // the owner's cash reserve against both. Nothing is added for an agent that holds
    // nothing back.
    ...guardCash(portfolio, deciding),
    // Only on the book of an agent with a position limit, the rule that counts them.
    ...(portfolio.pendingBuyTokenIds ? { pendingBuyTokenIds: portfolio.pendingBuyTokenIds } : {}),
    // Only while an agent with a limit or a reserve has a buy in flight.
    ...(inFlight.length > 0 ? { inFlightBuyTokenIds: [...new Set(inFlight.map((buy) => buy.tokenId))] } : {}),
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
 *
 * And one rule for a live agent that pays for its own thinking, on the same principle:
 *
 *  - **A paid step in flight is a gap too.** Each step's price leaves the wallet some
 *    seconds after it is signed for, and is taken back out of the P&L as a flow dated
 *    when the step was resolved (`thinkingFlowAtSql`, src/server/queries/_shared.ts). A
 *    mark read between the two holds, or does not hold, a payment whose flow falls on
 *    one side of it or the other, and the two need not agree: the step's price then
 *    reads as a gain nobody made, at once or when that mark is later a window's
 *    baseline. So while one of the agent's steps is in flight (`paidStepInFlight`) no
 *    mark is written. A step is in flight for seconds, a run's last mark is taken after
 *    its last step has resolved, and the marks pass comes round again in five minutes.
 *    Every other agent's mark is written exactly as before: nothing is read for it.
 *
 * And one for a paper book:
 *
 *  - **A mark measured against a balance that has since changed is not written.** An
 *    owner may change the paper starting balance while the book is untouched
 *    (`changePaperBalance`, src/lib/trading/paper-history.ts), and that change deletes the
 *    book's marks, each of them a flat point at the old balance. A mark worked out a
 *    moment before the change and written a moment after it would put one of those points
 *    back, for good. So a paper mark is written only while the agent's balance is still
 *    the one the book was read with (`startingUsd`). The balance is read under a
 *    `FOR KEY SHARE` lock, in one transaction with the insert, and that lock and the
 *    change's `FOR UPDATE` shut each other out: the mark lands wholly before the change,
 *    which then deletes it, or it reads the new balance and is not written. A live mark
 *    is written exactly as before.
 */
export async function snapshotEquity(portfolio: Portfolio): Promise<boolean> {
  if (portfolio.cashReadFailed) {
    console.warn(`[portfolio] ${portfolio.agentId}: skipping equity snapshot — a live balance read failed`);
    return false;
  }
  if (portfolio.mode === "live" && portfolio.cashReadAt && (await paidStepInFlight(portfolio.agentId, portfolio.cashReadAt))) {
    console.warn(`[portfolio] ${portfolio.agentId}: skipping equity snapshot: a paid step was in flight when the wallet was read`);
    return false;
  }
  const db = await getDb();
  const mark = {
    id: nanoid(),
    agentId: portfolio.agentId,
    equityUsd: portfolio.equityUsd.toFixed(6),
    cashUsd: portfolio.cashUsd.toFixed(6),
    mode: portfolio.mode,
  };
  if (portfolio.mode === "paper") {
    return db.transaction(
      async (tx) => {
        const [book] = await tx
          .select({ paperStartingUsd: agents.paperStartingUsd })
          .from(agents)
          .where(eq(agents.id, portfolio.agentId))
          .limit(1)
          .for("key share");
        if (!book || Number(book.paperStartingUsd) !== portfolio.startingUsd) return false;
        await tx.insert(equitySnapshots).values(mark);
        return true;
      },
      // Set by hand: once the lock has been waited for, the row must be read as it is
      // now, which a transaction that kept its first view of the database would not do.
      { isolationLevel: "read committed" },
    );
  }
  await db.insert(equitySnapshots).values(mark);
  return true;
}

/**
 * The largest buy the risk guard would actually let through right now, for a token not
 * already held, and the binding constraint (W7 H11).
 *
 * The sizing ceiling on its own is not the answer, and printing it alone was actively
 * misleading: a $10 wallet under the first-trade preset was told its clip was $2 while
 * `maxPositionPct` refused anything over $1. Three limits apply to every buy and the
 * smallest wins — the sizing mode, the concentration cap, and the largest buy the
 * agent's cash covers together with the platform fee on that buy. The model should be
 * told the number it has, and why, rather than being made to discover it by being
 * refused.
 */
export function effectiveTicketUsd(
  portfolio: BookCash & Pick<Portfolio, "equityUsd">,
  config: AgentConfig,
): { amountUsd: number; reason: string } {
  const feeBps = platformFeeBps();
  // The guard's own arithmetic over what the guard will be handed (`toRiskPortfolio`), so
  // the number the model is told is the number it has.
  const ceiling = ticketCeiling(config, { ...guardCash(portfolio), equityUsd: portfolio.equityUsd }, feeBps);
  const spendable = cashForBuysUsd(portfolio, config);
  const reserveUsd = readCashReserveUsd(config.risk);
  const thinking = (portfolio.thinkingReserveUsd ?? 0) > 0;
  // How MUCH is kept back for thinking is never put into words. It is worked out from a
  // limit only the owner may read (twice the limit for one run, plus a fixed floor), and
  // this sentence goes to a model whose rationale, posts and summary are public. The
  // model is told that part of its cash is kept back, and what it may trade with. The
  // owner's cash reserve is a figure the model is given, like its other limits.
  const cashWords = thinking
    ? `the $${spendable.toFixed(2)} of your cash that is available to trade (part of your cash is kept back ${
        reserveUsd > 0 ? "for your cash reserve and to pay for your thinking" : "to pay for your thinking"
      })`
    : reserveUsd > 0
      ? `the $${spendable.toFixed(2)} of your cash that is above your $${reserveUsd.toFixed(2)} cash reserve`
      : `cash $${portfolio.cashUsd.toFixed(2)}`;

  const reasons: Record<typeof ceiling.bound, string> = {
    sizing: `${ceiling.sizing.effectiveMode.replace(/_/g, " ")} sizing — ${ceiling.sizing.explanation}`,
    cash: feeBps > 0 ? `${cashWords} less the ${formatFeeRate(feeBps)} Tocker fee charged on the fill` : cashWords,
    concentration: `maxPositionPct ${config.risk.maxPositionPct}% of $${ceiling.equityUsd.toFixed(2)} equity`,
  };
  return { amountUsd: ceiling.amountUsd, reason: reasons[ceiling.bound] };
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
  // The owner's two limits on what may be opened, said in the book and not left to a
  // rejection: how many positions count against the limit, and what the reserve leaves.
  const positions = positionRoom(config.risk, toRiskPortfolio(portfolio));
  if (positions.limit !== null) {
    const left = Math.max(0, positions.limit - positions.open);
    const parts =
      positions.waiting > 0
        ? ` (${positions.held} held, ${positions.waiting} buy${positions.waiting === 1 ? "" : "s"} waiting for your owner)`
        : "";
    // Over the limit (it was lowered under what the agent already had), one sale does
    // not make room, so the book does not say that it does.
    const over = positions.open > positions.limit;
    lines.push(
      `Open positions: ${positions.open} of ${positions.limit} allowed${parts}. ` +
        (over
          ? `You are over the limit: a buy of a token you do not already hold is rejected until the count is back under ${positions.limit}. Adding to a token you hold is still allowed.`
          : left === 0
            ? "You are at the limit: a buy of a token you do not already hold is rejected until a position is sold. Adding to a token you hold is still allowed."
            : `You may open ${left} more. A buy of a token you already hold is not a new position.`) +
        " The limit is your owner's: like your other thresholds, never state it in a rationale, a post or your summary.",
    );
  }
  const reserveUsd = readCashReserveUsd(config.risk);
  const available = cashForBuysUsd(portfolio, config);
  if ((portfolio.thinkingReserveUsd ?? 0) > 0) {
    // Said plainly, or a model that sees $5.00 of cash and a $4.20 ceiling goes looking
    // for the rest. But the amount kept back is NOT said: it is worked out from a limit
    // only the owner may read, and what this model writes (a rationale, a post, its
    // summary) is public. It is given the one figure it sizes with, and asked to keep
    // that out of public text too, because cash less that figure is the amount itself.
    lines.push(
      `Part of that cash is kept back to pay for your own thinking and cannot be spent on a buy: $${available.toFixed(2)} is available to trade.` +
        " How much is kept back follows a limit your owner set: like your other thresholds, never mention it, or the amount available to trade, in a rationale, a post or your summary.",
    );
  }
  if (reserveUsd > 0) {
    lines.push(
      `Cash reserve: your owner keeps $${reserveUsd.toFixed(2)} of your cash out of every buy` +
        ((portfolio.thinkingReserveUsd ?? 0) > 0
          ? ", and the amount available to trade above already allows for it."
          : `, so $${available.toFixed(2)} is available to trade.`) +
        ` A buy that would leave less than $${reserveUsd.toFixed(2)} in cash after its fee is rejected; a sell never is.` +
        " Like your other thresholds, never state the reserve in a rationale, a post or your summary.",
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
