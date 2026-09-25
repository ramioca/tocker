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
 * A buy has to clear `amountUsd + PLATFORM_FEE_USD` against cash, not `amountUsd`: the
 * flat Tocker fee is charged the moment the fill lands, and an agent that spent its last
 * dollar would owe a dime it cannot pay. Sells are untouched — an exit is never blocked,
 * and a sell *adds* cash, so there is nothing to check against.
 *
 * **Exits are never blocked by entry rules.** The blocklist, the score gates,
 * `maxTradeUsd`, the sizing ceiling, `maxDailyTrades` and the enabled-chain list all decide what an agent
 * may *enter*. None of them apply to sells: blocklisting a token you hold, a position
 * that grew past the trade cap, a busy day that used up the trade quota, or a chain
 * switched off after buying would otherwise trap the agent in exactly the tokens it
 * most needs to exit. A sell only has to be for a position that exists, can be
 * priced, and is no larger than what is held.
 */
import type { AgentConfig, AgentRiskWithSizing } from "@/db/schema";
import type { Chain, TokenScore } from "@/server/types";
import { explainBlocker } from "@/lib/tokens/score";
import { fmtUsd } from "@/lib/money";
import { buyCostUsd, platformFeeUsd } from "@/lib/platform/fee";
import { readSizing, sizeOrder, type SizedOrder } from "./sizing";

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
  | "no_score"
  | "hard_gates"
  | "avoid"
  | "min_score"
  | "cash"
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
  feeUsd?: number;
  tradesToday?: number;
  maxDailyTrades?: number;
  positionUsd?: number;
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

    if (portfolio.tradesToday >= risk.maxDailyTrades) {
      return {
        ok: false,
        reason: `Daily buy limit reached (${portfolio.tradesToday}/${risk.maxDailyTrades} buys today; sells and exits never count). It resets at 00:00 UTC, or raise Max trades per day under Risk.`,
        code: "daily_limit",
        params: { tradesToday: portfolio.tradesToday, maxDailyTrades: risk.maxDailyTrades },
      };
    }

    const gate = universeGate(agent.config, order, score);
    if (!gate.ok) return gate;

    // The ticket *plus* the flat platform fee that will be charged the instant it fills.
    // Checking the notional alone would let an agent spend its last dollar and then owe
    // ten cents it does not have — a debt that only surfaces at settlement, days later.
    const feeUsd = platformFeeUsd();
    const cost = buyCostUsd(order.amountUsd, feeUsd);
    if (cost > portfolio.cashUsd + 1e-9) {
      return {
        ok: false,
        reason:
          feeUsd > 0
            ? `Insufficient cash: ${fmtUsd(portfolio.cashUsd)} available, ${fmtUsd(order.amountUsd)} requested plus the ${fmtUsd(feeUsd)} Tocker fee.`
            : `Insufficient cash: ${fmtUsd(portfolio.cashUsd)} available, ${fmtUsd(order.amountUsd)} requested.`,
        code: "cash",
        params: { symbol: order.symbol, amountUsd: order.amountUsd, cashUsd: portfolio.cashUsd, feeUsd },
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
