/**
 * The tick prompt, and what it tells an agent it may spend. Then two parts of the system
 * prompt: how to sweep for tokens, and what Tocker charges.
 *
 * Four things are pinned here.
 *
 * First, a live agent that pays for its own thinking keeps part of its cash out of its
 * trades, and every figure the model sizes a buy from has to be the one the risk guard
 * will hold it to. The line "Cash available" under "Remaining budgets this run" printed
 * the whole of its cash, so a buy sized to that line was refused by the guard and cost
 * the agent one more paid step.
 *
 * Second, nothing about that may reach an agent that holds nothing back. For an agent on
 * its owner's key, and for any paper agent, the prompt has to be what it is on
 * `origin/main`, to the byte. The texts below were produced by running `origin/main`'s
 * own `prompts.ts` and `portfolio.ts` (copied out with `git show origin/main:<file>`) on
 * the inputs this file builds, and are pasted as they came. A change that moves one
 * character of a key agent's prompt fails here. One line is not `origin/main`'s: the
 * "Max ticket right now" of the book bound by its cash, which states the fee as it is
 * charged (a share of the fill) and the largest buy that cash covers with it.
 *
 * Third, the system prompt used to say "Widen it with maxAgeHours / minLiquidityUsd when
 * the table is thin". Neither can widen anything: the owner's age window and liquidity
 * floor are hard gates. A weak model took the sentence at its word, passed a small
 * maxAgeHours, got an empty table and ended the tick on it.
 *
 * Fourth, the model sizes its buys from what the system prompt says Tocker charges. It
 * is told the rate, what the rate comes to on its own largest ticket, and that the
 * ceiling in its book has allowed for it; with the fee off it is told of no fee at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "@/db/schema";
import { resolveDataSources } from "@/lib/data-sources/registry";
import { DEFAULT_AGENT_CONFIG } from "./config";
import { spendableCashUsd, type Portfolio } from "./portfolio";
import { buildSystemPrompt, buildTickPrompt } from "./prompts";

const NOW = new Date("2026-10-06T12:00:00.000Z");

/** Every setting the tick prompt prints is written out, so a changed default cannot move the texts below. */
function config(mode: "auto" | "approve", maxPositionPct = 40): AgentConfig {
  return {
    ...DEFAULT_AGENT_CONFIG,
    risk: {
      maxTradeUsd: 50,
      maxDailyTrades: 6,
      maxPositionPct,
      maxDataSpendUsdPerRun: 1,
      stopLossPct: 15,
      takeProfitPct: 40,
      slippageBps: 300,
      trailingStopPct: 20,
      maxHoldHours: 48,
      exitScoreBelow: 40,
      exitOnLiquidityDropPct: 50,
      sizing: { mode: "fixed_usd", percentOfEquity: 10, referenceRangePct: 25, minTradeUsd: 5 },
    },
    execution: { mode, proposalTtlMinutes: 60 },
  } as AgentConfig;
}

function book(mode: "paper" | "live", extra: Partial<Portfolio> = {}): Portfolio {
  return {
    agentId: "agent_fixture",
    mode,
    cashUsd: 5,
    equityUsd: 7.5,
    positions: [
      {
        token: { id: "solana:Bonk1111111111111111111111111111111111111111", chain: "solana", address: "Bonk1111111111111111111111111111111111111111", symbol: "BONK", name: "Bonk", logoUrl: null, decimals: 5, lastPriceUsd: 0.000025 },
        amountToken: 100_000,
        avgCostUsd: 0.00002,
        markPriceUsd: 0.000025,
        valueUsd: 2.5,
        unrealizedPnlUsd: 0.5,
        unrealizedPnlPct: 25,
        realizedPnlUsd: 0,
        openedAt: "2026-10-06T06:00:00.000Z",
        peakPriceUsd: 0.00003,
        entryScore: 74,
        entryLiquidityUsd: 310_000,
        currentScore: 61,
        stopDistancePct: 40,
        takeProfitDistancePct: 15,
      },
    ],
    realizedPnlUsd: 1.25,
    unrealizedPnlUsd: 0.5,
    tradesToday: 2,
    startingUsd: 10,
    cashReadFailed: false,
    ...extra,
  };
}

const input = (mode: "paper" | "live", execution: "auto" | "approve", extra: Partial<Portfolio> = {}) => ({
  portfolio: book(mode, extra),
  config: config(execution),
  recentTrades: [
    { side: "buy" as const, symbol: "BONK", chain: "solana", amountUsd: 2, priceUsd: 0.00002, status: "filled", createdAt: new Date("2026-10-06T06:00:00.000Z"), rationale: "74/100, organic 88 against $310k liquidity." },
    { side: "sell" as const, symbol: "WIF", chain: "solana", amountUsd: 3.2, priceUsd: 1.9, status: "filled", createdAt: new Date("2026-10-05T18:30:00.000Z"), rationale: null },
  ],
  dataBudgetRemainingUsd: 0.65,
  trigger: "schedule" as const,
  now: NOW,
  exits: [{ symbol: "WIF", reason: "take_profit", amountUsd: 3.2, rationale: "Up 41% from entry." }],
});

/** A book with no position, where the cash is what binds the ceiling. */
const FLAT = { positions: [], equityUsd: 5, unrealizedPnlUsd: 0 };
const cashBound = (mode: "paper" | "live", extra: Partial<Portfolio> = {}) => ({
  ...input(mode, "auto", { ...FLAT, ...extra }),
  config: config("auto", 100),
  recentTrades: [],
  exits: [],
});

// ---------- origin/main's own output for those inputs, as it came ----------

const LIVE_KEY_AGENT = `New tick (schedule) at 2026-10-06T12:00:00.000Z.

## Your book
Cash: $5.00 · Equity: $7.50 · Mode: live
Realized PnL $1.25 · Unrealized PnL $0.50
Trades today: 2/6
Max ticket right now: $3.00 — the binding limit is maxPositionPct 40% of $7.50 equity. An order above this is rejected, not trimmed. Adding to a token you already hold has less room than this: the position you hold counts towards the same concentration cap.
Positions:
  BONK [solana] 100,000 · $2.50 (+25.0%) · avg cost $0.0000200000 · Bonk1111111111111111111111111111111111111111

## Exit engine, just before this tick
  TAKE_PROFIT — sold WIF ($3.20): "Up 41% from entry."

## How close each position is to an automatic exit
  BONK: held 6.0h · +40.0pp to the 15% stop · +15.0pp to the 40% take-profit · +3.3pp to the 20% trail (peak $0.00003) · 42.0h left on the 2.0d max hold · entry score 74 → 61 now

## Last 2 trades
  2026-10-06T06:00:00.000Z BUY BONK [solana] $2.00 @ $0.0000 — filled — "74/100, organic 88 against $310k liquidity."
  2026-10-05T18:30:00.000Z SELL WIF [solana] $3.20 @ $1.90 — filled

## Remaining budgets this run
  - Data spend: $0.6500 of $1.00
  - Buys left today: 4 (sells and exits never count)
  - Cash available: $5.00

Decide what, if anything, to do this tick. Finish with the finish tool.`;

const PAPER_AGENT_IN_APPROVAL_MODE = `New tick (schedule) at 2026-10-06T12:00:00.000Z.

## Your book
Cash: $5.00 · Equity: $7.50 · Mode: paper
Realized PnL $1.25 · Unrealized PnL $0.50
Trades today: 2/6
Max ticket right now: $3.00 — the binding limit is maxPositionPct 40% of $7.50 equity. An order above this is rejected, not trimmed. Adding to a token you already hold has less room than this: the position you hold counts towards the same concentration cap.
Positions:
  BONK [solana] 100,000 · $2.50 (+25.0%) · avg cost $0.0000200000 · Bonk1111111111111111111111111111111111111111

## Exit engine, just before this tick
  TAKE_PROFIT — sold WIF ($3.20): "Up 41% from entry."

## How close each position is to an automatic exit
  BONK: held 6.0h · +40.0pp to the 15% stop · +15.0pp to the 40% take-profit · +3.3pp to the 20% trail (peak $0.00003) · 42.0h left on the 2.0d max hold · entry score 74 → 61 now

## Last 2 trades
  2026-10-06T06:00:00.000Z BUY BONK [solana] $2.00 @ $0.0000 — filled — "74/100, organic 88 against $310k liquidity."
  2026-10-05T18:30:00.000Z SELL WIF [solana] $3.20 @ $1.90 — filled

## Remaining budgets this run
  - Data spend: $0.6500 of $1.00
  - Buys left today: 4 (sells and exits never count)
  - Cash available: $5.00
  - Proposals you may open this tick: 3 (one per token, best first)

Decide what, if anything, to do this tick. Finish with the finish tool.`;

const LIVE_KEY_AGENT_BOUND_BY_ITS_CASH = `New tick (schedule) at 2026-10-06T12:00:00.000Z.

## Your book
Cash: $5.00 · Equity: $5.00 · Mode: live
Realized PnL $1.25 · Unrealized PnL $0.00
Trades today: 2/6
Max ticket right now: $4.97 — the binding limit is cash $5.00 less the 0.5% Tocker fee charged on the fill. An order above this is rejected, not trimmed.
Positions: none.

## Exit engine, just before this tick
  Nothing fired this tick.

## How close each position is to an automatic exit
  No open positions.

## Last 0 trades
  No trades yet.

## Remaining budgets this run
  - Data spend: $0.6500 of $1.00
  - Buys left today: 4 (sells and exits never count)
  - Cash available: $5.00

Decide what, if anything, to do this tick. Finish with the finish tool.`;

beforeEach(() => {
  vi.stubEnv("PLATFORM_FEE_BPS", "50");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the tick prompt of an agent that holds nothing back", () => {
  it("is origin/main's, byte for byte, for a live agent on its owner's key", () => {
    expect(buildTickPrompt(input("live", "auto"))).toBe(LIVE_KEY_AGENT);
  });

  it("is origin/main's, byte for byte, for a paper agent, in approval mode too", () => {
    expect(buildTickPrompt(input("paper", "approve"))).toBe(PAPER_AGENT_IN_APPROVAL_MODE);
  });

  it("is pinned, byte for byte, where the cash is what binds the ceiling", () => {
    expect(buildTickPrompt(cashBound("live"))).toBe(LIVE_KEY_AGENT_BOUND_BY_ITS_CASH);
    expect(buildTickPrompt(cashBound("paper"))).toBe(LIVE_KEY_AGENT_BOUND_BY_ITS_CASH.replace("Mode: live", "Mode: paper"));
  });

  /**
   * A paper agent that pays per use holds nothing back (its book is a notional, and
   * `getPortfolio` gives it no reserve), and neither does a live one whose wallet is
   * empty. A reserve of zero, or none, is the same prompt as no reserve at all.
   */
  it("is the same for a book whose reserve is absent or zero, whatever the agent thinks on", () => {
    expect(buildTickPrompt(cashBound("live", { thinkingReserveUsd: 0 }))).toBe(LIVE_KEY_AGENT_BOUND_BY_ITS_CASH);
    expect(buildTickPrompt(cashBound("live", { thinkingReserveUsd: undefined }))).toBe(LIVE_KEY_AGENT_BOUND_BY_ITS_CASH);
    // The read time a live pay-per-use book carries is for its marks, and prints nothing.
    expect(buildTickPrompt(cashBound("live", { cashReadAt: NOW }))).toBe(LIVE_KEY_AGENT_BOUND_BY_ITS_CASH);
  });
});

describe("the tick prompt of a live agent that pays for its own thinking", () => {
  // $5.00 in the wallet, $0.85 of it kept back: two $0.30 run limits and the $0.25 floor.
  const held = cashBound("live", { thinkingReserveUsd: 0.85 });

  it("prints what a buy may spend on the line a buy is sized from, not the whole of its cash", () => {
    const prompt = buildTickPrompt(held);
    expect(spendableCashUsd(held.portfolio)).toBeCloseTo(4.15, 6);
    expect(prompt).toContain("\n  - Cash available: $4.15\n");
    expect(prompt).not.toContain("Cash available: $5.00");
    // The book still says what it holds, and why less of it can be traded.
    expect(prompt).toContain("Cash: $5.00 · Equity: $5.00 · Mode: live");
    expect(prompt).toContain("Part of that cash is kept back to pay for your own thinking and cannot be spent on a buy: $4.15 is available to trade.");
    // And the ceiling, its reason and that line all work from the same figure.
    expect(prompt).toContain(
      "Max ticket right now: $4.12 — the binding limit is the $4.15 of your cash that is available to trade (part of your cash is kept back to pay for your thinking) less the 0.5% Tocker fee charged on the fill.",
    );
  });

  it("differs from a key agent's prompt in exactly those three lines", () => {
    const mine = buildTickPrompt(held).split("\n");
    const theirs = LIVE_KEY_AGENT_BOUND_BY_ITS_CASH.split("\n");
    const added = mine.filter((line) => !theirs.includes(line));
    const removed = theirs.filter((line) => !mine.includes(line));
    expect(added.map((line) => line.slice(0, 24))).toEqual(["Max ticket right now: $4", "Part of that cash is kep", "  - Cash available: $4.1"]);
    expect(removed.map((line) => line.slice(0, 24))).toEqual(["Max ticket right now: $4", "  - Cash available: $5.0"]);
  });

  it("never states how much is kept back, anywhere in it", () => {
    for (const [cashUsd, reserve] of [
      [5, 0.85],
      [20, 4.25],
      [3, 0.35],
    ] as const) {
      const prompt = buildTickPrompt(cashBound("live", { cashUsd, equityUsd: cashUsd, thinkingReserveUsd: reserve }));
      expect(prompt, prompt).not.toContain(reserve.toFixed(2));
      expect(prompt).toContain(`Cash available: $${(cashUsd - reserve).toFixed(2)}`);
    }
  });

  it("prints no cash to trade with when the whole of it is kept back", () => {
    const prompt = buildTickPrompt(cashBound("live", { cashUsd: 0.5, equityUsd: 0.5, thinkingReserveUsd: 0.5 }));
    expect(prompt).toContain("  - Cash available: $0.0000\n");
    expect(prompt).toContain("Max ticket right now: $0.00");
  });
});

describe("the system prompt on sweeping for tokens", () => {
  const system = buildSystemPrompt({ name: "Fixture", tagline: null, mode: "live", config: config("auto") }, []);

  it("says the owner's settings already apply, and that the two filters only narrow", () => {
    expect(system).toContain(
      [
        "2. discover_tokens with no arguments to sweep your feeds. It is free, and your owner's",
        "   settings (age, liquidity, holders, blocklist) already apply: the ranked table is",
        "   filtered on them. maxAgeHours / minLiquidityUsd only NARROW the sweep; use them when",
        "   the table is too long or your strategy is about new launches. To get more",
        "   candidates, drop them or try other feeds.",
        "3. score_token on at least five **fresh** candidates",
      ].join("\n"),
    );
  });

  it("never tells the model to widen a sweep", () => {
    expect(system).not.toMatch(/widen/i);
  });
});
describe("the system prompt on smart money", () => {
  const SOURCE = "nansen-smart-money";
  const withFeed = (dataSources: string[], discovery: AgentConfig["universe"]["discovery"]) => {
    const base = config("auto");
    const agentConfig: AgentConfig = { ...base, dataSources, universe: { ...base.universe, discovery } };
    return buildSystemPrompt({ name: "Fixture", tagline: null, mode: "live", config: agentConfig }, resolveDataSources(dataSources));
  };
  const system = withFeed([SOURCE], DEFAULT_AGENT_CONFIG.universe.discovery);

  it("says what the smart money line is, and that no tracked wallet is a fact, not a failed read and not a reason to pass", () => {
    expect(system).toContain(
      [
        "  - smartMoney (10) — the net flow of smart traders and top-PnL wallets tracked by Nansen",
        "    into this token over the last 24 hours, measured against the token's own liquidity,",
        "    so $80k into a $200k pool scores near the top and the same $80k into a $40M pool",
        "    barely registers. A bought read is also said in words, on a line starting \"Smart",
        "    money, last 24h:\" (who traded it, what they net bought or sold, and what whales,",
        "    fresh wallets, public figures and exchanges did); when that line says no tracked",
        "    wallet traded the token there is no smartMoney component, and that is a fact about",
        "    the token, not a failed read. That answer takes nothing off the score and is never,",
        "    on its own, a reason to pass: a token minutes or hours old may simply not have been",
        "    found by those wallets, or indexed by Nansen, yet.",
        "blockers are hard-gate failures",
      ].join("\n"),
    );
  });

  it("tells the model which of the source's calls it can buy, and where the boards come from", () => {
    expect(system).toMatch(
      /'netflow', 'holdings' and 'dex-trades' \(\$0\.05 each\) are chain-wide boards of what funds and smart traders moved most; they are bought only when your owner switched on the smart money feed, and netflow only by discover_tokens\./,
    );
  });

  it("quotes the read at one cent, and no longer at five", () => {
    expect(system).toContain("  - **smartMoney ($0.01)** — the tie-breaker, read for this one token.");
    expect(system).not.toContain("smartMoney ($0.05)");
    // It is bought for every token the plan covers, not only a borderline one.
    expect(system).toContain("first, then sentiment, then\nsmart money. You do not ask; you read.");
    expect(system).not.toContain("borderline-or-better");
    // The source's own line: the per-token read and its price, then the boards and theirs.
    expect(system).toMatch(/ {2}- nansen-smart-money: Nansen Smart Money\. .*endpoint 'token' \(\$0\.01\) reads ONE token.*'netflow', 'holdings' and 'dex-trades' \(\$0\.05 each\).*\[eip155:8453, \$0\.0100\/call\]/);
  });

  it("lists the smart money feed only when the owner switched on both the feed and the source", () => {
    const feedLine = (prompt: string) => prompt.split("\n").find((line) => line.startsWith("Discovery feeds you sweep:"));
    const on = [...DEFAULT_AGENT_CONFIG.universe.discovery, "smart_money" as const];

    // Neither: the default. The prompt is the one every existing agent has, feed-wise.
    expect(feedLine(system)).toBe("Discovery feeds you sweep: gecko_launches, paid_launches, new_launches, trending");
    expect(system).not.toContain("smart_money");

    // The feed without the source buys nothing, so the model is not told it sweeps it.
    const feedOnly = withFeed(["x-search"], on);
    expect(feedLine(feedOnly)).toBe("Discovery feeds you sweep: gecko_launches, paid_launches, new_launches, trending");
    expect(feedOnly).not.toContain("smart_money");
    expect(feedLine(withFeed([], ["smart_money"]))).toBe("Discovery feeds you sweep: gecko_launches, paid_launches");

    const both = withFeed([SOURCE], on);
    expect(feedLine(both)).toBe("Discovery feeds you sweep: gecko_launches, paid_launches, new_launches, trending, smart_money");
    expect(both).toContain(
      [
        "  - **smart_money discovery ($0.05/chain, once a tick)** — Nansen's board of the tokens",
        "    tracked funds and smart traders accumulated most in 24 hours. Your owner switched it",
        "    on, so discover_tokens buys it. Its rows show that net flow under SM24H and pass the",
        "    same gates as every other candidate: being on the board is a lead, never a reason",
        "    to skip the score.",
      ].join("\n"),
    );
    expect(both).toContain("discover_tokens is free unless the `paid_launches` feed or the `smart_money` feed is in play;");
  });

  it("leaves every other word of the prompt as it was for an agent without the feed", () => {
    const on = [...DEFAULT_AGENT_CONFIG.universe.discovery, "smart_money" as const];
    const strip = (prompt: string) =>
      prompt
        .replace(/\n {2}- \*\*smart_money discovery[\s\S]*?to skip the score\./, "")
        .replace(", smart_money", "")
        .replace(" or the `smart_money` feed", "")
        .replace(" the `smart_money` feed,", "");
    expect(strip(withFeed([SOURCE], on))).toBe(system);
  });
});

describe("the system prompt on what Tocker charges", () => {
  const agent = (maxTradeUsd = 50) => ({
    name: "Fixture",
    tagline: null,
    mode: "live" as const,
    config: { ...config("auto"), risk: { ...config("auto").risk, maxTradeUsd } },
  });

  it("states the rate, what it comes to on this agent's own ticket, and that the ceiling allows for it", () => {
    const system = buildSystemPrompt(agent(), []);
    expect(system).toContain(
      [
        "  - Tocker charges 0.5% of each fill, buy or sell, taken from this agent's own wallet.",
        "    On a buy it is capitalised into the cost basis and on a sell it comes off what the",
        "    sale brings in: a $50.00 fill pays $0.25. The guard requires cash for the ticket",
        "    **plus** its fee, and \"Max ticket right now\" in your book has already allowed for",
        "    it — that line is the true ceiling, and the three limits above are only the inputs",
        "    to it.",
      ].join("\n"),
    );
    expect(system).toContain(
      [
        "   40%-of-equity concentration cap and the cash you have once",
        "   the 0.5% Tocker fee on the fill is set aside, and it names which of the three is binding. Inside it,",
      ].join("\n"),
    );
    expect(system).toContain(
      "  - **Trading is paid by this agent's own wallet**: the ticket, the venue's fee, and Tocker's 0.5% of each fill.",
    );
  });

  it("works the example out from the ticket and the rate, whatever they are", () => {
    expect(buildSystemPrompt(agent(2), [])).toContain("a $2.00 fill pays $0.01.");
    expect(buildSystemPrompt(agent(1), [])).toContain("a $1.00 fill pays $0.005.");
    vi.stubEnv("PLATFORM_FEE_BPS", "25");
    const quarter = buildSystemPrompt(agent(100), []);
    expect(quarter).toContain("Tocker charges 0.25% of each fill");
    expect(quarter).toContain("a $100.00 fill pays $0.25.");
    expect(quarter).toContain("the 0.25% Tocker fee on the fill is set aside");
    expect(quarter).toContain("Tocker's 0.25% of each fill.");
    vi.stubEnv("PLATFORM_FEE_BPS", "100");
    expect(buildSystemPrompt(agent(100), [])).toContain("Tocker charges 1% of each fill");
  });

  it("no longer calls the fee flat, or a drag on a small ticket", () => {
    const system = buildSystemPrompt(agent(2), []);
    expect(system).not.toMatch(/flat (fee|\$)/i);
    expect(system).not.toMatch(/real drag|5% before the price moves/);
    expect(system).not.toContain("$0.1000");
  });

  it("names no fee at all when the fee is off, and still points at the ceiling", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "0");
    const system = buildSystemPrompt(agent(), []);
    expect(system).not.toMatch(/Tocker charges|Tocker fee|Tocker's \d/);
    expect(system).not.toContain("of each fill");
    expect(system).toContain(
      ["  - \"Max ticket right now\" in your book is the true ceiling, and the three limits above", "    are only the inputs to it."].join("\n"),
    );
    expect(system).toContain("concentration cap and the cash you have, and it names which of the three is binding.");
    expect(system).toContain("  - **Trading is paid by this agent's own wallet**: the ticket and the venue's fee.");
  });

  it("keeps the simulator's own fee apart from Tocker's in a paper agent's prompt", () => {
    const system = buildSystemPrompt({ ...agent(), mode: "paper" }, []);
    expect(system).toContain("Fills are simulated at real quoted prices with a 0.30% venue fee.");
    expect(system).toContain("Tocker charges 0.5% of each fill");
  });
});

/**
 * The position limit and the cash reserve. An agent with neither is told nothing about
 * either (the prompts pinned above are those agents'); one with them is told the rule
 * once, in the system prompt, and the figures it has to plan with in the book of every
 * tick: how many positions count, and what the reserve leaves to trade.
 */
describe("the prompts of an agent with a position limit and a cash reserve", () => {
  const limited = (risk: Partial<AgentConfig["risk"]>, execution: "auto" | "approve" = "auto", maxPositionPct = 100): AgentConfig => ({
    ...config(execution, maxPositionPct),
    risk: { ...config(execution, maxPositionPct).risk, ...risk },
  });
  const tick = (risk: Partial<AgentConfig["risk"]>, extra: Partial<Portfolio> = {}) =>
    buildTickPrompt({ ...cashBound("live", extra), config: limited(risk) });

  const OPEN_NONE =
    "Open positions: 0 of 3 allowed. You may open 3 more. A buy of a token you already hold is not a new position. The limit is your owner's: like your other thresholds, never state it in a rationale, a post or your summary.";
  const RESERVE =
    "Cash reserve: your owner keeps $2.00 of your cash out of every buy, so $3.00 is available to trade. A buy that would leave less than $2.00 in cash after its fee is rejected; a sell never is. Like your other thresholds, never state the reserve in a rationale, a post or your summary.";

  it("puts both in the book, with the count and the cash it may actually spend, and changes nothing else", () => {
    // $5.00 of cash, $2.00 kept: $3.00 to trade, which covers a $2.98 buy and its fee.
    expect(tick({ maxOpenPositions: 3, cashReserveUsd: 2 })).toBe(
      LIVE_KEY_AGENT_BOUND_BY_ITS_CASH.replace(
        "Max ticket right now: $4.97 — the binding limit is cash $5.00 less the 0.5% Tocker fee",
        "Max ticket right now: $2.98 — the binding limit is the $3.00 of your cash that is above your $2.00 cash reserve less the 0.5% Tocker fee",
      )
        .replace("Positions: none.", `${OPEN_NONE}\n${RESERVE}\nPositions: none.`)
        .replace("  - Cash available: $5.00", "  - Cash available: $3.00\n  - Positions you may still open: 3 (0 of 3 taken)"),
    );
  });

  it("says each one alone when only one is set", () => {
    const onlyLimit = tick({ maxOpenPositions: 3 });
    expect(onlyLimit).toBe(
      LIVE_KEY_AGENT_BOUND_BY_ITS_CASH.replace("Positions: none.", `${OPEN_NONE}\nPositions: none.`).replace(
        "  - Cash available: $5.00",
        "  - Cash available: $5.00\n  - Positions you may still open: 3 (0 of 3 taken)",
      ),
    );
    const onlyReserve = tick({ cashReserveUsd: 2 });
    expect(onlyReserve).toContain(RESERVE);
    expect(onlyReserve).toContain("  - Cash available: $3.00\n");
    expect(onlyReserve).not.toContain("Open positions:");
    expect(onlyReserve).not.toContain("Positions you may still open");
  });

  it("tells an agent at its limit that a new token will be rejected and an add will not", () => {
    // The fixture book holds one token.
    const prompt = buildTickPrompt({ ...input("live", "auto"), config: limited({ maxOpenPositions: 1 }, "auto", 40) });
    expect(prompt).toContain(
      "Open positions: 1 of 1 allowed. You are at the limit: a buy of a token you do not already hold is rejected until a position is sold. Adding to a token you hold is still allowed.",
    );
    expect(prompt).toContain("\n  - Positions you may still open: 0 (1 of 1 taken)\n");
  });

  it("does not tell an agent over its limit that one sale makes room", () => {
    // One held and one waiting under a limit of one: the limit was lowered after the
    // proposal. A buy of a new token is rejected until none of the two is left.
    const prompt = buildTickPrompt({
      ...input("paper", "approve", { pendingBuyTokenIds: ["solana:Wif1111111111111111111111111111111111111111"] }),
      config: limited({ maxOpenPositions: 1 }, "approve", 40),
    });
    expect(prompt).toContain(
      "Open positions: 2 of 1 allowed (1 held, 1 buy waiting for your owner). You are over the limit: a buy of a token you do not already hold is rejected until the count is back under 1. Adding to a token you hold is still allowed.",
    );
    expect(prompt).not.toContain("until a position is sold");
  });

  it("counts a buy that is waiting for the owner, and says that is what it is", () => {
    const prompt = buildTickPrompt({
      ...input("paper", "approve", { pendingBuyTokenIds: ["solana:Wif1111111111111111111111111111111111111111"] }),
      config: limited({ maxOpenPositions: 3 }, "approve", 40),
    });
    expect(prompt).toContain("Open positions: 2 of 3 allowed (1 held, 1 buy waiting for your owner). You may open 1 more.");
    expect(prompt).toContain("\n  - Positions you may still open: 1 (2 of 3 taken)\n");
  });

  it("prints no cash to trade with while the cash is under the reserve", () => {
    const prompt = tick({ cashReserveUsd: 5 }, { cashUsd: 0.8, equityUsd: 0.8 });
    expect(prompt).toContain("Max ticket right now: $0.00 — the binding limit is the $0.00 of your cash that is above your $5.00 cash reserve");
    expect(prompt).toContain("  - Cash available: $0.0000\n");
    expect(prompt).toContain("so $0.00 is available to trade.");
  });

  it("gives one figure to trade with when thinking money is kept back as well, and never the amount of that", () => {
    // $5.00, $0.85 kept for thinking, $2.00 reserve: the reserve is the larger, so $3.00.
    const both = tick({ cashReserveUsd: 2 }, { thinkingReserveUsd: 0.85 });
    expect(both).toContain("Part of that cash is kept back to pay for your own thinking and cannot be spent on a buy: $3.00 is available to trade.");
    expect(both).toContain(
      "Cash reserve: your owner keeps $2.00 of your cash out of every buy, and the amount available to trade above already allows for it.",
    );
    expect(both).toContain(
      "Max ticket right now: $2.98 — the binding limit is the $3.00 of your cash that is available to trade (part of your cash is kept back for your cash reserve and to pay for your thinking) less the 0.5% Tocker fee charged on the fill.",
    );
    expect(both).toContain("  - Cash available: $3.00\n");
    expect(both).not.toContain("0.85");
    // A reserve smaller than what thinking already keeps back leaves the figure where it was.
    const small = tick({ cashReserveUsd: 0.5 }, { thinkingReserveUsd: 0.85 });
    expect(small).toContain("  - Cash available: $4.15\n");
    expect(small).not.toContain("0.85");
  });

  const agent = (risk: Partial<AgentConfig["risk"]>) => ({ name: "Fixture", tagline: null, mode: "live" as const, config: limited(risk, "auto", 40) });

  it("states both limits once in the system prompt, among the hard limits, before the fee", () => {
    const system = buildSystemPrompt(agent({ maxOpenPositions: 3, cashReserveUsd: 5 }), []);
    expect(system).toContain(
      [
        "  - Slippage tolerance: 300 bps",
        "  - Max open positions: 3. A buy of a token you do not already hold is rejected while you have 3 or more; a buy waiting for your owner's approval counts as one. Adding to a token you hold is not a new position. \"Open positions\" in your book is the count.",
        "  - Cash reserve: $5.00 always stays in cash. A buy that would leave less than that once its fee is paid is rejected, and \"Max ticket right now\" has already allowed for it.",
        "  - Tocker charges 0.5% of each fill, buy or sell, taken from this agent's own wallet.",
      ].join("\n"),
    );
    // And the sizing step names the reserve where it names the cash.
    expect(system).toContain(
      ["   40%-of-equity concentration cap and the cash you have above your $5.00 reserve once", "   the 0.5% Tocker fee on the fill is set aside"].join("\n"),
    );
    vi.stubEnv("PLATFORM_FEE_BPS", "0");
    expect(buildSystemPrompt(agent({ cashReserveUsd: 5 }), [])).toContain(
      "concentration cap and the cash you have above your $5.00 reserve, and it names which of the three is binding.",
    );
  });

  it("states only the one that is set", () => {
    const limitOnly = buildSystemPrompt(agent({ maxOpenPositions: 1 }), []);
    expect(limitOnly).toContain("  - Max open positions: 1. ");
    expect(limitOnly).not.toContain("Cash reserve");
    const reserveOnly = buildSystemPrompt(agent({ cashReserveUsd: 0.5 }), []);
    expect(reserveOnly).toContain("  - Cash reserve: $0.5000 always stays in cash.");
    expect(reserveOnly).not.toContain("Max open positions");
  });

  it("says nothing of either to an agent with neither, whether the fields are absent or written out as off", () => {
    const absent = buildSystemPrompt(agent({}), []);
    expect(absent).not.toMatch(/Max open positions|Cash reserve|reserve/);
    // Nothing stands between the last of the five limits and the fee, as before.
    expect(absent).toContain("  - Slippage tolerance: 300 bps\n  - Tocker charges 0.5% of each fill, buy or sell, taken from this agent's own wallet.");
    expect(buildSystemPrompt(agent({ maxOpenPositions: null, cashReserveUsd: 0 }), [])).toBe(absent);
    // The tick prompt too: off, written out, is the prompt pinned above.
    expect(tick({ maxOpenPositions: null, cashReserveUsd: 0 })).toBe(LIVE_KEY_AGENT_BOUND_BY_ITS_CASH);
    expect(tick({}, { pendingBuyTokenIds: [] })).toBe(LIVE_KEY_AGENT_BOUND_BY_ITS_CASH);
  });
});
