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
