import { describe, expect, it } from "vitest";
import { emptyChainCash, type UnifiedCash } from "@/lib/wallets/funding";
import {
  cashLegendLead,
  cashPanelTitle,
  cashScopeLabel,
  cashUnavailable,
  shownCashTotal,
  shownUsdc,
} from "./cash-display";

function cashWith(base: number, solana: number, inAgentsUsd = 0): UnifiedCash {
  const perChain = [
    { ...emptyChainCash("base"), usdc: base, usdcUsd: base },
    { ...emptyChainCash("solana"), usdc: solana, usdcUsd: solana },
  ];
  const totalUsd = Math.round((base + solana) * 100) / 100;
  return { totalUsd, gasUsd: 0, perChain, inAgentsUsd, agents: [], allUsd: totalUsd + inAgentsUsd };
}

describe("shown cash", () => {
  it("floors a sub-cent balance instead of rounding it up", () => {
    expect(shownUsdc(12.349)).toBe(12.34);
    expect(shownUsdc(0.009)).toBe(0);
  });

  it("makes the total the sum of the rows it sits above", () => {
    const cash = cashWith(120.5, 12.349);
    // Rounded, the total would read $132.85 over rows of $120.50 and $12.34.
    expect(shownCashTotal(cash)).toBe(132.84);
  });

  it("adds agent equity as is on the all-in figure", () => {
    expect(shownCashTotal(cashWith(0.1, 0.2, 50.55), "all")).toBe(50.85);
  });
});

describe("a balance that could not be read", () => {
  it("makes the user's own figure unavailable when one of their wallets is unread", () => {
    const cash = cashWith(0, 12);
    cash.perChain[0].readFailed = true;
    expect(cashUnavailable(cash)).toBe(true);
    expect(cashUnavailable(cash, "all")).toBe(true);
  });

  it("makes only the all-in figure unavailable when it is an agent that is unread", () => {
    const cash = { ...cashWith(4, 12, 30), partial: true };
    // The user's own wallets were read, so what they can fund with is still a number.
    expect(cashUnavailable(cash)).toBe(false);
    expect(cashUnavailable(cash, "all")).toBe(true);
  });

  it("is available when everything answered, zero included", () => {
    expect(cashUnavailable(cashWith(0, 0))).toBe(false);
    expect(cashUnavailable(cashWith(0, 0), "all")).toBe(false);
  });
});

describe("what the top bar's number is called", () => {
  const agent = (parked: boolean) => ({
    id: parked ? "p" : "l",
    slug: "a",
    name: "A",
    equityUsd: 10,
    cashUsd: 10,
    positionsUsd: 0,
    ...(parked ? { parked: true } : {}),
  });
  const withAgents = (...agents: ReturnType<typeof agent>[]): UnifiedCash => ({ ...cashWith(20, 0, 10 * agents.length), agents });

  it("is cash while it is only the user's own USDC, the number Home calls Cash", () => {
    expect(cashScopeLabel(cashWith(20, 0))).toBe("cash");
    expect(cashScopeLabel(undefined)).toBe("cash");
    expect(cashPanelTitle(cashWith(20, 0))).toBe("Cash");
    expect(cashLegendLead(cashWith(20, 0))).toBe("Cash is USDC across your wallets on Base and Solana");
  });

  it("is a total once it counts what agents hold, positions included", () => {
    const cash = withAgents(agent(false));
    expect(cashScopeLabel(cash)).toBe("total");
    expect(cashPanelTitle(cash)).toBe("Cash + live agents");
    expect(cashLegendLead(cash)).toBe(
      "Total is USDC across your wallets on Base and Solana, plus your live agents' equity (their cash and open positions at today's marks)",
    );
  });

  it("names USDC waiting in an agent that is not live yet", () => {
    const parkedOnly = withAgents(agent(true));
    expect(cashScopeLabel(parkedOnly)).toBe("total");
    expect(cashPanelTitle(parkedOnly)).toBe("Cash + agents");
    expect(cashLegendLead(parkedOnly)).toBe(
      "Total is USDC across your wallets on Base and Solana, plus USDC waiting in agents that are not live yet",
    );
    expect(cashLegendLead(withAgents(agent(false), agent(true)))).toBe(
      "Total is USDC across your wallets on Base and Solana, plus what your agents hold: live agents' equity (their cash and open positions at today's marks) and USDC waiting in agents that are not live yet",
    );
  });
});
