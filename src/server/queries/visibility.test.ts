import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import type { AgentConfig } from "@/db/schema";
import type { RunStep, TradeScore } from "@/server/types";
import {
  isAgentOwner,
  REDACTED_ERROR,
  toPublicProfile,
  visibleConfig,
  visibleError,
  visibleExitDistances,
  visibleScore,
  visibleSteps,
} from "./visibility";

const OWNER = "did:privy:owner";
const OTHER = "did:privy:someone-else";

const SECRET_PROMPT = "Buy the dip on tokens whose organic buyer ratio is above 0.62.";

const config: AgentConfig = {
  ...DEFAULT_AGENT_CONFIG,
  strategyPrompt: SECRET_PROMPT,
  dataSources: ["sentimentalpha", "cmc-quotes", "token-intel-sol"],
  chains: ["solana", "base"],
  universe: { ...DEFAULT_AGENT_CONFIG.universe, minScore: 71 },
  schedule: { intervalMinutes: 15 },
  llm: { provider: "anthropic", model: "claude-sonnet-5", temperature: 0.4, maxSteps: 12 },
};

const steps: RunStep[] = [
  {
    id: "step_1",
    seq: 1,
    kind: "tool_call",
    toolName: "query_data_source",
    payload: { args: { sourceId: "sentimentalpha", params: { query: "WIF narrative velocity" } } },
    durationMs: 812,
    createdAt: "2026-09-01T00:00:00.000Z",
  },
];

describe("isAgentOwner", () => {
  it("is true only for the owner", () => {
    expect(isAgentOwner(OWNER, OWNER)).toBe(true);
    expect(isAgentOwner(OWNER, OTHER)).toBe(false);
  });

  it("is false for a signed-out viewer, and never true on a falsy id collision", () => {
    expect(isAgentOwner(OWNER, null)).toBe(false);
    expect(isAgentOwner(OWNER, undefined)).toBe(false);
    // The guard that matters: an empty owner id must not match an empty viewer id.
    expect(isAgentOwner("", "")).toBe(false);
    expect(isAgentOwner("", null)).toBe(false);
  });
});

describe("visibleConfig", () => {
  it("hands the owner their whole config", () => {
    expect(visibleConfig(config, true)).toBe(config);
  });

  it("returns null for everyone else — not a redacted object", () => {
    expect(visibleConfig(config, false)).toBeNull();
  });

  it("leaks nothing when serialised for a non-owner", () => {
    const payload = JSON.stringify({ config: visibleConfig(config, false) });
    expect(payload).not.toContain(SECRET_PROMPT);
    expect(payload).not.toContain("sentimentalpha");
    expect(payload).not.toContain("71");
  });

  it("stays null when the owner has no config row", () => {
    expect(visibleConfig(null, true)).toBeNull();
    expect(visibleConfig(undefined, true)).toBeNull();
  });
});

describe("toPublicProfile", () => {
  it("carries only shape: chains, model, cadence and a count", () => {
    expect(toPublicProfile(config)).toEqual({
      chains: ["solana", "base"],
      model: "claude-sonnet-5",
      intervalMinutes: 15,
      dataSourceCount: 3,
    });
  });

  it("names how many sources it buys, never which ones", () => {
    const payload = JSON.stringify(toPublicProfile(config));
    expect(payload).not.toContain("sentimentalpha");
    expect(payload).not.toContain("token-intel-sol");
    expect(payload).not.toContain(SECRET_PROMPT);
  });

  it("reports a manual-only agent (intervalMinutes 0) as null", () => {
    expect(toPublicProfile({ ...config, schedule: { intervalMinutes: 0 } }).intervalMinutes).toBeNull();
  });

  it("degrades to empty rather than throwing on a missing config", () => {
    expect(toPublicProfile(null)).toEqual({
      chains: [],
      model: "",
      intervalMinutes: null,
      dataSourceCount: 0,
    });
  });
});

describe("visibleSteps", () => {
  it("gives the owner the transcript", () => {
    expect(visibleSteps(steps, true)).toHaveLength(1);
  });

  it("gives everyone else an empty array", () => {
    expect(visibleSteps(steps, false)).toEqual([]);
  });

  it("drops the queries and arguments, not just the rendering", () => {
    const payload = JSON.stringify(visibleSteps(steps, false));
    expect(payload).not.toContain("sentimentalpha");
    expect(payload).not.toContain("WIF narrative velocity");
  });
});

describe("visibleError", () => {
  // Real shapes the product has actually produced. Each one is a credential or an
  // internal address that a public run page would otherwise publish verbatim.
  const LEAKY = [
    "Incorrect API key provided: sk-proj-9XbQ2mA7fTn1. You can find your API key at https://platform.openai.com/account/api-keys.",
    "fetch failed: https://mainnet.helius-rpc.com/?api-key=8b1f0c2e-77aa-4d31-9a50-1c0f8e6b2d44",
    "Privy policy rjq4ke denied signTransaction for wallet zx91v: Transfer.amount 2000000 exceeds 1000000",
  ];

  it("gives the owner the provider's own words", () => {
    for (const error of LEAKY) expect(visibleError(error, true)).toBe(error);
  });

  it("gives everyone else a fixed sentence and none of the original", () => {
    for (const error of LEAKY) {
      const shown = visibleError(error, false);
      expect(shown).toBe(REDACTED_ERROR);
      // Nothing from the original survives — not a key, not a host, not a wallet id.
      for (const secret of ["sk-proj-9XbQ2mA7fTn1", "helius-rpc.com", "api-key", "rjq4ke", "zx91v"]) {
        expect(shown).not.toContain(secret);
      }
    }
  });

  it("keeps null null for both, so a run that did not fail never reads as failed", () => {
    expect(visibleError(null, true)).toBeNull();
    expect(visibleError(null, false)).toBeNull();
    expect(visibleError(undefined, false)).toBeNull();
    expect(visibleError("", false)).toBeNull();
  });

  it("still tells a stranger that it failed — the record keeps its losses", () => {
    expect(visibleError("boom", false)).toBeTruthy();
  });
});

describe("visibleScore", () => {
  const score: TradeScore = {
    total: 74,
    verdict: "candidate",
    components: { safety: 90, liquidity: 70, gecko: 61, sentiment: 82, smartMoney: 40 },
    blockers: ["blocklisted", "liquidity_below_floor", "age_above_max", "top10_holders_72pct", "honeypot", "cannot_sell"],
    warnings: ["parabolic_1h_move"],
    liquidityUsd: 41_000,
    ageHours: 30,
    scoredAt: "2026-09-01T00:00:00.000Z",
  };

  it("gives the owner the snapshot untouched", () => {
    expect(visibleScore(score, true)).toBe(score);
  });

  it("hides which paid sources the agent bought from everyone else", () => {
    const shown = visibleScore(score, false)!;
    expect(shown.components.sentiment).toBeNull();
    expect(shown.components.smartMoney).toBeNull();
    // The free components and the verdict are the public record.
    expect(shown.total).toBe(74);
    expect(shown.components.safety).toBe(90);
    expect(shown.components.gecko).toBe(61);
  });

  it("keeps only blockers about the token, never ones that echo the universe", () => {
    expect(visibleScore(score, false)!.blockers).toEqual(["honeypot", "cannot_sell"]);
  });

  it("passes null through", () => {
    expect(visibleScore(null, false)).toBeNull();
  });
});

describe("visibleExitDistances", () => {
  const position = { unrealizedPnlPct: -4, stopDistancePct: 11, takeProfitDistancePct: 44 };

  it("strips the distances that would give away stop-loss and take-profit", () => {
    expect(visibleExitDistances(position, false)).toEqual({
      unrealizedPnlPct: -4,
      stopDistancePct: null,
      takeProfitDistancePct: null,
    });
  });

  it("keeps them for the owner", () => {
    expect(visibleExitDistances(position, true)).toBe(position);
  });
});
