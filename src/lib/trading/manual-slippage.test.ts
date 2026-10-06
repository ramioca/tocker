import { describe, expect, it } from "vitest";
import {
  MAX_MANUAL_SELL_SLIPPAGE_BPS,
  manualSellSlippageBps,
  slippagePctLabel,
  widerSlippageChoices,
} from "./manual-slippage";

describe("manualSellSlippageBps", () => {
  const agentBps = 300;

  it("takes a wider tolerance for a sell, up to the cap", () => {
    expect(manualSellSlippageBps({ side: "sell", agentBps, requestedBps: 1_000 })).toBe(1_000);
    expect(manualSellSlippageBps({ side: "sell", agentBps, requestedBps: MAX_MANUAL_SELL_SLIPPAGE_BPS })).toBe(1_500);
    // Asking for the agent's own number is asking for nothing.
    expect(manualSellSlippageBps({ side: "sell", agentBps, requestedBps: 300 })).toBe(300);
  });

  it("never applies to a buy", () => {
    expect(manualSellSlippageBps({ side: "buy", agentBps, requestedBps: 1_000 })).toBe(300);
  });

  it("can only widen: a tighter figure is ignored", () => {
    expect(manualSellSlippageBps({ side: "sell", agentBps, requestedBps: 100 })).toBe(300);
    expect(manualSellSlippageBps({ side: "sell", agentBps, requestedBps: 0 })).toBe(300);
    expect(manualSellSlippageBps({ side: "sell", agentBps, requestedBps: -500 })).toBe(300);
  });

  it("ignores anything past 15% rather than clamping to it", () => {
    expect(manualSellSlippageBps({ side: "sell", agentBps, requestedBps: 1_501 })).toBe(300);
    expect(manualSellSlippageBps({ side: "sell", agentBps, requestedBps: 2_000 })).toBe(300);
    expect(manualSellSlippageBps({ side: "sell", agentBps, requestedBps: Number.POSITIVE_INFINITY })).toBe(300);
  });

  it("ignores anything that is not a whole number of basis points", () => {
    for (const requestedBps of [750.5, Number.NaN, "1000", null, undefined, {}, [1_000], true]) {
      expect(manualSellSlippageBps({ side: "sell", agentBps, requestedBps })).toBe(300);
    }
  });

  it("leaves an agent already set past the cap on its own setting", () => {
    expect(manualSellSlippageBps({ side: "sell", agentBps: 2_000, requestedBps: 1_500 })).toBe(2_000);
    expect(manualSellSlippageBps({ side: "sell", agentBps: 2_000, requestedBps: 2_000 })).toBe(2_000);
  });
});

describe("widerSlippageChoices", () => {
  it("offers only what is wider than the agent's own setting", () => {
    expect(widerSlippageChoices(300)).toEqual([500, 1_000, 1_500]);
    expect(widerSlippageChoices(500)).toEqual([1_000, 1_500]);
    expect(widerSlippageChoices(1_200)).toEqual([1_500]);
    expect(widerSlippageChoices(1_500)).toEqual([]);
    expect(widerSlippageChoices(2_000)).toEqual([]);
  });

  it("only ever offers a figure the action will honour", () => {
    for (const agentBps of [10, 300, 500, 999, 1_499]) {
      for (const choice of widerSlippageChoices(agentBps)) {
        expect(manualSellSlippageBps({ side: "sell", agentBps, requestedBps: choice })).toBe(choice);
      }
    }
  });
});

describe("slippagePctLabel", () => {
  it("says basis points as a percent", () => {
    expect(slippagePctLabel(300)).toBe("3%");
    expect(slippagePctLabel(250)).toBe("2.5%");
    expect(slippagePctLabel(1_500)).toBe("15%");
    expect(slippagePctLabel(10)).toBe("0.1%");
  });
});
