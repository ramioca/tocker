import { describe, expect, it } from "vitest";
import type { RunStep } from "@/server/types";
import {
  describeCall,
  describeResult,
  isTranscriptRow,
  narrateRun,
  runFacts,
  stepSpanMs,
  tradeRefusals,
  type NarratableStep,
} from "./narrate";

/**
 * Every payload below is the real shape: `score_token`, `discover_tokens`, `place_trade`
 * and `finish` as `src/lib/agent/tools.ts` returns them, `review_positions` as
 * `tools-positions.ts` does, and the `{ input }` / `{ result }` / `{ error }` envelopes
 * `logger.ts` writes around them.
 */

const SCORE_DOVE = {
  ok: true,
  symbol: "DOVE",
  chain: "solana",
  address: "7uvLmz9m1oQ4z1k7Sv9WcCFy2eLQ8m4bVX2b6Nn1mnop",
  total: 71.4,
  verdict: "candidate",
  components: {
    safety: 50,
    liquidity: 62,
    momentum: 58,
    organic: 79,
    distribution: 91,
    gecko: 41,
    sentiment: null,
    smartMoney: null,
  },
  blockers: [],
  warnings: ["holder count unknown"],
  priceUsd: 0.00123,
  liquidityUsd: 48_200,
  volume24hUsd: 190_400,
  marketCapUsd: 1_240_000,
  holderCount: null,
  ageHours: 6.2,
  priceChange24hPct: 18.4,
  sources: ["jupiter", "rugcheck", "geckoterminal"],
  scoredAt: "2026-09-22T14:20:00.000Z",
  rendered: "DOVE [solana] score 71.4/100 — candidate",
  minScore: 55,
  meetsMinScore: true,
  paidSignals: { intel: true, sentiment: true, smartMoney: false, sellCheck: false },
  intel: { summary: "No mint or freeze authority; 4% bundled.", signals: { bundled: 0.04 } },
  notBought: ["smartMoney: $0.05 exceeds the $0.02 left in this run's data budget"],
  dataSpentThisRunUsd: 0.02,
  dataBudgetRemainingUsd: 0.23,
};

const SCORE_RUG = {
  ...SCORE_DOVE,
  symbol: "RUG",
  total: 22.6,
  verdict: "avoid",
  components: { ...SCORE_DOVE.components, safety: 0, organic: 12, distribution: 30, gecko: null },
  blockers: ["mint_authority_unknown"],
  meetsMinScore: false,
  paidSignals: { intel: false, sentiment: false, smartMoney: false, sellCheck: false },
  intel: null,
  notBought: ["unbuyable on confirmed free data (honeypot) — no paid read changes that"],
};

const DISCOVERY = {
  ok: true,
  chains: ["solana"],
  feeds: ["new_launches", "trending", "momentum", "gecko_launches", "paid_launches"],
  count: 16,
  freshCount: 12,
  candidates: [
    { symbol: "DOVE", chain: "solana", address: "7uvL", quickScore: 62, ageHours: 6.2, seen: null },
    { symbol: "BONK", chain: "solana", address: "DezX", quickScore: 41, ageHours: 9_000, seen: "held" },
  ],
  rendered: "…",
  note: "quickScore is a cheap pre-rank, not the real score.",
};

/** Built in local time so the expected clock text holds in any timezone. */
const EXPIRES_AT = new Date(2026, 8, 22, 14, 32, 0).toISOString();

const PROPOSED = {
  ok: true,
  proposed: true,
  tradeId: "trd_1",
  expiresAt: EXPIRES_AT,
  symbol: "DOVE",
  side: "buy",
  requestedUsd: 2,
  quotedPriceUsd: 0.00123,
  message: "Proposed — awaiting owner approval; do not re-propose this token this tick.",
};

const FILLED = {
  ok: true,
  tradeId: "trd_2",
  status: "filled",
  venue: "jupiter",
  isPaper: false,
  symbol: "DOVE",
  side: "buy",
  amountToken: 1_626.0,
  amountUsd: 2,
  priceUsd: 0.00123,
  feeUsd: 0.006,
  platformFeeUsd: 0.1,
  txHash: "5xY…",
  quotedPriceUsd: 0.00122,
  slippageBps: 82,
  score: { total: 71.4, verdict: "candidate", components: SCORE_DOVE.components },
};

const DAILY_LIMIT_REFUSAL = {
  ok: false,
  reason:
    "Rejected by risk guard: Daily buy limit reached (10/10 buys today; sells and exits never count). It resets at 00:00 UTC, or raise Max trades per day under Risk.",
  rejected: true,
  score: { total: 71.4, verdict: "candidate", blockers: [] },
};

function step(
  kind: NarratableStep["kind"],
  toolName: string | null,
  payload: Record<string, unknown>,
): NarratableStep {
  return { kind, toolName, payload };
}

const call = (tool: string, input: Record<string, unknown>) => step("tool_call", tool, { input });
const result = (tool: string, payload: Record<string, unknown>) => step("tool_result", tool, { result: payload });

describe("describeCall", () => {
  it("names the feeds, the chain and the limits of a sweep", () => {
    expect(
      describeCall("discover_tokens", {
        chain: "solana",
        feeds: ["new_launches", "gecko_launches", "momentum"],
        limit: 30,
      }),
    ).toBe("Sweeping new_launches, gecko_launches, momentum on Solana (limit 30)");
  });

  it("falls back to the configured feeds and every chain", () => {
    expect(describeCall("discover_tokens", {})).toBe("Sweeping the configured feeds on every chain");
  });

  it("says an age ceiling in hours, and in minutes under the hour", () => {
    // The sweep that emptied a live tick on 2026-10-08, as its row read.
    expect(
      describeCall("discover_tokens", { feeds: ["trending", "momentum"], chain: "solana", limit: 20, maxAgeHours: 1, minLiquidityUsd: 15_000 }),
    ).toBe("Sweeping trending, momentum on Solana (limit 20, under 1h, min $15K liquidity)");
    expect(describeCall("discover_tokens", { maxAgeHours: 0.25 })).toBe("Sweeping the configured feeds on every chain (under 15m)");
    expect(describeCall("discover_tokens", { maxAgeHours: 1.5 })).toBe("Sweeping the configured feeds on every chain (under 1.5h)");
  });

  it("says a round liquidity floor in full", () => {
    // "$1K" was what a $100,000 floor read as.
    expect(describeCall("discover_tokens", { minLiquidityUsd: 100_000 })).toBe(
      "Sweeping the configured feeds on every chain (min $100K liquidity)",
    );
  });

  it("uses the address until the result supplies a symbol", () => {
    const input = { chain: "solana", address: "7uvLmz9m1oQ4z1k7Sv9WcCFy2eLQ8m4bVX2b6Nn1mnop" };
    expect(describeCall("score_token", input)).toBe("Scoring 7uvL…mnop on Solana");
    expect(describeCall("score_token", input, { symbol: "DOVE" })).toBe("Scoring DOVE on Solana");
  });

  it("says what a paid override is buying", () => {
    expect(
      describeCall("score_token", { chain: "base", address: "0xabc", smartMoney: true, sellCheck: true }, { symbol: "ACAT" }),
    ).toBe("Scoring ACAT on Base — paying for smart money and a sell check");
  });

  it("reads an order as a buy, a sell, or a proposal", () => {
    const input = { chain: "solana", side: "buy", tokenAddress: "7uvL", amountUsd: 2, rationale: "…" };
    expect(describeCall("place_trade", input, { symbol: "DOVE" })).toBe("Buying $2.00 of DOVE");
    expect(describeCall("place_trade", input, { symbol: "DOVE", proposed: true })).toBe(
      "Proposing $2.00 buy of DOVE",
    );
    expect(
      describeCall("place_trade", { ...input, side: "sell", amountUsd: 4.5 }, { symbol: "ACAT" }),
    ).toBe("Selling $4.50 of ACAT");
  });

  it("carries the note's own words, since the result does not", () => {
    expect(describeCall("post_note", {})).toBe("Posting a note");
    expect(describeCall("post_note", { body: "Sat this tick out: attention without acceleration is not a signal." })).toBe(
      "Posting a note: “Sat this tick out: attention without acceleration is not a signal.”",
    );
  });

  it("covers the quiet tools", () => {
    expect(describeCall("get_portfolio", {})).toBe("Checking the book");
    expect(describeCall("review_positions", {})).toBe("Reviewing open positions");
    expect(describeCall("finish", { summary: "…" })).toBe("Finishing");
    expect(describeCall("get_token_price", { chain: "base", address: "0xabc" }, { symbol: "ACAT" })).toBe(
      "Pricing ACAT on Base",
    );
    expect(describeCall("query_data_source", { sourceId: "sentimentalpha", params: { query: "DOVE" } })).toBe(
      "Buying sentimentalpha data for DOVE",
    );
  });

  it("falls back to the tool name on anything it has never seen", () => {
    expect(describeCall("some_future_tool", { a: 1 })).toBe("some_future_tool");
    expect(describeCall(null, null)).toBe("tool");
    expect(describeCall(undefined, "not an object")).toBe("tool");
  });
});

describe("describeResult", () => {
  it("leads a score with the number, then the components, then the floor", () => {
    expect(describeResult("score_token", SCORE_DOVE)).toBe(
      "DOVE 71 · candidate · safety 50, liquidity 62, organic 79, distribution 91, momentum 58, GT 41 · Deepnets ok, sentiment bought · notBought: smartMoney (budget) · clears the 55 floor",
    );
  });

  /**
   * The smart money read is said for what it found, not only that it was bought. The
   * result carries a note on it; the amounts come from that note and nowhere else.
   */
  it("says what a smart money read found", () => {
    const bought = { ...SCORE_DOVE, components: { ...SCORE_DOVE.components, smartMoney: 52.8 }, notBought: [] };
    const reading = {
      ...bought,
      paidSignals: { intel: true, sentiment: true, smartMoney: true, sellCheck: false },
      smartMoney: { status: "reading", netFlowUsd: 12_410.5, wallets: 4, said: "Smart money, last 24h: 3 smart traders and 1 top-PnL wallet net bought $12.4k." },
    };
    expect(describeResult("score_token", reading)).toBe(
      "DOVE 71 · candidate · safety 50, liquidity 62, organic 79, distribution 91, momentum 58, GT 41, smart money 53 · Deepnets ok, sentiment bought, smart money net bought $12.4K by 4 wallets · clears the 55 floor",
    );

    const selling = { ...reading, smartMoney: { status: "reading", netFlowUsd: -2_104.75, wallets: 1, said: "…" } };
    expect(describeResult("score_token", selling)).toContain("smart money net sold $2,104.75 by 1 wallet ·");
    const even = { ...reading, smartMoney: { status: "reading", netFlowUsd: 0, wallets: 3, said: "…" } };
    expect(describeResult("score_token", even)).toContain("smart money flat by 3 wallets ·");
    const uncounted = { ...reading, smartMoney: { status: "reading", netFlowUsd: 9_500, wallets: 0, said: "…" } };
    expect(describeResult("score_token", uncounted)).toContain("smart money net bought $9,500.00 ·");

    // Bought, and nobody tracked had traded it: an answer, and it reads as one.
    const nobody = {
      ...SCORE_DOVE,
      notBought: [],
      paidSignals: { intel: true, sentiment: true, smartMoney: true, sellCheck: false },
      smartMoney: { status: "none", said: "Smart money, last 24h: no smart trader or top-PnL wallet tracked by Nansen traded it." },
    };
    expect(describeResult("score_token", nobody)).toBe(
      "DOVE 71 · candidate · safety 50, liquidity 62, organic 79, distribution 91, momentum 58, GT 41 · Deepnets ok, sentiment bought, smart money: no tracked wallet traded it · clears the 55 floor",
    );

    // Wanted and not read: it stays under notBought, where every skipped read is.
    const notRead = {
      ...SCORE_DOVE,
      notBought: ["smartMoney: $0.01 exceeds the $0.00 left in this run's data budget"],
      smartMoney: { status: "not_read", said: "Smart money: not read ($0.01 exceeds the $0.00 left in this run's data budget)." },
    };
    expect(describeResult("score_token", notRead)).toBe(describeResult("score_token", SCORE_DOVE));
    const failed = { ...notRead, notBought: ["smartMoney: the source did not answer: nansen-smart-money responded 503"] };
    expect(describeResult("score_token", failed)).toContain("notBought: smartMoney (the source did not answer");
    const off = { ...notRead, notBought: ["smartMoney: the smart money source is not enabled for this agent"] };
    expect(describeResult("score_token", off)).toContain("notBought: smartMoney (not configured)");
  });

  /**
   * Steps stored before the read was said in words: `paidSignals.smartMoney` and a
   * component, and no note. They narrate exactly as they did, and nothing throws on a
   * note of a shape this version does not know.
   */
  it("still narrates a score step stored under the old read", () => {
    const old = {
      ...SCORE_DOVE,
      components: { ...SCORE_DOVE.components, smartMoney: 91 },
      paidSignals: { intel: true, sentiment: true, smartMoney: true, sellCheck: false },
      notBought: [],
    };
    expect(describeResult("score_token", old)).toBe(
      "DOVE 71 · candidate · safety 50, liquidity 62, organic 79, distribution 91, momentum 58, GT 41, smart money 91 · Deepnets ok, sentiment bought, smart money bought · clears the 55 floor",
    );
    // The old skip line, at the old price.
    expect(describeResult("score_token", SCORE_DOVE)).toContain("notBought: smartMoney (budget)");
    for (const smartMoney of [null, "bought", 7, [], { status: "reading" }, { status: "cached", said: "…" }, { netFlowUsd: "a lot" }]) {
      expect(describeResult("score_token", { ...old, smartMoney }), JSON.stringify(smartMoney)).toContain("smart money bought ·");
    }

    const steps = [
      { kind: "tool_call" as const, toolName: "score_token", payload: { input: { chain: "solana", address: SCORE_DOVE.address } } },
      { kind: "tool_result" as const, toolName: "score_token", payload: { result: { ...old, dataSpentThisRunUsd: 0.07 } } },
    ];
    expect(runFacts(steps)).toMatchObject({ enrichedTokens: 1, paidReads: ["Deepnets safety", "sentiment", "smart money"], dataSpentUsd: 0.07 });
    expect(narrateRun(steps)).toContain("Paid $0.07 for data on Deepnets safety, sentiment and smart money across 1 token.");
  });

  it("puts a hard gate ahead of everything else", () => {
    const line = describeResult("score_token", SCORE_RUG);
    expect(line.startsWith("RUG 23 · avoid · blocked: mint_authority_unknown ·")).toBe(true);
    expect(line).toContain("below the 55 floor");
  });

  it("counts a sweep", () => {
    expect(describeResult("discover_tokens", DISCOVERY)).toBe("12 fresh candidates, 4 already seen · 5 feeds");
    expect(describeResult("discover_tokens", { ...DISCOVERY, count: 3, freshCount: 3, feeds: ["trending"] })).toBe(
      "3 fresh candidates · 1 feed",
    );
  });

  /**
   * A sweep the agent narrowed with its own filters, which the tool then ran again under
   * the configured settings. The line has to be true however the second sweep went.
   */
  it("says when a narrowed sweep was widened, and what each half found", () => {
    const widened = { ...DISCOVERY, widened: true, matchedYourFilters: 0, count: 23, freshCount: 23 };
    expect(describeResult("discover_tokens", widened)).toBe(
      "0 fresh matched the agent's filters · widened to the configured settings: 23 fresh candidates · 5 feeds",
    );
    // Some matched: they are among the candidates counted after the colon.
    expect(describeResult("discover_tokens", { ...widened, matchedYourFilters: 2, count: 12, freshCount: 9 })).toBe(
      "2 fresh matched the agent's filters · widened to the configured settings: 9 fresh candidates, 3 already seen · 5 feeds",
    );
    expect(describeResult("discover_tokens", { ...widened, matchedYourFilters: 1, count: 1, freshCount: 1 })).toBe(
      "1 fresh matched the agent's filters · widened to the configured settings: 1 fresh candidate · 5 feeds",
    );
    // The configured settings found nothing either: a real answer, said as one.
    expect(describeResult("discover_tokens", { ...widened, count: 0, freshCount: 0, candidates: [] })).toBe(
      "0 fresh matched the agent's filters · widened to the configured settings: 0 fresh candidates · 5 feeds",
    );
    // A payload with the flag and no count still reads as a widened sweep.
    expect(describeResult("discover_tokens", { ...widened, matchedYourFilters: undefined })).toBe(
      "too few matched the agent's filters · widened to the configured settings: 23 fresh candidates · 5 feeds",
    );
    // And a sweep that was not widened reads as it always did.
    expect(describeResult("discover_tokens", { ...DISCOVERY, widened: false })).toBe("12 fresh candidates, 4 already seen · 5 feeds");
  });

  it("distinguishes a proposal from a fill from a refusal", () => {
    expect(describeResult("place_trade", PROPOSED)).toBe("Proposed $2.00 buy of DOVE — expires 14:32");
    expect(describeResult("place_trade", FILLED)).toBe("Filled $2.00 of DOVE at $0.00123");
    expect(describeResult("place_trade", DAILY_LIMIT_REFUSAL)).toBe(
      "Refused by the risk guard: Daily buy limit reached (10/10 buys today; sells and exits never count)",
    );
  });

  it("counts the registry matches of a data-source search, and reads older runs that carry a second list", () => {
    expect(describeResult("search_data_sources", { ok: true, registry: [{}, {}] })).toBe("2 matching sources");
    expect(describeResult("search_data_sources", { ok: true, registry: [{}] })).toBe("1 matching source");
    expect(describeResult("search_data_sources", { ok: true, registry: [{}], bazaar: [{}, {}, {}] })).toBe(
      "1 matching source · 3 outside listings",
    );
  });

  it("says when finish sent the model back, and why", () => {
    expect(describeResult("finish", { ok: true, summary: "Proposed DOVE, sat on the rest." })).toBe("Finished");
    expect(
      describeResult("finish", {
        ok: false,
        reason: "Not yet. You scored 2 tokens this tick and discovery surfaced 5 fresh candidates you have not looked at: PIKA, ACAT.",
        nudged: true,
        unscored: ["PIKA", "ACAT", "MOON", "SOLX"],
      }),
    ).toBe("Sent back — 4 fresh candidates not scored: PIKA, ACAT, MOON and 1 more");
    expect(
      describeResult("finish", {
        ok: false,
        reason: "Not yet. You scored DOVE (71) above your 55 floor but did not propose it.",
        nudged: true,
        unproposed: ["DOVE"],
      }),
    ).toBe("Sent back — above the floor but not proposed: DOVE");
    expect(
      describeResult("finish", {
        ok: false,
        reason:
          "Not yet. No token sweep with your owner's settings has come back this tick. Call discover_tokens with no arguments, score what it returns with score_token, then call finish again.",
        nudged: true,
        notSwept: true,
      }),
    ).toBe("Sent back — no sweep under the configured settings had come back this tick");
  });

  it("reads the book and the held positions", () => {
    expect(
      describeResult("get_portfolio", {
        ok: true,
        cashUsd: 7.0234,
        equityUsd: 24.1,
        positions: [{ symbol: "DOVE" }, { symbol: "ACAT" }, { symbol: "PIKA" }],
        tradesRemainingToday: 12,
      }),
    ).toBe("$7.02 cash · 3 positions · $24.10 equity · 12 trades left today");

    expect(
      describeResult("review_positions", {
        ok: true,
        count: 3,
        rescored: 3,
        positions: [
          { symbol: "DOVE", verdict: "hold" },
          { symbol: "ACAT", verdict: "watch" },
          { symbol: "PIKA", verdict: "exit_candidate" },
        ],
      }),
    ).toBe("3 positions · DOVE hold, ACAT watch, PIKA exit candidate");

    expect(describeResult("review_positions", { ok: true, count: 0, positions: [] })).toBe("No open positions");
  });

  it("reports an error step as its message", () => {
    expect(describeResult("place_trade", { error: "Jupiter quote timed out after 8000ms" })).toBe(
      "Jupiter quote timed out after 8000ms",
    );
  });

  it("never throws on a shape it does not know", () => {
    for (const shape of [null, undefined, 42, "text", [], { ok: true }, { weird: { nested: [1, 2] } }]) {
      expect(() => describeResult("mystery_tool", shape)).not.toThrow();
    }
    expect(describeResult("mystery_tool", {})).toBe("mystery_tool");
    expect(describeResult("mystery_tool", { ok: true })).toBe("Done");
    // The guardian writes a bare result with no matching call.
    expect(describeResult("guardian", { summary: "Sold ACAT: stop loss at -20.4%.", exits: [], skipped: [] })).toBe(
      "Sold ACAT: stop loss at -20.4%.",
    );
  });

  it("reads the guardian's exits, not its stored summary", () => {
    // A run written before the summary was reworded still reads in plain words.
    const payload = {
      summary: "take_profit → sold BONK ($2141)",
      exits: [{ symbol: "BONK", reason: "take_profit", status: "filled", amountUsd: 2140.64, priceUsd: 0.00004 }],
      skipped: [],
    };
    expect(describeResult("guardian", payload)).toBe("Take profit: sold BONK for $2,140.64");
    expect(
      describeResult("guardian", {
        ...payload,
        exits: [...payload.exits, { symbol: "WIF", reason: "stop_loss", status: "failed", amountUsd: 20 }],
        skipped: [{ symbol: "POPCAT" }],
      }),
    ).toBe("Take profit: sold BONK for $2,140.64 · 1 could not be executed · 1 position skipped");
    // Nothing filled: the summary is all there is.
    expect(describeResult("guardian", { summary: "No exit rules fired.", exits: [] })).toBe("No exit rules fired.");
  });

  it("counts the rows the transcript shows", () => {
    const steps: NarratableStep[] = [
      { kind: "thought", payload: {} },
      { kind: "tool_result", toolName: "guardian", payload: {} },
      { kind: "tool_call", toolName: "get_portfolio", payload: {} },
      { kind: "tool_result", toolName: "get_portfolio", payload: {} },
      { kind: "error", toolName: "score_token", payload: {} },
      { kind: "error", toolName: null, payload: {} },
      { kind: "message", payload: {} },
    ];
    expect(steps.filter(isTranscriptRow)).toHaveLength(3);
  });

  /**
   * The live run of 2026-10-08, as its rows were stamped: the sweep was called 3s in and
   * its result written 14.2s later, carrying those 14.2s; `finish` followed. The run took
   * 18.5s, and its page read 28.4s because the sweep's duration was added to a row
   * already written at the sweep's end.
   */
  it("spans a run's steps from the first row to the last, without adding a duration", () => {
    const start = Date.parse("2026-10-08T12:00:00.000Z");
    const at = (ms: number) => new Date(start + ms).toISOString();
    const rows = [
      { createdAt: at(3_000), durationMs: null },
      { createdAt: at(17_200), durationMs: 14_200 },
      { createdAt: at(18_300), durationMs: null },
      { createdAt: at(18_400), durationMs: 90 },
    ];
    expect(stepSpanMs(rows)).toBe(15_400);
    expect(stepSpanMs(rows)).toBeLessThan(18_500);
    // Rows in any order, dates as dates, and one row alone.
    expect(stepSpanMs([...rows].reverse())).toBe(15_400);
    expect(stepSpanMs([{ createdAt: new Date(start) }, { createdAt: new Date(start + 250) }])).toBe(250);
    expect(stepSpanMs([{ createdAt: at(0) }])).toBe(0);
    expect(stepSpanMs([])).toBeNull();
  });
});

/** A whole approval-mode tick, in the order the logger writes it. */
const TICK: NarratableStep[] = [
  step("thought", null, { text: "Starting the Solana tick. Book first." }),
  call("get_portfolio", {}),
  result("get_portfolio", { ok: true, cashUsd: 7.02, positions: [], tradesRemainingToday: 12, dataSpentThisRunUsd: 0 }),
  call("discover_tokens", { chain: "solana", limit: 30 }),
  result("discover_tokens", DISCOVERY),
  call("score_token", { chain: "solana", address: "7uvL" }),
  result("score_token", SCORE_DOVE),
  call("score_token", { chain: "solana", address: "RUGx" }),
  result("score_token", { ...SCORE_RUG, dataSpentThisRunUsd: 0.03 }),
  call("score_token", { chain: "solana", address: "ACAT" }),
  result("score_token", {
    ...SCORE_DOVE,
    symbol: "ACAT",
    total: 66.2,
    dataSpentThisRunUsd: 0.05,
    paidSignals: { intel: true, sentiment: false, smartMoney: false, sellCheck: false },
  }),
  call("place_trade", { chain: "solana", side: "buy", tokenAddress: "7uvL", amountUsd: 2, rationale: "…" }),
  result("place_trade", PROPOSED),
  call("place_trade", { chain: "solana", side: "buy", tokenAddress: "ACAT", amountUsd: 2, rationale: "…" }),
  result("place_trade", DAILY_LIMIT_REFUSAL),
  call("finish", { summary: "…" }),
  result("finish", { ok: false, reason: "Not yet.", nudged: true, unproposed: ["ACAT"] }),
  call("finish", { summary: "Proposed DOVE at 71; ACAT was refused by the daily limit." }),
  result("finish", { ok: true, summary: "Proposed DOVE at 71; ACAT was refused by the daily limit." }),
  step("message", null, { text: "Done." }),
];

describe("narrateRun", () => {
  it("digests a tick into four sentences of research, money, decisions and ending", () => {
    const digest = narrateRun(TICK);

    expect(digest).toBe(
      "Discovery surfaced 12 fresh candidates; scored 3 tokens — DOVE 71, ACAT 66, RUG 23, 1 hard-blocked. " +
        "Paid $0.05 for data on Deepnets safety and sentiment across 2 tokens. " +
        "Proposed $2.00 of DOVE and 1 refusal (daily buy limit). " +
        "Sent back once for more work, then finished.",
    );
    expect(digest.split(". ").length).toBe(4);
  });

  it("is deterministic", () => {
    expect(narrateRun(TICK)).toBe(narrateRun(TICK));
  });

  it("counts the facts behind the digest", () => {
    const facts = runFacts(TICK);
    expect(facts.scored.map((s) => s.symbol)).toEqual(["DOVE", "RUG", "ACAT"]);
    expect(facts.blocked).toBe(1);
    expect(facts.freshCandidates).toBe(12);
    expect(facts.dataSpentUsd).toBeCloseTo(0.05, 6);
    expect(facts.proposed).toEqual([{ symbol: "DOVE", side: "buy", amountUsd: 2 }]);
    expect(facts.refusals).toEqual([{ label: "daily buy limit", count: 1 }]);
    expect(facts.sentBack).toBe(1);
    expect(facts.finished).toBe(true);
  });

  it("groups repeated refusals rather than listing them", () => {
    const steps = [
      ...TICK.slice(0, 11),
      result("place_trade", DAILY_LIMIT_REFUSAL),
      result("place_trade", DAILY_LIMIT_REFUSAL),
      result("place_trade", { ok: false, reason: "DOVE is already proposed and still awaiting your owner's decision.", alreadyProposed: true }),
    ];
    expect(narrateRun(steps)).toContain("3 refusals (daily buy limit ×2 and already proposed)");
  });

  it("counts only refused orders for tradeRefusals, most frequent first", () => {
    const steps = [
      ...TICK,
      result("place_trade", { ok: false, reason: "Chain solana is not enabled for this agent (enabled: base)." }),
      result("place_trade", { ok: false, reason: "Chain solana is not enabled for this agent (enabled: base)." }),
      result("score_token", { ok: false, reason: "Every data provider failed." }),
    ];
    // The nudged finish and the failed score are not refused orders.
    expect(tradeRefusals(steps)).toEqual([
      { label: "chain not enabled", count: 2 },
      { label: "daily buy limit", count: 1 },
    ]);
    expect(tradeRefusals(TICK.slice(0, 13))).toEqual([]);
  });

  it("says when a run ended without finishing, and when it fell over", () => {
    const stopped = TICK.slice(0, 13);
    expect(narrateRun(stopped)).toContain("Stopped without calling finish");

    const failed = [
      ...TICK.slice(0, 7),
      step("error", null, { error: "Anthropic API: 401 invalid x-api-key. Check the key on this agent." }),
    ];
    expect(narrateRun(failed)).toContain("The run failed: Anthropic API: 401 invalid x-api-key");
  });

  it("counts a tick sent back to sweep, and the widened sweep's candidates", () => {
    const steps = [
      call("finish", { summary: "Nothing to do." }),
      result("finish", { ok: false, reason: "Not yet. No token sweep with your owner's settings has come back this tick.", nudged: true, notSwept: true }),
      call("discover_tokens", { maxAgeHours: 1 }),
      result("discover_tokens", { ...DISCOVERY, widened: true, matchedYourFilters: 0, count: 23, freshCount: 23 }),
      call("finish", { summary: "Nothing cleared the bar." }),
      result("finish", { ok: true, summary: "Nothing cleared the bar." }),
    ];
    expect(runFacts(steps)).toMatchObject({ sentBack: 1, sweeps: 1, freshCandidates: 23, finished: true, refusals: [] });
    expect(narrateRun(steps)).toBe(
      "Discovery surfaced 23 fresh candidates; none were scored. Spent nothing on data. No orders this run. Sent back once for more work, then finished.",
    );
  });

  it("says plainly when nothing was bought and nothing was traded", () => {
    const quiet = [
      call("get_portfolio", {}),
      result("get_portfolio", { ok: true, cashUsd: 7.02, positions: [], tradesRemainingToday: 12 }),
      call("finish", { summary: "Flat and staying flat." }),
      result("finish", { ok: true, summary: "Flat and staying flat." }),
    ];
    expect(narrateRun(quiet)).toBe("Spent nothing on data. No orders this run. Finished.");
  });

  it("has nothing to say about an empty transcript", () => {
    expect(narrateRun([])).toBe("");
  });

  it("accepts a RunStep as-is", () => {
    const runStep: RunStep = {
      id: "s1",
      seq: 0,
      kind: "tool_result",
      toolName: "score_token",
      payload: { result: SCORE_DOVE },
      durationMs: 812,
      createdAt: "2026-09-22T14:20:00.000Z",
    };
    const narratable: NarratableStep = runStep;
    expect(runFacts([narratable]).scored).toEqual([{ symbol: "DOVE", total: 71.4 }]);
  });
});
