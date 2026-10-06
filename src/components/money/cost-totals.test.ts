import { describe, expect, it } from "vitest";
import type { MoneyAgentRow } from "@/server/queries/money";
import { sumCosts } from "./cost-totals";

function row(overrides: Partial<MoneyAgentRow>): MoneyAgentRow {
  return {
    id: "a",
    slug: "a",
    name: "A",
    avatarSeed: null,
    mode: "paper",
    status: "active",
    model: "claude-sonnet-5",
    equityUsd: 1_000,
    cashUsd: 1_000,
    positionsUsd: 0,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    pnlUsd: 0,
    feesUsd: 0,
    feesAccruedUsd: 0,
    dataSpendUsd: 0,
    dataSpendSimulatedUsd: 0,
    modelSpendUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkSource: "key",
    thinkingModel: null,
    thinkingUsd: 0,
    thinkingSteps: 0,
    thinkingUnansweredUsd: 0,
    thinkingCheckingUsd: 0,
    thinkingSimulatedUsd: 0,
    runCount: 0,
    tradeCount: 0,
    winRate: null,
    firstFundedAt: null,
    stale: false,
    ...overrides,
  };
}

describe("sumCosts", () => {
  it("is all zeroes for no agents", () => {
    expect(sumCosts([])).toEqual({
      feesUsd: 0,
      dataSpendUsd: 0,
      dataSpendSimulatedUsd: 0,
      modelSpendUsd: 0,
      unpricedAgents: 0,
      thinkingUsd: 0,
    });
  });

  it("adds every bill across agents", () => {
    const totals = sumCosts([
      row({ feesUsd: 1.2, dataSpendUsd: 0.68, dataSpendSimulatedUsd: 0.1, modelSpendUsd: 0.67 }),
      row({ feesUsd: 0.4, dataSpendUsd: 0.37, dataSpendSimulatedUsd: 0, modelSpendUsd: 0.66 }),
    ]);
    expect(totals.feesUsd).toBeCloseTo(1.6);
    expect(totals.dataSpendUsd).toBeCloseTo(1.05);
    expect(totals.dataSpendSimulatedUsd).toBeCloseTo(0.1);
    expect(totals.modelSpendUsd).toBeCloseTo(1.33);
    expect(totals.unpricedAgents).toBe(0);
  });

  it("adds what was paid per use for thinking, and only the confirmed part", () => {
    const totals = sumCosts([
      // Being checked and simulated are on the row for the reader, and in no total.
      row({ thinkSource: "usdc", thinkingUsd: 0.42, thinkingCheckingUsd: 0.05, thinkingSimulatedUsd: 9 }),
      row({ thinkSource: "usdc", thinkingUsd: 0.08, thinkingUnansweredUsd: 0.08 }),
      row({}),
    ]);
    expect(totals.thinkingUsd).toBeCloseTo(0.5);
  });

  it("is zero for agents that think on their owner's key", () => {
    expect(sumCosts([row({ modelSpendUsd: 1.5 }), row({ modelSpendUsd: 0.5 })]).thinkingUsd).toBe(0);
  });

  it("counts an unpriced model instead of adding it", () => {
    const totals = sumCosts([row({ modelSpendUsd: null }), row({ modelSpendUsd: 0.5 })]);
    expect(totals.modelSpendUsd).toBeCloseTo(0.5);
    expect(totals.unpricedAgents).toBe(1);
  });
});
