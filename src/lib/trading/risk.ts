/**
 * The risk guard. Every `place_trade` goes through this before an executor is touched —
 * there is no code path that skips it.
 *
 * Pure and synchronous on purpose: the caller assembles the portfolio snapshot, this
 * function only decides.
 */
import type { AgentConfig } from "@/db/schema";
import type { Chain } from "@/server/types";

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

export function isAllowlisted(config: AgentConfig, chain: Chain, address: string, symbol: string): boolean {
  if (config.tokenAllowlist.length === 0) return true;
  return config.tokenAllowlist.some(
    (t) => t.chain === chain && (sameAddress(t.address, address) || t.symbol.toUpperCase() === symbol.toUpperCase()),
  );
}

export function riskGuard(agent: RiskAgent, portfolio: RiskPortfolio, order: OrderIntent): RiskVerdict {
  const { risk } = agent.config;

  if (!Number.isFinite(order.amountUsd) || order.amountUsd <= 0) {
    return { ok: false, reason: "Trade size must be a positive USD amount." };
  }

  if (!agent.config.chains.includes(order.chain)) {
    return {
      ok: false,
      reason: `Chain ${order.chain} is not enabled for this agent (enabled: ${agent.config.chains.join(", ") || "none"}).`,
    };
  }

  if (!isAllowlisted(agent.config, order.chain, order.tokenAddress, order.symbol)) {
    return {
      ok: false,
      reason: `${order.symbol} (${order.tokenAddress}) is not on this agent's token allowlist.`,
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

  const position = portfolio.positions.find((p) => p.tokenId === order.tokenId);

  if (order.side === "buy") {
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
