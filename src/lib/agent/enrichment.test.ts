import { describe, expect, it } from "vitest";
import { planEnrichment } from "./enrichment";

const free = (total: number, blockers: string[] = [], verdict = "candidate") => ({ total, verdict, blockers });
const all = ["deepnets-token-safety", "x-search", "nansen-smart-money", "plexa-pretrade"];

describe("planEnrichment", () => {
  it("buys safety, sentiment and smart money on a Solana candidate within budget", () => {
    const plan = planEnrichment({ free: free(70), chain: "solana", sources: all, remainingUsd: 0.25, minScore: 60, already: false });
    expect(plan).toMatchObject({ intel: true, deep: true, smartMoney: true, sellCheck: false });
    expect(plan.plannedUsd).toBeCloseTo(0.07, 6);
  });

  it("buys the sell check on Base, never Deepnets", () => {
    const plan = planEnrichment({ free: free(70), chain: "base", sources: all, remainingUsd: 0.25, minScore: 60, already: false });
    expect(plan).toMatchObject({ intel: false, sellCheck: true, deep: true, smartMoney: true });
  });

  it("pays nothing for a token the free data has confirmed unbuyable", () => {
    const plan = planEnrichment({ free: free(80, ["mint_authority_active"]), chain: "solana", sources: all, remainingUsd: 1, minScore: 60, already: false });
    expect(plan.plannedUsd).toBe(0);
    expect(plan.skipped.join(" ")).toMatch(/mint_authority_active/);
  });

  it("still buys when the only blockers are unknowns — that is what the safety read resolves", () => {
    const plan = planEnrichment({
      free: free(55, ["mint_authority_unknown", "freeze_authority_unknown"], "avoid"),
      chain: "solana",
      sources: all,
      remainingUsd: 1,
      minScore: 60,
      already: false,
    });
    expect(plan).toMatchObject({ intel: true, deep: true, smartMoney: true });
  });

  it("does not let a weak free score save the money — the operator configured the sources to be used", () => {
    const plan = planEnrichment({ free: free(30), chain: "solana", sources: all, remainingUsd: 1, minScore: 60, already: false });
    expect(plan).toMatchObject({ intel: true, deep: true, smartMoney: true });
    expect(plan.plannedUsd).toBeCloseTo(0.07, 6);
  });

  it("stops at the budget, cheapest reads first", () => {
    const plan = planEnrichment({ free: free(75), chain: "solana", sources: all, remainingUsd: 0.03, minScore: 60, already: false });
    expect(plan).toMatchObject({ intel: true, deep: true, smartMoney: false });
    expect(plan.skipped.join(" ")).toMatch(/budget/);
  });

  it("only buys what the agent has configured, and never twice a tick", () => {
    expect(planEnrichment({ free: free(75), chain: "solana", sources: ["x-search"], remainingUsd: 1, minScore: 60, already: false })).toMatchObject({ intel: false, deep: true, smartMoney: false });
    expect(planEnrichment({ free: free(75), chain: "solana", sources: all, remainingUsd: 1, minScore: 60, already: true }).plannedUsd).toBe(0);
  });
});
