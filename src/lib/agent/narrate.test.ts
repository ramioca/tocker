import { describe, expect, it } from "vitest";
import type { RunStep } from "@/server/types";
import {
  describeCall,
  describeResult,
  narrateRun,
  runFacts,
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

  it("distinguishes a proposal from a fill from a refusal", () => {
    expect(describeResult("place_trade", PROPOSED)).toBe("Proposed $2.00 buy of DOVE — expires 14:32");
    expect(describeResult("place_trade", FILLED)).toBe("Filled $2.00 of DOVE at $0.00123");
    expect(describeResult("place_trade", DAILY_LIMIT_REFUSAL)).toBe(
      "Refused by the risk guard: Daily buy limit reached (10/10 buys today; sells and exits never count)",
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

  it("says when a run ended without finishing, and when it fell over", () => {
    const stopped = TICK.slice(0, 13);
    expect(narrateRun(stopped)).toContain("Stopped without calling finish");

    const failed = [
      ...TICK.slice(0, 7),
      step("error", null, { error: "Anthropic API: 401 invalid x-api-key. Check the key on this agent." }),
    ];
    expect(narrateRun(failed)).toContain("The run failed: Anthropic API: 401 invalid x-api-key");
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
