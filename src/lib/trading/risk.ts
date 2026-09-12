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
 * **Exits are never blocked by entry rules.** The blocklist, the score gates,
 * `maxTradeUsd`, `maxDailyTrades` and the enabled-chain list all decide what an agent
 * may *enter*. None of them apply to sells: blocklisting a token you hold, a position
 * that grew past the trade cap, a busy day that used up the trade quota, or a chain
 * switched off after buying would otherwise trap the agent in exactly the tokens it
 * most needs to exit. A sell only has to be for a position that exists, can be
 * priced, and is no larger than what is held.
 */
import type { AgentConfig } from "@/db/schema";
import type { Chain, TokenScore } from "@/server/types";
import { explainBlocker } from "@/lib/tokens/score";

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
}

export type RiskVerdict = { ok: true } | { ok: false; reason: string };

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
    };
  }

  if (score.blockers.length > 0) {
    const explained = score.blockers.map((b) => `${b} (${explainBlocker(b)})`).join("; ");
    return {
      ok: false,
      reason: `${order.symbol} fails ${score.blockers.length === 1 ? "a hard gate" : "hard gates"}: ${explained}. Hard gates cannot be outscored.`,
    };
  }

  if (score.verdict === "avoid") {
    return {
      ok: false,
      reason: `${order.symbol} scores ${score.total.toFixed(1)}/100 with verdict "avoid". This agent does not buy tokens it has judged avoidable.`,
    };
  }

  if (score.total < universe.minScore) {
    return {
      ok: false,
      reason: `${order.symbol} scores ${score.total.toFixed(1)}/100, below this agent's minScore of ${universe.minScore} (safety ${score.components.safety}, liquidity ${score.components.liquidity}, organic ${score.components.organic}, distribution ${score.components.distribution}, momentum ${score.components.momentum}).`,
    };
  }

  return { ok: true };
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
    return { ok: false, reason: "Trade size must be a positive USD amount." };
  }

  const position = portfolio.positions.find((p) => p.tokenId === order.tokenId);

  if (order.side === "buy") {
    // Entry rules — see the header: none of these apply to exits.
    if (!agent.config.chains.includes(order.chain)) {
      return {
        ok: false,
        reason: `Chain ${order.chain} is not enabled for this agent (enabled: ${agent.config.chains.join(", ") || "none"}).`,
      };
    }

    // Subtractive: the operator said never buy this. Selling it stays allowed.
    if (isBlocklisted(agent.config, order.chain, order.tokenAddress, order.symbol)) {
      return {
        ok: false,
        reason: `${order.symbol} (${order.tokenAddress}) is on this agent's blocklist. Remove it from the blocklist in settings to trade it.`,
      };
    }

    if (order.amountUsd > risk.maxTradeUsd) {
      return {
        ok: false,
        reason: `Trade size $${order.amountUsd.toFixed(2)} exceeds maxTradeUsd $${risk.maxTradeUsd.toFixed(2)}.`,
      };
    }

    if (portfolio.tradesToday >= risk.maxDailyTrades) {
      return {
        ok: false,
        reason: `Daily trade limit reached (${portfolio.tradesToday}/${risk.maxDailyTrades}).`,
      };
    }

    const gate = universeGate(agent.config, order, score);
    if (!gate.ok) return gate;

    if (order.amountUsd > portfolio.cashUsd + 1e-9) {
      return {
        ok: false,
        reason: `Insufficient cash: $${portfolio.cashUsd.toFixed(2)} available, $${order.amountUsd.toFixed(2)} requested.`,
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
        };
      }
    }
    return { ok: true };
  }

  if (!position || position.amountToken <= 0) {
    return { ok: false, reason: `No ${order.symbol} position to sell.` };
  }
  if (position.valueUsd === null) {
    return { ok: false, reason: `Cannot price the ${order.symbol} position, refusing to sell blind.` };
  }
  if (order.amountUsd > position.valueUsd + 1e-9) {
    return {
      ok: false,
      reason: `Sell size $${order.amountUsd.toFixed(2)} exceeds the ${order.symbol} position value $${position.valueUsd.toFixed(2)}.`,
    };
  }
  return { ok: true };
}
