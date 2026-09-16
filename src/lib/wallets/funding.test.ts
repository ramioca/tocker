import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAS_USD,
  MIN_FUND_USD,
  cashOn,
  defaultSplit,
  depositTargets,
  gasAllowanceNative,
  nativePriceFor,
  planFunding,
  splitProportional,
  transfersFor,
  unifiedCash,
} from "./funding";
import type { WalletBalance } from "@/server/types";

function wallet(
  chain: "base" | "solana",
  usdc: number,
  native: number,
  nativeUsd: number | null = null,
): WalletBalance {
  return {
    chain,
    address: chain === "base" ? "0xuser" : "SoLuser",
    walletId: `w_${chain}`,
    balances: [
      { asset: "usdc", amount: usdc, usd: usdc },
      { asset: chain === "base" ? "eth" : "sol", amount: native, usd: nativeUsd },
    ],
  };
}

describe("unifiedCash", () => {
  it("adds USDC across chains into one number and keeps native out of it", () => {
    const cash = unifiedCash([wallet("base", 40, 0.01, 30), wallet("solana", 60, 0.5, 75)]);
    expect(cash.totalUsd).toBe(100);
    expect(cash.gasUsd).toBe(105);
    expect(cash.perChain.map((c) => c.chain)).toEqual(["base", "solana"]);
  });

  it("still lists a chain the user has no wallet for, at zero", () => {
    const cash = unifiedCash([wallet("base", 10, 0)]);
    expect(cash.perChain).toHaveLength(2);
    expect(cashOn(cash, "solana").usdc).toBe(0);
    expect(cashOn(cash, "solana").address).toBeNull();
  });

  it("falls back to face value when Privy omits the USD quote for USDC", () => {
    const cash = unifiedCash([
      { chain: "base", address: "0x", walletId: "w", balances: [{ asset: "usdc", amount: 12.5, usd: null }] },
    ]);
    expect(cash.totalUsd).toBe(12.5);
  });

  it("derives a native price from the user's own balance", () => {
    const cash = unifiedCash([wallet("solana", 0, 2, 300)]);
    expect(nativePriceFor(cash, "solana")).toEqual({ price: 150, derived: true });
  });

  it("falls back to a constant price when the user holds none of the asset", () => {
    const cash = unifiedCash([wallet("solana", 100, 0)]);
    expect(nativePriceFor(cash, "solana").derived).toBe(false);
  });
});

describe("splitProportional", () => {
  it("splits in proportion to the weights and adds up exactly", () => {
    const legs = splitProportional(100, [
      { chain: "base", weight: 25 },
      { chain: "solana", weight: 75 },
    ]);
    expect(legs).toEqual([
      { chain: "base", amount: 25 },
      { chain: "solana", amount: 75 },
    ]);
  });

  it("gives the rounding remainder to the heaviest chain", () => {
    const legs = splitProportional(10, [
      { chain: "base", weight: 1 },
      { chain: "solana", weight: 2 },
    ]);
    expect(legs[0].amount + legs[1].amount).toBe(10);
    expect(legs[1].amount).toBeGreaterThan(legs[0].amount);
  });

  it("splits evenly when there is no weight anywhere", () => {
    const legs = splitProportional(10, [
      { chain: "base", weight: 0 },
      { chain: "solana", weight: 0 },
    ]);
    expect(legs).toEqual([
      { chain: "base", amount: 5 },
      { chain: "solana", amount: 5 },
    ]);
  });

  it("puts everything on the only chain", () => {
    expect(splitProportional(37.5, [{ chain: "base", weight: 0 }])).toEqual([
      { chain: "base", amount: 37.5 },
    ]);
  });
});

describe("gasAllowanceNative", () => {
  it("converts dollars to native units", () => {
    expect(gasAllowanceNative(1, 150)).toBe(0.006667);
    expect(gasAllowanceNative(1, 3_000)).toBe(0.000333);
  });

  it("is zero for a zero allowance or an unknown price", () => {
    expect(gasAllowanceNative(0, 150)).toBe(0);
    expect(gasAllowanceNative(1, 0)).toBe(0);
  });
});

describe("planFunding", () => {
  const twoChains = unifiedCash([wallet("base", 40, 0.01, 30), wallet("solana", 60, 0.5, 75)]);

  it("has nothing to do in paper mode", () => {
    const plan = planFunding({
      mode: "paper",
      amountUsd: 0,
      gasUsd: 0,
      chains: ["solana"],
      cash: twoChains,
    });
    expect(plan.paper).toBe(true);
    expect(plan.ready).toBe(true);
    expect(plan.legs).toEqual([]);
  });

  it("puts the whole amount on a single-chain agent", () => {
    const plan = planFunding({
      mode: "fund",
      amountUsd: 25,
      gasUsd: DEFAULT_GAS_USD,
      chains: ["solana"],
      cash: twoChains,
    });
    expect(plan.ready).toBe(true);
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0]).toMatchObject({ chain: "solana", usdc: 25 });
    // Gas is sponsored: no native leg, whatever the request asked for.
    expect(plan.legs[0].native).toBe(0);
    expect(plan.totalGasUsd).toBe(0);
  });

  it("splits a two-chain agent proportionally to the user's balances", () => {
    const plan = planFunding({
      mode: "fund",
      amountUsd: 50,
      gasUsd: DEFAULT_GAS_USD,
      chains: ["base", "solana"],
      cash: twoChains,
    });
    expect(plan.blockers).toEqual([]);
    expect(plan.legs.map((l) => l.usdc)).toEqual([20, 30]);
    expect(plan.totalUsdc).toBe(50);
    expect(plan.totalGasUsd).toBe(0);
  });

  it("honours an explicit split the user dragged", () => {
    const plan = planFunding({
      mode: "fund",
      amountUsd: 50,
      gasUsd: 0,
      chains: ["base", "solana"],
      cash: twoChains,
      split: { base: 40, solana: 10 },
    });
    expect(plan.legs.map((l) => l.usdc)).toEqual([40, 10]);
    expect(plan.ready).toBe(true);
  });

  it("blocks a split that does not add up to the amount", () => {
    const plan = planFunding({
      mode: "fund",
      amountUsd: 50,
      gasUsd: 0,
      chains: ["base", "solana"],
      cash: twoChains,
      split: { base: 10, solana: 10 },
    });
    expect(plan.ready).toBe(false);
    expect(plan.blockers[0].kind).toBe("over-available");
  });

  it("blocks below the minimum", () => {
    const plan = planFunding({
      mode: "fund",
      amountUsd: MIN_FUND_USD - 1,
      gasUsd: 0,
      chains: ["solana"],
      cash: twoChains,
    });
    expect(plan.ready).toBe(false);
    expect(plan.blockers.some((b) => b.kind === "below-minimum")).toBe(true);
  });

  it("blocks with a deposit CTA when a chain has no USDC — never funds less", () => {
    const cash = unifiedCash([wallet("base", 0, 0.01, 30), wallet("solana", 100, 0.5, 75)]);
    const plan = planFunding({
      mode: "fund",
      amountUsd: 50,
      gasUsd: 0,
      chains: ["base", "solana"],
      cash,
      split: { base: 25, solana: 25 },
    });
    expect(plan.ready).toBe(false);
    const blocker = plan.blockers.find((b) => b.kind === "chain-short-usdc");
    expect(blocker?.chain).toBe("base");
    expect(blocker?.deposit).toEqual({ chain: "base", asset: "usdc" });
  });

  it("never blocks on native: gas is sponsored, so a wallet with USDC and no SOL is ready", () => {
    const cash = unifiedCash([wallet("solana", 100, 0)]);
    const plan = planFunding({
      mode: "fund",
      amountUsd: 25,
      gasUsd: DEFAULT_GAS_USD,
      chains: ["solana"],
      cash,
    });
    expect(plan.ready).toBe(true);
    expect(plan.blockers.some((b) => b.kind === "chain-short-native")).toBe(false);
    expect(plan.legs[0].native).toBe(0);
  });

  it("does not ask for gas when the allowance is zero", () => {
    const cash = unifiedCash([wallet("solana", 100, 0)]);
    const plan = planFunding({ mode: "fund", amountUsd: 25, gasUsd: 0, chains: ["solana"], cash });
    expect(plan.ready).toBe(true);
    expect(plan.legs[0].native).toBe(0);
  });

  it("blocks when the total exceeds what the enabled chains hold", () => {
    const plan = planFunding({
      mode: "fund",
      amountUsd: 500,
      gasUsd: 0,
      chains: ["base", "solana"],
      cash: twoChains,
    });
    expect(plan.blockers.some((b) => b.kind === "over-available")).toBe(true);
    expect(plan.ready).toBe(false);
  });

  it("blocks with no chains chosen", () => {
    const plan = planFunding({ mode: "fund", amountUsd: 10, gasUsd: 0, chains: [], cash: twoChains });
    expect(plan.blockers[0].kind).toBe("no-chains");
  });

  it("flags a chain the user has no embedded wallet on", () => {
    const cash = unifiedCash([wallet("solana", 100, 1, 150)]);
    const plan = planFunding({
      mode: "fund",
      amountUsd: 10,
      gasUsd: 0,
      chains: ["base"],
      cash,
    });
    expect(plan.blockers.some((b) => b.kind === "no-wallet" || b.kind === "over-available")).toBe(true);
  });
});

describe("transfersFor", () => {
  it("sends only USDC — gas is sponsored, so no native transfer is ever queued", () => {
    const cash = unifiedCash([wallet("solana", 100, 1, 150)]);
    const plan = planFunding({
      mode: "fund",
      amountUsd: 25,
      gasUsd: DEFAULT_GAS_USD,
      chains: ["solana"],
      cash,
    });
    expect(transfersFor(plan).map((t) => t.asset)).toEqual(["usdc"]);
  });

  it("skips zero legs", () => {
    const cash = unifiedCash([wallet("base", 100, 1, 3_000)]);
    const plan = planFunding({
      mode: "fund",
      amountUsd: 10,
      gasUsd: 0,
      chains: ["base", "solana"],
      cash,
      split: { base: 10, solana: 0 },
    });
    expect(transfersFor(plan)).toEqual([{ chain: "base", asset: "usdc", amount: 10 }]);
  });
});

describe("depositTargets", () => {
  it("collapses two blockers that point at the same deposit into one", () => {
    // No Solana wallet at all: the plan raises both "over available" and
    // "no wallet", and both are fixed by the same deposit.
    const cash = unifiedCash([]);
    const plan = planFunding({ mode: "fund", amountUsd: 25, gasUsd: 0, chains: ["solana"], cash });
    expect(plan.blockers.length).toBeGreaterThan(1);
    expect(depositTargets(plan)).toEqual([{ chain: "solana", asset: "usdc" }]);
  });

  it("asks only for USDC on an empty wallet — never for gas", () => {
    const cash = unifiedCash([wallet("solana", 0, 0)]);
    const plan = planFunding({
      mode: "fund",
      amountUsd: 25,
      gasUsd: DEFAULT_GAS_USD,
      chains: ["solana"],
      cash,
    });
    expect(depositTargets(plan)).toEqual([{ chain: "solana", asset: "usdc" }]);
  });

  it("is empty for a plan with nothing blocking it", () => {
    const cash = unifiedCash([wallet("base", 100, 1, 3_000)]);
    const plan = planFunding({ mode: "fund", amountUsd: 25, gasUsd: 0, chains: ["base"], cash });
    expect(plan.ready).toBe(true);
    expect(depositTargets(plan)).toEqual([]);
  });
});

describe("defaultSplit", () => {
  it("is proportional to held balances", () => {
    const cash = unifiedCash([wallet("base", 10, 0), wallet("solana", 90, 0)]);
    expect(defaultSplit(100, ["base", "solana"], cash)).toEqual([
      { chain: "base", amount: 10 },
      { chain: "solana", amount: 90 },
    ]);
  });
});
