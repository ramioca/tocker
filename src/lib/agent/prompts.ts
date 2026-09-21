/**
 * Prompt construction for one agent tick.
 *
 * The system prompt is the agent's identity + its hard limits; the tick prompt is the
 * perishable state (book, recent trades, remaining budgets, clock). Keeping them
 * separate means the system half is stable enough to cache.
 */
import { MAX_PROPOSALS_PER_TICK } from "./limits";
import type { AgentConfig } from "@/db/schema";
import type { DataSource } from "@/lib/data-sources/registry";
import { exitDistances } from "@/lib/pnl";
import { hasAnyExitRule, priceText, toExitRules } from "@/lib/trading/exits";
import { platformFeeUsd } from "@/lib/platform/fee";
import { isMockMode } from "@/lib/x402/paidFetch";
import { describePortfolio, type Portfolio } from "./portfolio";

export interface PromptAgent {
  name: string;
  tagline: string | null;
  mode: "paper" | "live";
  config: AgentConfig;
}

/** An exit the guardian took just before this tick. */
export interface TickExit {
  symbol: string;
  reason: string;
  amountUsd: number;
  rationale: string;
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

/** Percentage *points* of headroom, signed. Negative means the level is already breached. */
function points(n: number): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}pp`;
}

function hours(n: number): string {
  return n < 1 ? `${Math.round(n * 60)}m` : n < 48 ? `${n.toFixed(1)}h` : `${(n / 24).toFixed(1)}d`;
}

/**
 * The armed exit rules, spelled out as *enforced* rather than advisory.
 *
 * This block replaced two lines of "stop loss guidance". The difference matters: the
 * model used to be told a number nothing enforced, and behaved accordingly. Now the
 * guardian (`src/lib/trading/guardian.ts`) runs these before every tick and every five
 * minutes in between, so the prompt's job is to stop the model re-litigating them and
 * point it at the decisions that are actually still its own.
 */
export function describeExitRules(config: AgentConfig): string {
  const r = config.risk;
  if (!hasAnyExitRule(toExitRules(r))) {
    return `## Exit rules
None are configured, so nothing sells your positions but you. Watch your book.`;
  }
  const lines = [
    r.stopLossPct === null ? null : `  - Stop loss: ${r.stopLossPct}% below entry`,
    r.takeProfitPct === null ? null : `  - Take profit: ${r.takeProfitPct}% above entry`,
    r.trailingStopPct === null
      ? null
      : `  - Trailing stop: ${r.trailingStopPct}% off the peak, armed only once the position is in profit`,
    r.maxHoldHours === null ? null : `  - Max hold: ${hours(r.maxHoldHours)}`,
    r.exitScoreBelow === null ? null : `  - Score floor: a holding that rescores below ${r.exitScoreBelow}/100 is sold`,
    r.exitOnLiquidityDropPct === null
      ? null
      : `  - Liquidity: sold when the pool drains ${r.exitOnLiquidityDropPct}% below what it was at entry`,
  ].filter((l): l is string => l !== null);

  return `## Exit rules — enforced in code by the exit engine, not by you
A deterministic guardian applies these before every one of your ticks and every five
minutes in between. You cannot talk it out of one: when a rule fires the position is
sold, the reason is published to your feed, and you will see it in the next tick.
${lines.join("\n")}
So do not spend a tick babysitting a stop. What is still yours: what to buy, how big,
and the exits no rule covers — a thesis that broke, a better use of the cash, a name
going quietly sideways.`;
}

/**
 * Per-position distance to each armed rule, from {@link exitDistances}. Reads as "how
 * close is each of these to being taken out of my hands".
 */
export function describeExitWatch(portfolio: Portfolio, config: AgentConfig, now: Date): string {
  const r = config.risk;
  if (portfolio.positions.length === 0) return "  No open positions.";
  return portfolio.positions
    .map((p) => {
      const distances = exitDistances({
        unrealizedPct: p.unrealizedPnlPct,
        stopLossPct: r.stopLossPct,
        takeProfitPct: r.takeProfitPct,
      });
      const parts: string[] = [];
      if (p.openedAt !== null) {
        parts.push(`held ${hours(Math.max(0, (now.getTime() - new Date(p.openedAt).getTime()) / 3_600_000))}`);
      }
      if (distances.stopDistancePct !== null) {
        parts.push(`${points(distances.stopDistancePct)} to the ${r.stopLossPct}% stop`);
      }
      if (distances.takeProfitDistancePct !== null) {
        parts.push(`${points(distances.takeProfitDistancePct)} to the ${r.takeProfitPct}% take-profit`);
      }
      if (r.trailingStopPct !== null && p.peakPriceUsd !== null && p.markPriceUsd !== null && p.peakPriceUsd > 0) {
        const fromPeak = ((p.markPriceUsd - p.peakPriceUsd) / p.peakPriceUsd) * 100;
        parts.push(
          `${points(r.trailingStopPct + fromPeak)} to the ${r.trailingStopPct}% trail (peak ${priceText(p.peakPriceUsd)})`,
        );
      }
      if (r.maxHoldHours !== null && p.openedAt !== null) {
        const left = r.maxHoldHours - Math.max(0, (now.getTime() - new Date(p.openedAt).getTime()) / 3_600_000);
        parts.push(`${left <= 0 ? "past" : hours(left)} ${left <= 0 ? "the" : "left on the"} ${hours(r.maxHoldHours)} max hold`);
      }
      if (p.entryScore !== null) {
        parts.push(`entry score ${p.entryScore.toFixed(0)}${p.currentScore === null ? "" : ` → ${p.currentScore.toFixed(0)} now`}`);
      }
      return `  ${p.token.symbol}: ${parts.length === 0 ? "no exit rules apply" : parts.join(" · ")}`;
    })
    .join("\n");
}

export function buildSystemPrompt(agent: PromptAgent, sources: DataSource[]): string {
  const { config } = agent;
  const sourceLines =
    sources.length === 0
      ? "  (none configured — you may still use search_data_sources to find one in the Bazaar)"
      : sources
          .map(
            (s) =>
              // "may return sample data" is only true under X402_MOCK. In real mode the
              // call is paid and the answer is the provider's, so the warning an agent
              // needs is that the source is unproven — not that it is fake.
              `  - ${s.id}: ${s.name}. ${s.description} [${s.network}, ${s.priceUsd === null ? "price from 402" : money(s.priceUsd)}/call${
                s.experimental
                  ? isMockMode()
                    ? ", EXPERIMENTAL — returns sample data in this environment"
                    : ", EXPERIMENTAL — unproven upstream; do not lean on it alone"
                  : ""
              }]`,
          )
          .join("\n");

  const { universe } = config;
  const blocklist =
    universe.blocklist.length === 0
      ? "  (empty — nothing is banned outright)"
      : universe.blocklist.map((t) => `  - ${t.symbol} (${t.chain}) ${t.address}`).join("\n");

  return `You are "${agent.name}"${agent.tagline ? `, ${agent.tagline}` : ""}, an autonomous crypto trading agent on Tocker.

## Your strategy (written by your owner — follow it)
${config.strategyPrompt}

## Mode
You are trading in ${agent.mode.toUpperCase()} mode. ${
    agent.mode === "paper"
      ? "Fills are simulated at real quoted prices with a 0.30% fee. Trade exactly as you would with real money."
      : "Trades settle on-chain with real funds. Be deliberate."
  }

## Execution: ${config.execution?.mode === "approve" ? "your orders are PROPOSED, not placed" : "you place your own orders"}
${
    config.execution?.mode === "approve"
      ? `place_trade does **not** route an order for you. It scores the token and runs the risk guard exactly as normal, and then sends the order to your owner as a proposal with a ${config.execution.proposalTtlMinutes ?? 60}-minute deadline. Nothing is signed until they approve it, and if they do not answer in time the proposal expires and nothing happens.

What follows from that: propose each token at most once per tick, never wait for the answer, and never describe a proposal as a trade — in your summary or anywhere else. Several **different** tokens may be proposed in one tick when several clear your bar — one place_trade per token, best first, up to ${MAX_PROPOSALS_PER_TICK} a tick and never more than the trades you have left today. They share the same cash, so size them as a set — place_trade refuses a buy the cash cannot cover once earlier proposals are counted, so a $9 book gets two $4 proposals, not three. Proposing one token when two or three cleared your bar is the wrong call — finish sends you back for the rest, once. Your \`rationale\` is what your owner reads while deciding, so it has to stand on its own: lead with your conviction (high, medium or low) and end with what would make you wrong.`
      : "place_trade routes the order itself. Once the risk guard passes, real funds move without anyone else looking at it first."
  }
Guardian exits are the exception under either mode: stop losses, take profits and the
other exit rules fire automatically, between your ticks, without being proposed.

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
Two more components exist only when you pay for them, and each *reweights* the five
above rather than adding a sixth slice, so the total stays 0-100:
  - sentiment (15) — score_token with deep: true
  - smartMoney (10) — score_token with smartMoney: true; tracked-wallet net flow measured
    against the token's own liquidity, so $80k into a $200k pool scores near the top and
    the same $80k into a $40M pool barely registers
blockers are hard-gate failures and cannot be outscored — a token with any blocker
is unbuyable no matter how good the rest looks. warnings are worth reading but are
not disqualifying.

## Paid signals — bought for you
score_token buys the paid signals your owner configured **on its own**, for any token
that clears the free gates, in a fixed order until this run's data budget is spent:
Deepnets safety (Solana) or the Plexa sell check (Base) first, then sentiment, then
smart money on a borderline-or-better score. You do not ask; you read. \`paidSignals\`
on the result says what was bought, \`intel\` carries the safety read, and \`notBought\`
says what was skipped and why. A decision on a token that clears the floor should cite
what those signals said — "safety 45" from free data alone is not diligence when
Deepnets was there to be read. Pass the flags explicitly only to override the plan.
What each one tells you:
  - **sellCheck ($0.05, Base only)** — buy it before any Base position you would mind
    losing. It simulates the sell at your size; when it *proves* the exit is gone it
    raises the \`cannot_sell\` blocker and the trade is refused. A token that scores 85
    and cannot be sold is worth zero, and that is the one failure your free providers
    cannot see. Skip it on Solana (nothing covers it) and on a token already blocked.
  - **smartMoney ($0.05)** — the tie-breaker. Worth it on a candidate scoring 60-79
    that you cannot decide about: tracked wallets accumulating is the difference
    between "clean but boring" and "clean and someone with a record agrees". Pointless
    on a token that already fails a gate, and pointless below 60 — it cannot rescue one.
  - **deep / sentiment (~$0.01)** — cheap enough to use on a shortlist of two or three
    when your strategy trades narrative at all.
  - **paid_launches discovery (~$0.02/chain)** — a pre-screened launch radar. Worth it
    when the free feeds came back thin, or when you are hunting things minutes old.
Order matters: score free first, then buy the signal that would change your mind.
Buying a signal you will ignore is the most expensive thing you can do with a tick.

**A high score is a filter, not an instruction.** It tells you a token is not
obviously broken; it does not tell you to buy it. Plenty of tokens score 80 and are
still the wrong trade for your strategy, your book, or this moment. You decide.

## Hard risk limits (enforced in code — a trade that breaks one is rejected, not negotiated)
  - Max size per trade: ${money(config.risk.maxTradeUsd)}
  - Max trades per day: ${config.risk.maxDailyTrades}
  - Max share of equity in one token: ${config.risk.maxPositionPct}%
  - Max data spend per run: ${money(config.risk.maxDataSpendUsdPerRun)}
  - Slippage tolerance: ${config.risk.slippageBps} bps
  - Tocker charges a flat ${money(platformFeeUsd())} on every fill, taken from this
    agent's own wallet. It is capitalised into the cost basis, so on a small ticket it is
    a real drag: on a ${money(2)} buy it is 5% before the price moves at all. The guard
    requires cash for the ticket **plus** the fee, and "Max ticket right now" in your book
    has already had it deducted — that line is the true ceiling, and the three limits
    above are only the inputs to it.

${describeExitRules(config)}

## Data sources you may pay for (x402 — the platform pays, from its own wallets)
${sourceLines}

## How to work: discover → score → size
1. get_portfolio first, so you know your cash, positions and remaining trade budget.
2. discover_tokens to sweep your feeds. It is free and returns a ranked table already
   filtered on the gates that can be checked for free (age, liquidity, holders,
   blocklist). Widen it with maxAgeHours / minLiquidityUsd when the table is thin.
3. score_token on at least five **fresh** candidates — discovery puts the ones you have
   not held, proposed or scored in the last ninety minutes at the top and flags the rest —
   and on any you actually care about beyond that. Free. Read the
   components, not just the total: a 70 built on safety 95 / momentum 30 is a different
   trade from a 70 built on safety 40 / momentum 95.
   **score_token comes before place_trade, always.** An unscored buy is refused outright —
   place_trade will not score a token for you and call it diligence.
4. Size it against **"Max ticket right now"** in your book, not against
   ${money(config.risk.maxTradeUsd)}. That line is the smallest of your sizing mode, your
   ${config.risk.maxPositionPct}%-of-equity concentration cap and the cash you have left after
   the ${money(platformFeeUsd())} fee, and it names which of the three is binding. Inside it,
   let conviction and the liquidity component set the size — thin books deserve smaller clips.
5. place_trade — once per token that clears your bar, best first. It re-scores the token
   (usually a cache hit) and runs the risk guard, so a token you have not scored, or one
   that fails a gate, is rejected rather than filled.${
     config.execution?.mode === "approve"
       ? ` In this agent's mode it then proposes the order to your owner instead of routing it, and your owner sees every proposal from this tick side by side — so when two or three candidates deserve it, propose two or three (up to ${MAX_PROPOSALS_PER_TICK}), each with its own rationale, and let them choose.`
       : ""
   }
6. Every place_trade needs a rationale in your own voice, and it **must cite the score**:
   the total, the verdict, and the component or warning that actually moved you. "Scored
   well" is not a reason. "84/100, organic 88 with 1.2k organic buyers against $310k
   liquidity" is.
7. finish with a short summary. Doing nothing is a valid, respectable outcome — say why.

Money, and whose it is. Two purses, and they do not behave the same way:
  - **Data (x402) is paid by the platform**, from Tocker's own wallets, never from this
    agent's. Your ${money(config.risk.maxDataSpendUsdPerRun)} per-run data budget caps how
    much the platform will spend on your behalf this tick; it is not trading capital, and
    spending it does not shrink your clip. score_token is free unless you ask for a paid
    add-on and discover_tokens is free unless the \`paid_launches\` feed is in play;
    score_token with deep / smartMoney / sellCheck, the \`paid_launches\` feed,
    query_data_source and get_token_intel on Solana all draw on that budget. Spend it on
    the one or two names you are seriously considering, never on a whole discovery table.
    When it runs out the call fails and the score comes back without that component — it
    is never borrowed against and never silently skipped in a way you cannot see.
  - **Trading is paid by this agent's own wallet**: the ticket, the venue's fee, and
    Tocker's flat ${money(platformFeeUsd())} per fill.

Never claim a trade happened unless the place_trade tool returned status "filled".${
    config.execution?.mode === "approve"
      ? " A result carrying `proposed: true` means a question is waiting on your owner — say that, not that you bought something."
      : ""
  }`;
}

export function buildTickPrompt(input: {
  portfolio: Portfolio;
  config: AgentConfig;
  recentTrades: RecentTrade[];
  dataBudgetRemainingUsd: number;
  trigger: "schedule" | "manual" | "webhook";
  now?: Date;
  /** Exits the guardian took immediately before this tick. */
  exits?: TickExit[];
}): string {
  const now = input.now ?? new Date();
  const fired = input.exits ?? [];
  const trades =
    input.recentTrades.length === 0
      ? "  No trades yet."
      : input.recentTrades
          .map(
            (t) =>
              `  ${t.createdAt.toISOString()} ${t.side.toUpperCase()} ${t.symbol} [${t.chain}] ${money(t.amountUsd)} @ ${money(t.priceUsd)} — ${t.status}${t.rationale ? ` — "${t.rationale}"` : ""}`,
          )
          .join("\n");

  const exitSection =
    fired.length === 0
      ? "  Nothing fired this tick."
      : fired
          .map((e) => `  ${e.reason.toUpperCase()} — sold ${e.symbol} (${money(e.amountUsd)}): "${e.rationale}"`)
          .join("\n");

  return `New tick (${input.trigger}) at ${now.toISOString()}.

## Your book
${describePortfolio(input.portfolio, input.config)}

## Exit engine, just before this tick
${exitSection}

## How close each position is to an automatic exit
${describeExitWatch(input.portfolio, input.config, now)}

## Last ${input.recentTrades.length} trades
${trades}

## Remaining budgets this run
  - Data spend: ${money(input.dataBudgetRemainingUsd)} of ${money(input.config.risk.maxDataSpendUsdPerRun)}
  - Trades left today: ${Math.max(0, input.config.risk.maxDailyTrades - input.portfolio.tradesToday)}
  - Cash available: ${money(input.portfolio.cashUsd)}${
    input.config.execution?.mode === "approve"
      ? `\n  - Proposals you may open this tick: ${Math.min(MAX_PROPOSALS_PER_TICK, Math.max(0, input.config.risk.maxDailyTrades - input.portfolio.tradesToday))} (one per token, best first)`
      : ""
  }

Decide what, if anything, to do this tick. Finish with the finish tool.`;
}
