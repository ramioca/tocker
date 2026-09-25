import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import type { AgentConfig } from "@/db/schema";
import type { TokenScore } from "@/server/types";
import { riskGuard, type OrderIntent, type RiskPortfolio, type RiskVerdict } from "./risk";
import { ownerRiskMessage } from "./risk-copy";

const config: AgentConfig = {
  ...DEFAULT_AGENT_CONFIG,
  chains: ["solana"],
  risk: { ...DEFAULT_AGENT_CONFIG.risk, maxTradeUsd: 400, maxPositionPct: 25, maxDailyTrades: 10 },
  universe: { ...DEFAULT_AGENT_CONFIG.universe, minScore: 74, blocklist: [] },
};
const agent = { id: "a", mode: "paper" as const, config };
const book: RiskPortfolio = { cashUsd: 10_000, equityUsd: 10_000, positions: [], tradesToday: 0 };

function order(over: Partial<OrderIntent> = {}): OrderIntent {
  return { chain: "solana", side: "buy", tokenId: "solana:JUP", tokenAddress: "JUP", symbol: "JUP", amountUsd: 25, ...over };
}

function score(over: Partial<TokenScore> = {}): TokenScore {
  return {
    tokenId: "solana:JUP",
    chain: "solana",
    address: "JUP",
    symbol: "JUP",
    name: null,
    total: 90,
    verdict: "strong",
    components: { safety: 90, liquidity: 90, organic: 90, distribution: 90, momentum: 90, gecko: null, sentiment: null, smartMoney: null },
    blockers: [],
    warnings: [],
    priceUsd: 1,
    liquidityUsd: 1_000_000,
    volume24hUsd: 1_000_000,
    marketCapUsd: 1_000_000_000,
    holderCount: 10_000,
    ageHours: 10_000,
    priceChange24hPct: 1,
    sources: ["jupiter"],
    scoredAt: new Date().toISOString(),
    ...over,
  };
}

function refused(verdict: RiskVerdict): Extract<RiskVerdict, { ok: false }> {
  if (verdict.ok) throw new Error("expected a refusal");
  return verdict;
}

describe("ownerRiskMessage", () => {
  it("names the per-trade cap in the owner's words, not the config key", () => {
    const message = ownerRiskMessage(refused(riskGuard(agent, book, order({ amountUsd: 5_000 }), score())));
    expect(message).toBe("$5,000 is over this agent's $400 per-trade cap. Lower the size or raise Max per trade in Settings.");
    expect(message).not.toContain("maxTradeUsd");
  });

  it("shows the first two failed gates by title, then a count, never the codes", () => {
    const blockers = [
      "mint_authority_unknown",
      "freeze_authority_unknown",
      "liquidity_unknown",
      "holder_count_unknown",
      "age_unknown",
      "top10_holders_unknown",
    ];
    const message = ownerRiskMessage(refused(riskGuard(agent, book, order(), score({ blockers }))));
    expect(message).toBe("JUP fails hard gates: Mint authority unverified; Freeze authority unverified; +4 more.");
    expect(message).not.toMatch(/_unknown|score_token|outscored/);
  });

  it("says which chain is off, by its name", () => {
    const message = ownerRiskMessage(refused(riskGuard(agent, book, order({ chain: "base" }), score())));
    expect(message).toBe("Base isn't enabled for this agent. Turn it on in Settings to trade JUP.");
  });

  it("puts the concentration and its cap side by side", () => {
    const small = { ...book, cashUsd: 100, equityUsd: 100 };
    const message = ownerRiskMessage(refused(riskGuard(agent, small, order({ amountUsd: 31 }), score())));
    expect(message).toBe("This would make JUP 31% of equity; the cap is 25%. Lower the size or raise Max position size in Settings.");
  });

  it("keeps the score sentence the manual sheet always had", () => {
    const message = ownerRiskMessage(refused(riskGuard(agent, book, order(), score({ total: 70.25 }))));
    expect(message).toBe(
      "Your agent's minimum score is 74; JUP scores 70.3. Lower the minimum in Settings if you meant to take this trade anyway.",
    );
  });

  it("falls back to the guard's own reason for a verdict it has no code for", () => {
    expect(ownerRiskMessage({ ok: false, reason: "Something new." })).toBe("Something new.");
  });
});
