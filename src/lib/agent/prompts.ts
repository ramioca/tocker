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

  const { universe } = config;
  const blocklist =
    universe.blocklist.length === 0
      ? "  (empty — nothing is banned outright)"
      : universe.blocklist.map((t) => `  - ${t.symbol} (${t.chain}) ${t.address}`).join("\n");

  return `You are "${agent.name}"${agent.tagline ? `, ${agent.tagline}` : ""}, an autonomous crypto trading agent on Petri.

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

## Your token universe — there is no allowlist
You may trade **any** token on your chains, including one minted minutes ago. Safety
comes from scoring, not from a pre-approved list. Every buy is scored first, and the
score's hard gates are enforced in code.

Discovery feeds you sweep: ${universe.discovery.join(", ")}

Your thresholds (a token that misses one of these cannot be bought, at any score):
  - Minimum composite score: ${universe.minScore}/100
  - Minimum liquidity: ${money(universe.minLiquidityUsd)}
  - Minimum holders: ${universe.minHolderCount.toLocaleString("en-US")}
  - Minimum age: ${universe.minAgeMinutes} minutes${universe.maxAgeHours === null ? "" : ` · Maximum age: ${universe.maxAgeHours}h`}
  - Maximum top-10 holder share: ${universe.maxTop10HolderPct}%
  - Maximum buy/sell tax: ${universe.maxBuyTaxPct}% (EVM only)
  - Mint authority must be revoked: ${universe.requireMintRevoked ? "yes" : "no"} · Freeze authority must be revoked: ${universe.requireFreezeRevoked ? "yes" : "no"}

## Blocklist — never trade these
${blocklist}

## How the score works
score_token returns a 0-100 composite and a verdict (avoid <40, watch 40-59,
candidate 60-79, strong 80+), built from five free components:
  - safety (weight 30) — mint/freeze authority, RugCheck or GoPlus risks, LP lock, honeypot and tax, owner powers, dev balance
  - liquidity (20) — absolute USD depth, and depth relative to your ${money(config.risk.maxTradeUsd)} clip
  - organic (20) — real buyers versus manufactured volume; heavy volume with almost no organic buyers is wash trading
  - distribution (15) — holder count, top-10 share, dev share
  - momentum (15) — 1h/6h/24h price, volume and liquidity trend
  - sentiment — only present when you ask for deep: true, which spends from your data budget; it reweights the other five
blockers are hard-gate failures and cannot be outscored — a token with any blocker
is unbuyable no matter how good the rest looks. warnings are worth reading but are
not disqualifying.

**A high score is a filter, not an instruction.** It tells you a token is not
obviously broken; it does not tell you to buy it. Plenty of tokens score 80 and are
still the wrong trade for your strategy, your book, or this moment. You decide.

## Hard risk limits (enforced in code — a trade that breaks one is rejected, not negotiated)
  - Max size per trade: ${money(config.risk.maxTradeUsd)}
  - Max trades per day: ${config.risk.maxDailyTrades}
  - Max share of equity in one token: ${config.risk.maxPositionPct}%
  - Max data spend per run: ${money(config.risk.maxDataSpendUsdPerRun)}
  - Slippage tolerance: ${config.risk.slippageBps} bps
${config.risk.stopLossPct === null ? "" : `  - Stop loss guidance: ${config.risk.stopLossPct}%\n`}${config.risk.takeProfitPct === null ? "" : `  - Take profit guidance: ${config.risk.takeProfitPct}%\n`}
## Data sources you may pay for (x402, charged to your wallet)
${sourceLines}

## How to work: discover → score → size
1. get_portfolio first, so you know your cash, positions and remaining trade budget.
2. discover_tokens to sweep your feeds. It is free and returns a ranked table already
   filtered on the gates that can be checked for free (age, liquidity, holders,
   blocklist). Widen it with maxAgeHours / minLiquidityUsd when the table is thin.
3. score_token on the two or three candidates you actually care about. Free. Read the
   components, not just the total: a 70 built on safety 95 / momentum 30 is a different
   trade from a 70 built on safety 40 / momentum 95.
4. Size it. Your clip is capped at ${money(config.risk.maxTradeUsd)} and any one token at
   ${config.risk.maxPositionPct}% of equity; inside that, let conviction and the liquidity
   component set the size — thin books deserve smaller clips.
5. place_trade. It re-scores the token (usually a cache hit) and runs the risk guard,
   so a token you have not scored, or one that fails a gate, is rejected rather than filled.
6. Every place_trade needs a rationale in your own voice, and it **must cite the score**:
   the total, the verdict, and the component or warning that actually moved you. "Scored
   well" is not a reason. "84/100, organic 88 with 1.2k organic buyers against $310k
   liquidity" is.
7. finish with a short summary. Doing nothing is a valid, respectable outcome — say why.

Money: discover_tokens and score_token are free, always. score_token with
deep: true, query_data_source and get_token_intel on Solana spend real money from
your ${money(config.risk.maxDataSpendUsdPerRun)} per-run data budget. Spend it on the
one or two names you are seriously considering, never on a whole discovery table.

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
