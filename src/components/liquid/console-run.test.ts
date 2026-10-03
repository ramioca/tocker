import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { planEnrichment } from "@/lib/agent/enrichment";
import {
  DATA_TOTAL_USD,
  FINAL_BEAT,
  REASONING,
  RUN_COPY,
  SAMPLE_PROPOSAL_TTL_MIN,
  STAGES,
  runAt,
  usd3,
} from "./console-run";
import { LANDING_SOURCES } from "./signals-data";

/** The How section's console replays the hero's sample run; these keep its copy honest. */
describe("the console's sample run", () => {
  it("finishes with every step done, every line shown and the owner's turn active", () => {
    const end = runAt(FINAL_BEAT);
    expect(end.finished).toBe(true);
    expect(end.stage).toBe(STAGES.length - 1);
    expect(end.lines).toBe(REASONING.length);
    expect(end.steps.every((s) => s.status === "success")).toBe(true);
    expect(end.paid.every((p) => p.bought && p.call.status === "success")).toBe(true);
  });

  it("starts with only discovery running, nothing to open and no reasoning yet", () => {
    const start = runAt(0);
    expect(start.stage).toBe(0);
    expect(start.lines).toBe(0);
    expect(start.steps[0].status).toBe("running");
    expect(start.steps.slice(1).every((s) => s.status === "pending")).toBe(true);
    for (const s of start.steps) {
      expect(s.result).toBeUndefined();
      expect(s.children).toBeUndefined();
    }
  });

  it("only moves forward, one beat at a time", () => {
    for (let b = 1; b <= FINAL_BEAT; b++) {
      const prev = runAt(b - 1);
      const next = runAt(b);
      expect(next.stage).toBeGreaterThanOrEqual(prev.stage);
      expect(next.lines).toBeGreaterThanOrEqual(prev.lines);
    }
  });

  it("totals the data it shows, at registry prices", () => {
    const shown = runAt(FINAL_BEAT).paid;
    for (const p of shown) expect(p.priceUsd).toBe(LANDING_SOURCES.find((s) => s.id === p.call.name)?.priceUsd);
    expect(usd3(DATA_TOTAL_USD)).toBe(usd3(shown.reduce((sum, p) => sum + p.priceUsd, 0)));
    expect(REASONING.some((r) => r.content.includes(usd3(DATA_TOTAL_USD)))).toBe(true);
  });

  it("buys each paid read for a token on a chain the app would buy it for", () => {
    const chainOf = { TIBBIR: "base", "SUPER INU": "solana" } as const;
    for (const p of runAt(FINAL_BEAT).paid) {
      const chain = chainOf[p.token as keyof typeof chainOf];
      const plan = planEnrichment({
        free: { total: 70, verdict: "watch", blockers: [] },
        chain,
        sources: DEFAULT_AGENT_CONFIG.dataSources,
        remainingUsd: 1,
        minScore: DEFAULT_AGENT_CONFIG.universe.minScore,
        already: false,
      });
      const bought = { "deepnets-token-safety": plan.intel, "x-search": plan.deep }[p.call.name];
      expect(bought, `${p.call.name} on ${chain}`).toBe(true);
    }
  });

  it("uses the default proposal expiry", () => {
    expect(SAMPLE_PROPOSAL_TTL_MIN).toBe(DEFAULT_AGENT_CONFIG.execution.proposalTtlMinutes);
  });

  it("never states a gate or safety outcome for a real token", () => {
    const claims = /gate|mint|freeze|honeypot|revoked|rug|safe\b|passed|failed|risk|top ten|holders? hold|tax/i;
    for (const line of RUN_COPY) {
      expect(line.replace(/token safety report/g, ""), line).not.toMatch(claims);
    }
  });
});
