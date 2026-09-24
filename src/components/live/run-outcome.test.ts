import { describe, expect, it } from "vitest";
import type { RunDetail, RunStep, TradeRow } from "@/server/types";
import { deriveRunOutcome, refusalsFromSteps } from "./run-outcome";

function trade(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    id: "t1",
    agentId: "a1",
    runId: null,
    chain: "solana",
    side: "buy",
    token: {
      id: "solana:BONK",
      chain: "solana",
      address: "BONK",
      symbol: "BONK",
      name: "Bonk",
      logoUrl: null,
      decimals: 5,
      lastPriceUsd: 0.0000027,
    },
    amountToken: 0,
    amountUsd: 2,
    priceUsd: 0,
    feeUsd: 0,
    status: "proposed",
    origin: "agent",
    exitReason: null,
    requestedUsd: 2,
    proposedAt: "2026-09-21T10:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    entryScore: null,
    isPaper: false,
    txHash: null,
    rationale: "84/100, organic 88.",
    score: null,
    error: null,
    createdAt: "2026-09-21T10:00:00.000Z",
    filledAt: null,
    ...overrides,
  };
}

function step(overrides: Partial<RunStep> = {}): RunStep {
  return {
    id: "s1",
    seq: 0,
    kind: "tool_result",
    toolName: "place_trade",
    payload: {},
    durationMs: 12,
    createdAt: "2026-09-21T10:00:00.000Z",
    ...overrides,
  };
}

function run(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    id: "r1",
    agentId: "a1",
    trigger: "manual",
    status: "succeeded",
    startedAt: "2026-09-21T10:00:00.000Z",
    finishedAt: "2026-09-21T10:00:20.000Z",
    summary: "Nothing cleared the bar.",
    error: null,
    dataSpendUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    tradeCount: 0,
    stepCount: 0,
    createdAt: "2026-09-21T10:00:00.000Z",
    steps: [],
    transcriptVisible: true,
    trades: [],
    ...overrides,
  };
}

/**
 * W7 B6. The default execution mode is `approve`, so the very first thing a live agent
 * produces is a *proposal*: a `trades` row with `status: "proposed"` and
 * `amountToken: "0"`. The wizard rendered it through the fill panel, which meant an
 * operator's first live trade was reported as "Bought BONK" in green over a transaction
 * that did not exist and a decision nobody had made.
 */
describe("deriveRunOutcome", () => {
  it("calls a proposal a proposal, never a fill", () => {
    const outcome = deriveRunOutcome(run({ trades: [trade()] }));
    expect(outcome.state).toBe("proposed");
    expect(outcome.trade?.id).toBe("t1");
    expect(outcome.finishedWithoutTrading).toBe(false);
  });

  it("reports a real fill as a fill", () => {
    const outcome = deriveRunOutcome(run({ trades: [trade({ status: "filled", amountToken: 700_000 })] }));
    expect(outcome.state).toBe("filled");
  });

  it("frames an expired proposal as a failure, not as a fill", () => {
    const outcome = deriveRunOutcome(run({ trades: [trade({ status: "expired", decidedBy: "expiry" })] }));
    expect(outcome.state).toBe("failed");
    expect(outcome.finishedWithoutTrading).toBe(false);
  });

  it("holds a submitted trade in a settling state rather than claiming either outcome", () => {
    const outcome = deriveRunOutcome(run({ trades: [trade({ status: "submitted" })] }));
    expect(outcome.state).toBe("pending");
  });

  it("prefers live money over a paper row when a run somehow has both", () => {
    const outcome = deriveRunOutcome(
      run({ trades: [trade({ id: "paper", isPaper: true, status: "filled" }), trade({ id: "live", status: "filled" })] }),
    );
    expect(outcome.trade?.id).toBe("live");
  });

  it("prefers the trade that most needs an answer", () => {
    const outcome = deriveRunOutcome(
      run({ trades: [trade({ id: "old", status: "failed" }), trade({ id: "asking", status: "proposed" })] }),
    );
    expect(outcome.trade?.id).toBe("asking");
    expect(outcome.state).toBe("proposed");
  });

  it("says nothing about the result while the run is still going", () => {
    const outcome = deriveRunOutcome(run({ status: "running", finishedAt: null }));
    expect(outcome.inFlight).toBe(true);
    expect(outcome.finishedWithoutTrading).toBe(false);
  });

  it("only claims 'finished without trading' when nothing was attempted", () => {
    expect(deriveRunOutcome(run()).finishedWithoutTrading).toBe(true);

    // A guard rejection leaves no trades row at all — which is exactly why this screen
    // used to call it "a normal outcome".
    const rejected = run({
      steps: [
        step({
          payload: { result: { ok: false, reason: "Position would be 20.0% of equity, above maxPositionPct 10%.", rejected: true, symbol: "BONK" } },
        }),
      ],
    });
    const outcome = deriveRunOutcome(rejected);
    expect(outcome.finishedWithoutTrading).toBe(false);
    expect(outcome.refusals).toHaveLength(1);
    expect(outcome.refusals[0]?.byGuard).toBe(true);
    expect(outcome.refusals[0]?.symbol).toBe("BONK");

    // And a run that failed outright is never "nothing happened" either.
    expect(deriveRunOutcome(run({ status: "failed", error: "no LLM key" })).finishedWithoutTrading).toBe(false);
  });

  it("handles no run at all", () => {
    const outcome = deriveRunOutcome(null);
    expect(outcome).toEqual({
      inFlight: false,
      trade: null,
      state: "none",
      refusals: [],
      finishedWithoutTrading: false,
    });
  });
});

describe("refusalsFromSteps", () => {
  it("separates a guard rejection from a venue failure", () => {
    const refusals = refusalsFromSteps([
      step({ seq: 0, payload: { result: { ok: false, reason: "Rejected by risk guard: on the blocklist.", rejected: true } } }),
      step({ seq: 1, payload: { result: { ok: false, reason: "BONK buy failed: no route." } } }),
    ]);
    expect(refusals.map((r) => r.byGuard)).toEqual([true, false]);
  });

  it("picks up a thrown place_trade as a refusal too", () => {
    const refusals = refusalsFromSteps([step({ kind: "error", payload: { error: "Privy policy denied this" } })]);
    expect(refusals).toEqual([{ symbol: null, reason: "Privy policy denied this", byGuard: false }]);
  });

  it("ignores successful calls, other tools, and the model being told to stop repeating itself", () => {
    expect(
      refusalsFromSteps([
        step({ payload: { result: { ok: true, status: "filled" } } }),
        step({ toolName: "score_token", payload: { result: { ok: false, reason: "provider down" } } }),
        step({ payload: { result: { ok: false, reason: "already proposed", alreadyProposed: true } } }),
        step({ payload: { result: { ok: false } } }),
      ]),
    ).toEqual([]);
  });
});
