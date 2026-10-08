/**
 * The risk guard. Every `place_trade` goes through this before an executor is
 * touched — there is no code path that skips it.
 *
 * Pure and synchronous on purpose: the caller assembles the portfolio snapshot and
 * the token's score, this function only decides. Every rejection reason is written
 * for a human, because it is shown to the LLM *and* rendered in the UI.
 *
 * ## What replaced the allowlist
 *
 * There is no allowlist any more. An agent may buy anything on its chains that
 * clears the hard gates and scores above `universe.minScore`. The subtractive
 * `universe.blocklist` is the only list, and the {@link TokenScore} carries the
 * gates. Concretely, a buy is refused when the token is blocklisted, has no score at
 * all, carries any blocker, has verdict `avoid`, or totals below `minScore`.
 *
 * ## Sizing
 *
 * `risk.sizing` (see `./sizing.ts`) decides how big a ticket may be: a fixed dollar
 * amount, a share of equity, or a share of equity shrunk by how wildly the token has
 * been ranging. `maxTradeUsd` is checked first and remains the hard ceiling over every
 * mode, so a sizing mode can only ever tighten the allowance. An agent with no `sizing`
 * block — which is every agent written before this existed — sizes exactly as it did.
 *
 * ## The platform fee
 *
 * A buy has to clear `amountUsd` plus that order's own fee against cash, not `amountUsd`:
 * the Tocker fee is a share of the fill (`PLATFORM_FEE_BPS`) charged the moment it
 * lands, and an agent that spent its last dollar would owe a fee it cannot pay. So the
 * most an agent can buy with cash C is the largest A with A + fee(A) <= C. Sells are
 * untouched — an exit is never blocked, and a sell *adds* cash, so there is nothing to
 * check against.
 *
 * ## The position limit and the cash reserve
 *
 * Two limits an owner may switch on, both off for every config written before them.
 * `risk.maxOpenPositions` refuses a buy that would open a position while the agent
 * already has that many: tokens held above dust, plus tokens with a buy waiting for its
 * owner's approval. A buy of a token already in that count opens nothing and is left to
 * `maxPositionPct`. `risk.cashReserveUsd` refuses a buy that would leave less than that
 * in cash once its fee is paid. Both are enforced here and nowhere else, and
 * {@link roomToBuy} asks the same two questions before any order exists, for the callers
 * that want to know whether a run could buy at all.
 *
 * Both are asked of the book as it is about to be, not only as it was last written. A buy
 * that has passed this guard and has not settled yet is neither a position nor spent
 * cash, and a second buy from another request in those seconds would pass a limit that
 * has room for one. So the caller hands over the agent's buys in flight
 * (`inFlightBuyTokenIds`, `cashSpokenForUsd`): their tokens take a slot, and their cost
 * comes off the cash the reserve is measured against. Neither field is set for an agent
 * with neither limit.
 *
 * **Exits are never blocked by entry rules.** The blocklist, the score gates,
 * `maxTradeUsd`, the sizing ceiling, `maxDailyTrades`, the position limit, the cash
 * reserve and the enabled-chain list all decide what an agent
 * may *enter*. None of them apply to sells: blocklisting a token you hold, a position
 * that grew past the trade cap, a busy day that used up the trade quota, or a chain
 * switched off after buying would otherwise trap the agent in exactly the tokens it
 * most needs to exit. A sell only has to be for a position that exists, can be
 * priced, and is no larger than what is held.
 */
import type { AgentConfig, AgentRiskWithSizing } from "@/db/schema";
import type { Chain, TokenScore } from "@/server/types";
import { explainBlocker } from "@/lib/tokens/score";
import { fmtUsd, fmtUsdExact } from "@/lib/money";
import { buyCostUsd, feeForFill, floorToCents, formatFeeRate, maxBuyUsd, platformFeeBps } from "@/lib/platform/fee";
import { isDustPosition } from "./dust";
import { readCashReserveUsd, readMaxOpenPositions } from "./hard-limits";
import { readSizing, sizeOrder, type SizedOrder } from "./sizing";

// The two readers live in a leaf (`./hard-limits.ts`) so the settings page can use them
// in a browser. They are part of the guard's contract, so they are exported from here too.
export { readCashReserveUsd, readMaxOpenPositions };

export interface RiskAgent {
  id: string;
  mode: "paper" | "live";
  config: AgentConfig;
}

export interface RiskPosition {
  tokenId: string;
  chain: Chain;
  address: string;
  symbol: string;
  amountToken: number;
  /** Mark value in USD; `null` when we could not price it. */
  valueUsd: number | null;
}

export interface RiskPortfolio {
  cashUsd: number;
  equityUsd: number;
  positions: RiskPosition[];
  /** Trades already filled today (UTC), used for `maxDailyTrades`. */
  tradesToday: number;
  /**
   * Tokens with a buy waiting for the owner's approval. They count towards
   * `maxOpenPositions` beside what is held, so an agent cannot queue more positions than
   * it may open. Absent means none, which is every caller with no limit to apply.
   */
  pendingBuyTokenIds?: readonly string[];
  /**
   * Tokens with a buy of this agent's that has passed the guard and has not settled yet:
   * placed by a run, by hand, or by an approval being carried out. They count towards
   * `maxOpenPositions` beside what is held, because held is what they are about to be.
   * Absent means none, which is every caller with no limit to apply.
   */
  inFlightBuyTokenIds?: readonly string[];
  /**
   * Cash that is still in `cashUsd` and already spoken for: what the buys in flight will
   * cost, and what buys of the last few minutes cost when the balance came from an
   * indexer that may not show them yet. Set against the cash reserve and nothing else: a
   * buy that outruns plain cash fails at the venue, but one that outruns the reserve
   * succeeds, so the reserve cannot be measured on money that is already on its way out.
   * Absent means none.
   */
  cashSpokenForUsd?: number;
  /**
   * Cash that is the agent's but was already left out of `cashUsd`: what a pay-per-use
   * agent keeps back for its thinking. The cash reserve is measured against all of the
   * agent's cash, so this is what the reserve already has before `cashUsd` is touched.
   * Absent means nothing was left out.
   */
  cashHeldBackUsd?: number;
}

export interface OrderIntent {
  chain: Chain;
  side: "buy" | "sell";
  tokenId: string;
  tokenAddress: string;
  symbol: string;
  amountUsd: number;
  /**
   * Recent high-to-low range as a percent of price, for `volatility_scaled` sizing.
   * Optional: absent, the guard falls back to the 24h move on the score, and absent
   * that too the mode degrades to percent-of-equity. See `./sizing.ts`.
   */
  rangePct?: number | null;
}

/**
 * Which rule refused an order. `reason` is written for the model — it names config keys
 * (`maxTradeUsd`), gate codes and the tool to call next, because that is what lets an
 * agent correct itself — and narrate.ts classifies it by those words. A person needs
 * different words for the same fact, so the rule and its numbers travel alongside and
 * `ownerRiskMessage` (./risk-copy.ts) writes the owner's sentence from them.
 */
export type RiskCode =
  | "bad_size"
  | "chain_disabled"
  | "blocklisted"
  | "max_trade"
  | "sizing"
  | "daily_limit"
  | "position_limit"
  | "no_score"
  | "hard_gates"
  | "avoid"
  | "min_score"
  | "cash"
  | "cash_reserve"
  | "concentration"
  | "no_position"
  | "unpriced"
  | "oversell";

/** The numbers behind a refusal. Only the ones its `code` uses are set. */
export interface RiskParams {
  symbol?: string;
  chain?: Chain;
  enabled?: Chain[];
  amountUsd?: number;
  capUsd?: number;
  /** Sizing mode that bound the ticket, e.g. "pct equity". */
  mode?: string;
  pct?: number;
  capPct?: number;
  blockers?: string[];
  total?: number;
  minScore?: number;
  cashUsd?: number;
  /** The Tocker fee this order would pay, and the rate it was worked out at. */
  feeUsd?: number;
  feeBps?: number;
  /** The largest buy the cash covers with its fee, in whole cents. */
  maxBuyUsd?: number;
  tradesToday?: number;
  maxDailyTrades?: number;
  positionUsd?: number;
  /** `position_limit`: the limit, what counts against it, and its parts. */
  maxOpenPositions?: number;
  openPositions?: number;
  heldPositions?: number;
  waitingBuys?: number;
  /** Tokens not held yet that an order already placed is buying. Set only when there are any. */
  placingBuys?: number;
  /** The owner's cash reserve, when one is set, and the cash this buy would have left. */
  reserveUsd?: number;
  leftUsd?: number;
  /** `cash_reserve`: the agent's buys still settling that `leftUsd` already allows for. */
  settlingUsd?: number;
}

export type RiskVerdict = { ok: true } | { ok: false; reason: string; code?: RiskCode; params?: RiskParams };

function sameAddress(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

/** True when the operator has explicitly told this agent never to touch the token. */
export function isBlocklisted(config: AgentConfig, chain: Chain, address: string, symbol: string): boolean {
  return config.universe.blocklist.some(
    (t) => t.chain === chain && (sameAddress(t.address, address) || t.symbol.toUpperCase() === symbol.toUpperCase()),
  );
}

/**
 * The universe gate: everything that depends on the token's score. Split out so the
 * agent tools can explain a refusal before a trade is even attempted.
 *
 * `score === null` is a refusal, not a pass — "no score means no buy".
 */
export function universeGate(config: AgentConfig, order: OrderIntent, score: TokenScore | null): RiskVerdict {
  const { universe } = config;

  if (score === null) {
    return {
      ok: false,
      reason: `No score for ${order.symbol}. Call score_token({ chain: "${order.chain}", address: "${order.tokenAddress}" }) first — this agent never buys a token it has not scored.`,
      code: "no_score",
      params: { symbol: order.symbol },
    };
  }

  if (score.blockers.length > 0) {
    const explained = score.blockers.map((b) => `${b} (${explainBlocker(b)})`).join("; ");
    return {
      ok: false,
      reason: `${order.symbol} fails ${score.blockers.length === 1 ? "a hard gate" : "hard gates"}: ${explained}. Hard gates cannot be outscored.`,
      code: "hard_gates",
      params: { symbol: order.symbol, blockers: [...score.blockers] },
    };
  }

  if (score.verdict === "avoid") {
    return {
      ok: false,
      reason: `${order.symbol} scores ${score.total.toFixed(1)}/100 with verdict "avoid". This agent does not buy tokens it has judged avoidable.`,
      code: "avoid",
      params: { symbol: order.symbol, total: score.total },
    };
  }

  if (score.total < universe.minScore) {
    return {
      ok: false,
      reason: `${order.symbol} scores ${score.total.toFixed(1)}/100, below this agent's minScore of ${universe.minScore} (safety ${score.components.safety}, liquidity ${score.components.liquidity}, organic ${score.components.organic}, distribution ${score.components.distribution}, momentum ${score.components.momentum}).`,
      code: "min_score",
      params: { symbol: order.symbol, total: score.total, minScore: universe.minScore },
    };
  }

  return { ok: true };
}

/**
 * The size ceiling for one buy, under this agent's sizing mode.
 *
 * Split out so the tools, the manual sheet and the prompt can all show the *same*
 * number before an order is written, rather than discovering it in a rejection.
 *
 * `rangePct` comes from the order when the caller measured one; otherwise the absolute
 * 24h move on the score stands in for it. That substitute is a floor, not the true
 * high-to-low range, so it is used only when nothing better was supplied — and it is
 * still better than sizing a token that moved 80% today as though it were calm.
 */
export function sizeCeiling(
  config: AgentConfig,
  portfolio: Pick<RiskPortfolio, "cashUsd" | "equityUsd">,
  order: Pick<OrderIntent, "rangePct">,
  score: TokenScore | null = null,
): SizedOrder {
  const risk = config.risk as AgentRiskWithSizing;
  const rangePct =
    order.rangePct ??
    (score !== null && typeof score.priceChange24hPct === "number" && Number.isFinite(score.priceChange24hPct)
      ? Math.abs(score.priceChange24hPct)
      : null);
  return sizeOrder({
    sizing: readSizing(risk),
    maxTradeUsd: risk.maxTradeUsd,
    equityUsd: portfolio.equityUsd > 0 ? portfolio.equityUsd : portfolio.cashUsd > 0 ? portfolio.cashUsd : null,
    rangePct,
  });
}

type Risk = AgentConfig["risk"];

/** What the position count is read from. */
type BookPositions = Pick<RiskPortfolio, "positions" | "pendingBuyTokenIds" | "inFlightBuyTokenIds">;

/** What counts against `maxOpenPositions` right now. */
export interface PositionRoom {
  /** The limit, or null when the owner set none. */
  limit: number | null;
  /** Tokens that count: held above dust, being bought, or with a buy waiting for approval. */
  open: number;
  /** Of those, the tokens actually held. */
  held: number;
  /** Tokens not held that have a buy waiting for the owner's approval. */
  waiting: number;
  /**
   * Tokens not held yet that an order already placed is buying right now. Set only when
   * there are any, which is only ever on a book read to judge a buy.
   */
  placing?: number;
  /** A buy that would open a position is refused. Always false with no limit. */
  full: boolean;
}

/**
 * The tokens that count as positions. Held means held above dust: a remainder under
 * `DUST_POSITION_USD` has left the book and no exit rule watches it, so it does not
 * take a slot. A position that cannot be priced is still a position. One that is being
 * sold counts until the sale lands, because until then it is still held. And a token
 * with a buy in flight takes a slot from the moment the order is placed: it has passed
 * the guard, and it will be a position before anyone can stop it. Each token is counted
 * once, as the first of held, being bought, waiting.
 */
function countedTokens(portfolio: BookPositions): {
  held: Set<string>;
  placing: Set<string>;
  waiting: Set<string>;
} {
  const held = new Set<string>();
  for (const position of portfolio.positions) {
    if (position.amountToken > 0 && !isDustPosition(position.valueUsd)) held.add(position.tokenId);
  }
  const placing = new Set<string>();
  for (const tokenId of portfolio.inFlightBuyTokenIds ?? []) {
    if (!held.has(tokenId)) placing.add(tokenId);
  }
  const waiting = new Set<string>();
  for (const tokenId of portfolio.pendingBuyTokenIds ?? []) {
    if (!held.has(tokenId) && !placing.has(tokenId)) waiting.add(tokenId);
  }
  return { held, placing, waiting };
}

/** How many positions the agent has against its limit. Pure. */
export function positionRoom(risk: Risk | null | undefined, portfolio: BookPositions): PositionRoom {
  const limit = readMaxOpenPositions(risk);
  const { held, placing, waiting } = countedTokens(portfolio);
  const open = held.size + placing.size + waiting.size;
  return {
    limit,
    open,
    held: held.size,
    waiting: waiting.size,
    ...(placing.size > 0 ? { placing: placing.size } : {}),
    full: limit !== null && open >= limit,
  };
}

/**
 * Whether a buy of this token would open a position: it is not held above dust and has
 * no buy already waiting for approval. Adding to a token that is held or waiting opens
 * nothing.
 *
 * A token that is only being bought, by an order still in flight, is not yet one the
 * agent holds: that order may fail, and a second buy let through as an "add" would then
 * be the one that opened the position. So at the limit it waits for the first to settle.
 */
export function opensPosition(portfolio: BookPositions, tokenId: string): boolean {
  const { held } = countedTokens(portfolio);
  return !held.has(tokenId) && !(portfolio.pendingBuyTokenIds ?? []).includes(tokenId);
}

/**
 * A portfolio as an approval judges it: what is held, and nothing that is only waiting.
 * The owner is deciding one proposal, and the others are not positions yet. Counting
 * them would refuse the one in hand because of ones that may never be approved. Buys in
 * flight are another matter and stay: those were approved, or placed, and are filling.
 */
export function withoutWaitingBuys(portfolio: RiskPortfolio): RiskPortfolio {
  if (portfolio.pendingBuyTokenIds === undefined) return portfolio;
  return { ...portfolio, pendingBuyTokenIds: [] };
}

/** What the cash a buy may spend is read from. */
type BookCash = Pick<RiskPortfolio, "cashUsd" | "cashHeldBackUsd" | "cashSpokenForUsd">;

/** `cashSpokenForUsd` as a figure: zero when it is absent or not a positive number. */
function spokenForUsd(portfolio: Pick<RiskPortfolio, "cashSpokenForUsd">): number {
  return portfolio.cashSpokenForUsd !== undefined && portfolio.cashSpokenForUsd > 0 ? portfolio.cashSpokenForUsd : 0;
}

/**
 * The cash a buy may spend: `cashUsd` less whatever part of the owner's reserve is not
 * already covered by cash that was held back. With no reserve this is `cashUsd` itself,
 * untouched, so an agent without one is sized exactly as it was.
 *
 * The reserve is a floor under all of the agent's cash, not a second pile beside what a
 * pay-per-use agent keeps for its thinking: with $20, $0.85 held back and a $5 reserve,
 * a buy may spend $15, and the $5 left is the reserve and the thinking money both.
 *
 * Under a reserve, cash that is already spoken for (`cashSpokenForUsd`) comes off first:
 * it is in the balance now and will not be when the buys it belongs to have settled.
 */
export function buyingCashUsd(risk: Risk | null | undefined, portfolio: BookCash): number {
  const reserveUsd = readCashReserveUsd(risk);
  if (!(reserveUsd > 0)) return portfolio.cashUsd;
  const heldBack = portfolio.cashHeldBackUsd !== undefined && portfolio.cashHeldBackUsd > 0 ? portfolio.cashHeldBackUsd : 0;
  const stillToKeep = reserveUsd - heldBack;
  const keepUsd = stillToKeep > 0 ? stillToKeep : 0;
  const spokenFor = spokenForUsd(portfolio);
  if (keepUsd === 0 && spokenFor === 0) return portfolio.cashUsd;
  return Math.max(0, Math.round((portfolio.cashUsd - spokenFor - keepUsd) * 1e6) / 1e6);
}

/** True once the day's buys are spent. The guard's own test, so nothing else restates it. */
export function dailyLimitReached(risk: Risk, portfolio: Pick<RiskPortfolio, "tradesToday">): boolean {
  return portfolio.tradesToday >= risk.maxDailyTrades;
}

/** The three ceilings every buy of a token not yet held is under. The smallest one binds. */
export interface TicketCeiling {
  /** The largest such buy the guard lets through right now, in USD. Never negative. */
  amountUsd: number;
  /** Which of the three it is. On a tie, the first in this order. */
  bound: "sizing" | "cash" | "concentration";
  sizing: SizedOrder;
  /**
   * The largest buy the cash covers with its fee, after the reserve, in the whole cents
   * an order is written in and rounded down: $5.00 covers a $4.975 buy, and a ceiling
   * told as "$4.98" is one the guard refuses.
   */
  cashUsd: number;
  /** `maxPositionPct` of equity, or null when there is no equity to take a share of. */
  concentrationUsd: number | null;
  /** The equity that share was taken of. */
  equityUsd: number;
}

/**
 * The largest buy the guard would let through right now, for a token not already held,
 * and which limit binds it. Pure. One place for the arithmetic, so the number the model
 * is told, the number that decides whether a run could buy at all, and the guard's own
 * answer cannot drift apart.
 */
export function ticketCeiling(
  config: AgentConfig,
  portfolio: BookCash & Pick<RiskPortfolio, "equityUsd">,
  feeBps: number = platformFeeBps(),
): TicketCeiling {
  const sizing = sizeCeiling(config, portfolio, {});
  const cashUsd = floorToCents(maxBuyUsd(buyingCashUsd(config.risk, portfolio), feeBps));
  const equityUsd = portfolio.equityUsd > 0 ? portfolio.equityUsd : portfolio.cashUsd;
  const concentrationUsd = equityUsd > 0 ? (config.risk.maxPositionPct / 100) * equityUsd : null;

  let bound: TicketCeiling["bound"] = "sizing";
  let lowest = sizing.amountUsd;
  if (cashUsd < lowest) {
    bound = "cash";
    lowest = cashUsd;
  }
  if (concentrationUsd !== null && concentrationUsd < lowest) {
    bound = "concentration";
    lowest = concentrationUsd;
  }
  return { amountUsd: Math.max(0, lowest), bound, sizing, cashUsd, concentrationUsd, equityUsd };
}

/** Whether the agent could open a position right now, and what stands in the way when it could not. */
export type BuyRoom =
  | { ok: true; ticketUsd: number }
  | { ok: false; code: "position_limit"; positions: PositionRoom }
  | { ok: false; code: "ticket"; ticketUsd: number; bound: TicketCeiling["bound"]; smallestUsd: number; reserveUsd: number }
  | { ok: false; code: "daily_limit"; tradesToday: number; maxDailyTrades: number };

/**
 * Whether a buy of a token the agent does not hold could go through right now, asked
 * before any order exists. Pure, and built from the guard's own pieces: its position
 * count, its cash after the reserve and the fee, its ceilings, its daily count. So at
 * the position limit, or with the day's buys spent, "no room" is a buy
 * {@link riskGuard} refuses whatever the token and the size; and for want of a ticket it
 * is every buy of `smallestUsd` or more.
 *
 * No room means one of three things, looked at in this order: the agent is at its
 * position limit; the largest ticket it is allowed is smaller than `smallestUsd`, the
 * smallest order the caller counts as worth placing; or the day's buys are spent. The
 * ticket is usually bound by cash (what is left after the reserve and the fee), and it
 * says so in `bound` when it is the sizing mode or the concentration cap instead.
 *
 * Adding to a token already held is not what this asks about: at the position limit an
 * add can still pass the guard, and the answer here is still no room.
 */
export function roomToBuy(
  agent: Pick<RiskAgent, "config">,
  portfolio: RiskPortfolio,
  options: { smallestUsd: number; feeBps?: number },
): BuyRoom {
  const { risk } = agent.config;
  const positions = positionRoom(risk, portfolio);
  if (positions.full) return { ok: false, code: "position_limit", positions };

  const ticket = ticketCeiling(agent.config, portfolio, options.feeBps ?? platformFeeBps());
  if (ticket.amountUsd < options.smallestUsd) {
    return {
      ok: false,
      code: "ticket",
      ticketUsd: ticket.amountUsd,
      bound: ticket.bound,
      smallestUsd: options.smallestUsd,
      reserveUsd: readCashReserveUsd(risk),
    };
  }

  if (dailyLimitReached(risk, portfolio)) {
    return { ok: false, code: "daily_limit", tradesToday: portfolio.tradesToday, maxDailyTrades: risk.maxDailyTrades };
  }
  return { ok: true, ticketUsd: ticket.amountUsd };
}

/**
 * The full guard.
 *
 * @param score the token's {@link TokenScore} at this instant. Required for buys;
 *   ignored for sells, which are governed by the position checks instead.
 */
export function riskGuard(
  agent: RiskAgent,
  portfolio: RiskPortfolio,
  order: OrderIntent,
  score: TokenScore | null = null,
): RiskVerdict {
  const { risk } = agent.config;

  if (!Number.isFinite(order.amountUsd) || order.amountUsd <= 0) {
    return { ok: false, reason: "Trade size must be a positive USD amount.", code: "bad_size" };
  }

  const position = portfolio.positions.find((p) => p.tokenId === order.tokenId);

  if (order.side === "buy") {
    // Entry rules — see the header: none of these apply to exits.
    if (!agent.config.chains.includes(order.chain)) {
      return {
        ok: false,
        reason: `Chain ${order.chain} is not enabled for this agent (enabled: ${agent.config.chains.join(", ") || "none"}).`,
        code: "chain_disabled",
        params: { symbol: order.symbol, chain: order.chain, enabled: [...agent.config.chains] },
      };
    }

    // Subtractive: the operator said never buy this. Selling it stays allowed.
    if (isBlocklisted(agent.config, order.chain, order.tokenAddress, order.symbol)) {
      return {
        ok: false,
        reason: `${order.symbol} (${order.tokenAddress}) is on this agent's blocklist. Remove it from the blocklist in settings to trade it.`,
        code: "blocklisted",
        params: { symbol: order.symbol },
      };
    }

    if (order.amountUsd > risk.maxTradeUsd) {
      return {
        ok: false,
        reason: `Trade size ${fmtUsd(order.amountUsd)} exceeds maxTradeUsd ${fmtUsd(risk.maxTradeUsd)}.`,
        code: "max_trade",
        params: { symbol: order.symbol, amountUsd: order.amountUsd, capUsd: risk.maxTradeUsd },
      };
    }

    // Sizing mode. `maxTradeUsd` above is the hard ceiling and is checked first, so a
    // mode can only ever make the allowance *smaller* — never larger. A `fixed_usd`
    // agent (the default, and every config written before sizing existed) lands on
    // exactly `maxTradeUsd` here and this check is a no-op for it.
    const ceiling = sizeCeiling(agent.config, portfolio, order, score);
    if (order.amountUsd > ceiling.amountUsd + 1e-9) {
      return {
        ok: false,
        reason: `Trade size ${fmtUsd(order.amountUsd)} exceeds what this agent's ${ceiling.effectiveMode.replace(
          /_/g,
          " ",
        )} sizing allows right now (${fmtUsd(ceiling.amountUsd)}): ${ceiling.explanation}`,
        code: "sizing",
        params: {
          symbol: order.symbol,
          amountUsd: order.amountUsd,
          capUsd: ceiling.amountUsd,
          mode: ceiling.effectiveMode.replace(/_/g, " "),
        },
      };
    }

    if (dailyLimitReached(risk, portfolio)) {
      return {
        ok: false,
        reason: `Daily buy limit reached (${portfolio.tradesToday}/${risk.maxDailyTrades} buys today; sells and exits never count). It resets at 00:00 UTC, or raise Max trades per day under Risk.`,
        code: "daily_limit",
        params: { tradesToday: portfolio.tradesToday, maxDailyTrades: risk.maxDailyTrades },
      };
    }

    // The position limit, when the owner set one. Only a buy that would open a position
    // is asked: an add to a token already counted changes nothing here and is left to
    // the concentration cap below. With no limit `full` is never true.
    const positions = positionRoom(risk, portfolio);
    if (positions.full && positions.limit !== null && opensPosition(portfolio, order.tokenId)) {
      const many = positions.limit === 1 ? "position" : "positions";
      const placing = positions.placing ?? 0;
      // What counts beside what is held, each named: "holds 2" under a limit of 3 would
      // read as room for one more.
      const beside = [
        placing > 0 ? `${placing} more being bought right now` : null,
        positions.waiting > 0
          ? `${positions.waiting} more buy${positions.waiting === 1 ? "" : "s"} waiting for its owner's approval`
          : null,
      ].filter((part): part is string => part !== null);
      const holds = beside.length === 0 ? `holds ${positions.held}` : `holds ${positions.held} with ${beside.join(" and ")}`;
      // How many have to go before one can be opened. One, unless the limit was lowered
      // under what the agent already had: told "sell a position first" with five against
      // a limit of three, it sells one and is refused again in the same words.
      const toFree = positions.open - positions.limit + 1;
      const wayOut =
        toFree > 1
          ? `${toFree} of them have to go before a new one can be opened; until then it may only add to a token it already holds.`
          : placing > 0
            ? // An order still filling settles in seconds, as a position or as nothing.
              "Wait until the order being placed has settled, or add to a token it already holds."
            : "Sell a position first, or add to a token it already holds.";
      return {
        ok: false,
        reason: `Position limit reached: this agent may hold at most ${positions.limit} ${many} and ${holds} (maxOpenPositions). ${order.symbol} would be a new one. ${wayOut} Sells and exits are never blocked by this.`,
        code: "position_limit",
        params: {
          symbol: order.symbol,
          maxOpenPositions: positions.limit,
          openPositions: positions.open,
          heldPositions: positions.held,
          waitingBuys: positions.waiting,
          ...(placing > 0 ? { placingBuys: placing } : {}),
        },
      };
    }

    const gate = universeGate(agent.config, order, score);
    if (!gate.ok) return gate;

    // The ticket *plus* the platform fee that will be charged on it the instant it
    // fills, worked out from this order's own size. Checking the notional alone would
    // let an agent spend its last dollar and then owe a fee it does not have — a debt
    // that only surfaces at settlement, days later.
    const feeBps = platformFeeBps();
    const cost = buyCostUsd(order.amountUsd, feeBps);
    // What the owner told the agent to keep in cash, and the cash a buy may spend once
    // that is set aside. With no reserve the second is `portfolio.cashUsd` itself.
    const reserveUsd = readCashReserveUsd(risk);
    const spendUsd = buyingCashUsd(risk, portfolio);
    if (cost > portfolio.cashUsd + 1e-9) {
      const feeUsd = feeForFill(order.amountUsd, feeBps);
      // The most that would have passed, in the whole cents an order is written in. Said
      // because the figures above it are too close to tell apart: $4.98 against $5.00
      // reads as fitting, and a model that is not told $4.97 asks for $4.98 again.
      const fitsUsd = floorToCents(maxBuyUsd(spendUsd, feeBps));
      // With a reserve the most that fits is less than the cash covers, and saying the
      // cash figure would send the model straight into the reserve's refusal.
      const most =
        reserveUsd > 0
          ? fitsUsd > 0
            ? ` With ${fmtUsd(reserveUsd)} kept in reserve (cashReserveUsd), the most this agent can buy is ${fmtUsd(fitsUsd)}.`
            : ` Its ${fmtUsd(reserveUsd)} cash reserve (cashReserveUsd) leaves nothing to buy with.`
          : fitsUsd > 0
            ? ` The most this cash covers is a ${fmtUsd(fitsUsd)} buy.`
            : "";
      return {
        ok: false,
        reason:
          feeBps > 0
            ? `Insufficient cash: ${fmtUsdExact(portfolio.cashUsd)} available, ${fmtUsdExact(order.amountUsd)} requested plus the ${fmtUsdExact(feeUsd)} Tocker fee (${formatFeeRate(feeBps)} of the fill).${most}`
            : `Insufficient cash: ${fmtUsd(portfolio.cashUsd)} available, ${fmtUsd(order.amountUsd)} requested.${reserveUsd > 0 ? most : ""}`,
        code: "cash",
        params: {
          symbol: order.symbol,
          amountUsd: order.amountUsd,
          cashUsd: portfolio.cashUsd,
          feeUsd,
          feeBps,
          maxBuyUsd: fitsUsd,
          ...(reserveUsd > 0 ? { reserveUsd } : {}),
        },
      };
    }
    // The cash covers it, but not with the reserve still standing. Written so that a
    // figure that is not a number refuses: a reserve is never waved through on a bad read.
    if (reserveUsd > 0 && !(cost <= spendUsd + 1e-9)) {
      const feeUsd = feeForFill(order.amountUsd, feeBps);
      const fitsUsd = floorToCents(maxBuyUsd(spendUsd, feeBps));
      // All of the agent's cash, less what this buy would take: the figure the reserve is
      // a floor under. Printed exactly, because at the boundary it is the reserve to the cent.
      // Its buys still settling come off too, and are named: without them the sentence
      // would give a figure above the reserve as the reason for refusing.
      const settlingUsd = spokenForUsd(portfolio);
      const leftUsd = Math.round((portfolio.cashUsd + (portfolio.cashHeldBackUsd ?? 0) - settlingUsd - cost) * 1e6) / 1e6;
      const settling = settlingUsd > 0 ? ` once the ${fmtUsd(settlingUsd)} of buys it has already placed have settled` : "";
      // Under zero only when the buys still settling take more than this one leaves.
      const leaves = leftUsd < 0 ? "nothing" : fmtUsdExact(leftUsd);
      return {
        ok: false,
        reason: `Cash reserve: this buy${feeBps > 0 ? " and its Tocker fee" : ""} would leave ${leaves} in cash${settling}, and this agent keeps ${fmtUsd(reserveUsd)} in reserve (cashReserveUsd). ${
          fitsUsd > 0
            ? `The most it can buy right now is ${fmtUsd(fitsUsd)}.`
            : "It cannot buy until it holds more cash."
        } Sells and exits are never blocked by this.`,
        code: "cash_reserve",
        params: {
          symbol: order.symbol,
          amountUsd: order.amountUsd,
          cashUsd: portfolio.cashUsd,
          feeUsd,
          feeBps,
          maxBuyUsd: fitsUsd,
          reserveUsd,
          leftUsd,
          ...(settlingUsd > 0 ? { settlingUsd } : {}),
        },
      };
    }
    const equity = portfolio.equityUsd > 0 ? portfolio.equityUsd : portfolio.cashUsd;
    if (equity > 0) {
      const currentValue = position?.valueUsd ?? 0;
      const pct = ((currentValue + order.amountUsd) / equity) * 100;
      if (pct > risk.maxPositionPct + 1e-9) {
        return {
          ok: false,
          reason: `Position would be ${pct.toFixed(1)}% of equity, above maxPositionPct ${risk.maxPositionPct}%.`,
          code: "concentration",
          params: { symbol: order.symbol, pct, capPct: risk.maxPositionPct },
        };
      }
    }
    return { ok: true };
  }

  if (!position || position.amountToken <= 0) {
    return { ok: false, reason: `No ${order.symbol} position to sell.`, code: "no_position", params: { symbol: order.symbol } };
  }
  if (position.valueUsd === null) {
    return {
      ok: false,
      reason: `Cannot price the ${order.symbol} position, refusing to sell blind.`,
      code: "unpriced",
      params: { symbol: order.symbol },
    };
  }
  if (order.amountUsd > position.valueUsd + 1e-9) {
    return {
      ok: false,
      reason: `Sell size ${fmtUsd(order.amountUsd)} exceeds the ${order.symbol} position value ${fmtUsd(position.valueUsd)}.`,
      code: "oversell",
      params: { symbol: order.symbol, amountUsd: order.amountUsd, positionUsd: position.valueUsd },
    };
  }
  return { ok: true };
}
