import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import type { AgentConfig } from "@/db/schema";
import { isAllowlisted, riskGuard, type OrderIntent, type RiskAgent, type RiskPortfolio } from "./risk";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BRETT = "0x532f27101965dd16442E59d40670FaF5eBB142E4";

function agentWith(config: Partial<AgentConfig> = {}): RiskAgent {
  return {
    id: "agent-1",
    mode: "paper",
    config: {
      ...DEFAULT_AGENT_CONFIG,
      ...config,
      risk: { ...DEFAULT_AGENT_CONFIG.risk, ...config.risk },
    },
  };
}

function portfolio(overrides: Partial<RiskPortfolio> = {}): RiskPortfolio {
  return {
    cashUsd: 10_000,
    equityUsd: 10_000,
    positions: [],
    tradesToday: 0,
    ...overrides,
  };
}

const buy: OrderIntent = {
  chain: "solana",
  side: "buy",
  tokenId: `solana:${BONK}`,
  tokenAddress: BONK,
  symbol: "BONK",
  amountUsd: 50,
};

describe("riskGuard", () => {
  it("allows a normal buy inside every limit", () => {
    expect(riskGuard(agentWith(), portfolio(), buy)).toEqual({ ok: true });
  });

  it("rejects a non-positive size", () => {
    const verdict = riskGuard(agentWith(), portfolio(), { ...buy, amountUsd: 0 });
    expect(verdict.ok).toBe(false);
  });

  it("rejects a chain the agent has not enabled", () => {
    const verdict = riskGuard(agentWith({ chains: ["solana"] }), portfolio(), {
      ...buy,
      chain: "base",
      tokenId: `base:${BRETT}`,
      tokenAddress: BRETT,
      symbol: "BRETT",
    });
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("not enabled");
  });

  it("enforces the token allowlist when one is set", () => {
    const restricted = agentWith({
      tokenAllowlist: [{ chain: "solana", address: "SomeOtherMint1111111111111111111111111111", symbol: "WIF" }],
    });
    const verdict = riskGuard(restricted, portfolio(), buy);
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("allowlist");
  });

  it("treats an empty allowlist as permissive", () => {
    expect(isAllowlisted(agentWith().config, "solana", BONK, "BONK")).toBe(true);
  });

  it("matches allowlist entries case-insensitively on address", () => {
    const config = agentWith({
      tokenAllowlist: [{ chain: "base", address: BRETT.toLowerCase(), symbol: "BRETT" }],
    }).config;
    expect(isAllowlisted(config, "base", BRETT.toUpperCase(), "BRETT")).toBe(true);
  });

  it("rejects a trade above maxTradeUsd", () => {
    const verdict = riskGuard(agentWith({ risk: { ...DEFAULT_AGENT_CONFIG.risk, maxTradeUsd: 25 } }), portfolio(), buy);
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("maxTradeUsd");
  });

  it("rejects once the daily trade count is used up", () => {
    const verdict = riskGuard(
      agentWith({ risk: { ...DEFAULT_AGENT_CONFIG.risk, maxDailyTrades: 3 } }),
      portfolio({ tradesToday: 3 }),
      buy,
    );
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("Daily trade limit");
  });

  it("rejects a buy larger than available cash", () => {
    const verdict = riskGuard(agentWith(), portfolio({ cashUsd: 20, equityUsd: 20 }), buy);
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("Insufficient cash");
  });

  it("rejects a buy that would breach maxPositionPct", () => {
    const verdict = riskGuard(
      agentWith({ risk: { ...DEFAULT_AGENT_CONFIG.risk, maxPositionPct: 10 } }),
      portfolio({
        cashUsd: 1_000,
        equityUsd: 1_000,
        positions: [
          { tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 1, valueUsd: 80 },
        ],
      }),
      buy,
    );
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("maxPositionPct");
  });

  it("allows a buy exactly at maxPositionPct", () => {
    const verdict = riskGuard(
      agentWith({ risk: { ...DEFAULT_AGENT_CONFIG.risk, maxPositionPct: 10 } }),
      portfolio({ cashUsd: 1_000, equityUsd: 1_000 }),
      { ...buy, amountUsd: 100 },
    );
    expect(verdict).toEqual({ ok: true });
  });

  it("rejects a sell with no position", () => {
    const verdict = riskGuard(agentWith(), portfolio(), { ...buy, side: "sell" });
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("No BONK position");
  });

  it("rejects a sell larger than the position value", () => {
    const verdict = riskGuard(
      agentWith(),
      portfolio({
        positions: [
          { tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 10, valueUsd: 20 },
        ],
      }),
      { ...buy, side: "sell", amountUsd: 50 },
    );
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("exceeds");
  });

  it("refuses to sell an unpriced position", () => {
    const verdict = riskGuard(
      agentWith(),
      portfolio({
        positions: [
          { tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 10, valueUsd: null },
        ],
      }),
      { ...buy, side: "sell", amountUsd: 5 },
    );
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("price");
  });

  it("allows a sell inside the position value", () => {
    const verdict = riskGuard(
      agentWith(),
      portfolio({
        positions: [
          { tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 10, valueUsd: 200 },
        ],
      }),
      { ...buy, side: "sell", amountUsd: 50 },
    );
    expect(verdict).toEqual({ ok: true });
  });
});
