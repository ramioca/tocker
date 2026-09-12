import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import type { AgentConfig } from "@/db/schema";
import type { RunStep } from "@/server/types";
import { isAgentOwner, toPublicProfile, visibleConfig, visibleSteps } from "./visibility";

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
