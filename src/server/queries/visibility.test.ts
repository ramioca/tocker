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
  visibleRationale,
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

describe("visibleRationale", () => {
  const TP =
    "Take profit: BONK +91.5% from entry at $0.0000318, past my 35% target (entry $0.0000166). Banked it. $95.40 out.";
  const SL =
    "Stop loss: WIF −18.2% from entry at $1.21, through my 15% stop (entry $1.48). Closed the position. $40.00 out.";
  const TRAIL =
    "Trailing stop: BONK fell 21.0% from its $2.00 peak to $1.58, through my 20% trail. Still +58.0% on the trade, so I took the win rather than watch it round-trip. $158.00 out.";
  const HOLD =
    "Max hold: JUP has been open 24.1h, past my 24.0h limit, at +4.9%. The thesis had its window; closing it out. $10.49 out.";

  it("rebuilds a stored exit from its reason, with no rule value left in it", () => {
    expect(visibleRationale(TP, { isOwner: false, exitReason: "take_profit", symbol: "BONK" })).toBe(
      "Take profit: sold BONK at +91.5% from entry. $95.40 out.",
    );
    expect(visibleRationale(SL, { isOwner: false, exitReason: "stop_loss", symbol: "WIF" })).toBe(
      "Stop loss: closed WIF at −18.2% from entry. $40.00 out.",
    );
    // The unsigned 21.0% drop and 20% trail would bound the setting; the signed move is the trade.
    expect(visibleRationale(TRAIL, { isOwner: false, exitReason: "trailing_stop", symbol: "BONK" })).toBe(
      "Trailing stop: sold BONK off its high at +58.0% from entry. $158.00 out.",
    );
    const hold = visibleRationale(HOLD, { isOwner: false, exitReason: "max_hold", symbol: "JUP" });
    expect(hold).toBe("Max hold: closed JUP at +4.9% from entry. $10.49 out.");
    expect(hold).not.toContain("24");
  });

  it("rebuilds the current template too, grouped dollar amount included", () => {
    const current =
      "Take profit: BONK at $0.0000318, +91.5% from entry ($0.0000166), past my 35% target. Banked it. $2,141.37 out.";
    expect(visibleRationale(current, { isOwner: false, exitReason: "take_profit", symbol: "BONK" })).toBe(
      "Take profit: sold BONK at +91.5% from entry. $2,141.37 out.",
    );
  });

  it("is idempotent on a line that is already public", () => {
    const line = "Take profit: sold BONK at +91.5% from entry. $95.40 out.";
    expect(visibleRationale(line, { isOwner: false, exitReason: "take_profit", symbol: "BONK" })).toBe(line);
  });

  it("gives the owner the text untouched", () => {
    expect(visibleRationale(TP, { isOwner: true, exitReason: "take_profit", symbol: "BONK" })).toBe(TP);
    const buy = "X sentiment 77.9 via SentimentAlpha (paid), safety 90.";
    expect(visibleRationale(buy, { isOwner: true })).toBe(buy);
  });

  it("cuts threshold clauses out of free text", () => {
    expect(visibleRationale("Sold into strength, past my 35% target (entry $1.00). Done.", { isOwner: false })).toBe(
      "Sold into strength (entry $1.00). Done.",
    );
    expect(visibleRationale("Score 31, under my exit floor of 40. Out.", { isOwner: false })).toBe("Score 31. Out.");
  });

  it("still redacts a retired source's spellings in rows written while it existed", () => {
    for (const text of [
      "Checked bazaar for a second sentiment read; it agreed with the score.",
      "Found a whale-flow feed on the Bazaar and it confirmed the bid.",
      "Bazaar search turned up nothing, so I bought on the score alone.",
      "Momentum plus a read from the x402 Bazaar resource looked clean.",
    ]) {
      expect(visibleRationale(text, { isOwner: false }) ?? "", text).not.toMatch(/bazaar/i);
    }
    expect(visibleRationale("Bought DOVE: bazaar listing confirmed holder growth.", { isOwner: false })).toBe(
      "Bought DOVE: a paid source listing confirmed holder growth.",
    );
    // The owner still reads what the agent wrote.
    expect(visibleRationale("Checked bazaar first.", { isOwner: true })).toBe("Checked bazaar first.");
  });

  it("replaces paid source names and ids, never leaving a vendor behind", () => {
    const buy =
      "BONK scores 85.9/100 (strong) with no hard-gate blockers: X sentiment 77.9 via SentimentAlpha (paid), safety 90. A clean Deepnets read; nansen-smart-money shows wallets adding. Nansen Smart Money agrees.";
    const out = visibleRationale(buy, { isOwner: false }) ?? "";
    expect(out).toContain("X sentiment 77.9 via a paid source, safety 90.");
    expect(out).toContain("A clean paid-source read");
    expect(out).toContain("; a paid source shows wallets adding.");
    expect(out).toContain("A paid source agrees.");
    for (const vendor of ["SentimentAlpha", "(paid)", "Deepnets", "nansen", "Nansen", "Smart Money"]) {
      expect(out).not.toContain(vendor);
    }
  });

  it("leaves ordinary prose alone", () => {
    const buy = "WIF scores 72/100 (watch): organic 88 with 1.2k organic buyers against $310k liquidity.";
    expect(visibleRationale(buy, { isOwner: false })).toBe(buy);
    expect(visibleRationale(null, { isOwner: false })).toBeNull();
  });
});
