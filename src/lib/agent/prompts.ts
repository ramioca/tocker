/**
 * Prompt construction for one agent tick.
 *
 * The system prompt is the agent's identity + its hard limits; the tick prompt is the
 * perishable state (book, recent trades, remaining budgets, clock). Keeping them
 * separate means the system half is stable enough to cache.
 */
import type { AgentConfig } from "@/db/schema";
import type { DataSource } from "@/lib/data-sources/registry";
import { describePortfolio, type Portfolio } from "./portfolio";

export interface PromptAgent {
  name: string;
  tagline: string | null;
  mode: "paper" | "live";
  config: AgentConfig;
}

export interface RecentTrade {
  side: "buy" | "sell";
  symbol: string;
  chain: string;
  amountUsd: number;
  priceUsd: number;
  status: string;
  createdAt: Date;
  rationale: string | null;
}

function money(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export function buildSystemPrompt(agent: PromptAgent, sources: DataSource[]): string {
  const { config } = agent;
  const sourceLines =
    sources.length === 0
      ? "  (none configured — you may still use search_data_sources to find one in the Bazaar)"
      : sources
          .map(
            (s) =>
              `  - ${s.id}: ${s.name}. ${s.description} [${s.network}, ${s.priceUsd === null ? "price from 402" : money(s.priceUsd)}/call${s.experimental ? ", EXPERIMENTAL — may return sample data" : ""}]`,
          )
          .join("\n");

  const allowlist =
    config.tokenAllowlist.length === 0
      ? "  Any token your data sources surface on the enabled chains."
      : config.tokenAllowlist.map((t) => `  - ${t.symbol} (${t.chain}) ${t.address}`).join("\n");

  return `You are "${agent.name}"${agent.tagline ? `, ${agent.tagline}` : ""}, an autonomous crypto trading agent on Vibe.

## Your strategy (written by your owner — follow it)
${config.strategyPrompt}

## Mode
You are trading in ${agent.mode.toUpperCase()} mode. ${
    agent.mode === "paper"
      ? "Fills are simulated at real quoted prices with a 0.30% fee. Trade exactly as you would with real money."
      : "Trades settle on-chain with real funds. Be deliberate."
  }

## Chains you may trade
${config.chains.join(", ")}

## Token allowlist
${allowlist}

## Hard risk limits (enforced in code — a trade that breaks one is rejected, not negotiated)
  - Max size per trade: ${money(config.risk.maxTradeUsd)}
  - Max trades per day: ${config.risk.maxDailyTrades}
  - Max share of equity in one token: ${config.risk.maxPositionPct}%
  - Max data spend per run: ${money(config.risk.maxDataSpendUsdPerRun)}
  - Slippage tolerance: ${config.risk.slippageBps} bps
${config.risk.stopLossPct === null ? "" : `  - Stop loss guidance: ${config.risk.stopLossPct}%\n`}${config.risk.takeProfitPct === null ? "" : `  - Take profit guidance: ${config.risk.takeProfitPct}%\n`}
## Data sources you may pay for (x402, charged to your wallet)
${sourceLines}

## How to work
1. Start with get_portfolio so you know your cash, positions and remaining trade budget.
2. Buy only the data you actually need — every query_data_source call spends real money against your per-run cap.
3. Form a view, then act: place_trade for a position change, post_note when you want the feed to hear your thinking without trading.
4. Every place_trade needs a rationale in your own voice: one or two sentences a human follower would find useful, naming the signal that moved you.
5. Call finish with a short summary when you are done. Doing nothing is a valid, respectable outcome — say why.

Never claim a trade happened unless the place_trade tool returned status "filled".`;
}

export function buildTickPrompt(input: {
  portfolio: Portfolio;
  config: AgentConfig;
  recentTrades: RecentTrade[];
  dataBudgetRemainingUsd: number;
  trigger: "schedule" | "manual" | "webhook";
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const trades =
    input.recentTrades.length === 0
      ? "  No trades yet."
      : input.recentTrades
          .map(
            (t) =>
              `  ${t.createdAt.toISOString()} ${t.side.toUpperCase()} ${t.symbol} [${t.chain}] ${money(t.amountUsd)} @ ${money(t.priceUsd)} — ${t.status}${t.rationale ? ` — "${t.rationale}"` : ""}`,
          )
          .join("\n");

  return `New tick (${input.trigger}) at ${now.toISOString()}.

## Your book
${describePortfolio(input.portfolio, input.config)}

## Last ${input.recentTrades.length} trades
${trades}

## Remaining budgets this run
  - Data spend: ${money(input.dataBudgetRemainingUsd)} of ${money(input.config.risk.maxDataSpendUsdPerRun)}
  - Trades left today: ${Math.max(0, input.config.risk.maxDailyTrades - input.portfolio.tradesToday)}
  - Cash available: ${money(input.portfolio.cashUsd)}

Decide what, if anything, to do this tick. Finish with the finish tool.`;
}
