import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { INTEL_SOURCE, SELL_CHECK_SOURCE, SMART_MONEY_SOURCE, planEnrichment } from "@/lib/agent/enrichment";
import {
  CONSOLE_SUMMARY,
  DATA_TOTAL_USD,
  DISCOVER_READS,
  FINAL_BEAT,
  LAUNCH_RADARS,
  REASONING,
  RUN_COPY,
  SAMPLE_PROPOSAL_TTL_MIN,
  SCORE_BOARD,
  STORY,
  STRATEGY_SOURCES,
  STRATEGY_SUMMARY,
  SCORE_READS,
  STAGES,
  STEPS_SCORED,
  runAt,
} from "./console-run";
import { SAMPLE_BUYS, SAMPLE_FLOOR, SAMPLE_FOUND, SAMPLE_SCORED, HERO_LABEL } from "./sample";
import { LANDING_SOURCES, usd3 } from "./signals-data";

/** The How section's console replays the hero's sample run; these keep its copy honest. */
describe("the console's sample run", () => {
  it("finishes with every step done, every line shown and the owner's turn active", () => {
    const end = runAt(FINAL_BEAT);
    expect(end.finished).toBe(true);
    expect(end.stage).toBe(STAGES.length - 1);
    expect(end.lines).toBe(REASONING.length);
    expect(end.steps.every((s) => s.status === "success")).toBe(true);
    expect(end.paid.every((p) => p.bought && p.call.status === "success")).toBe(true);
    expect(end.allBought).toBe(true);
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
    expect(start.paid.some((p) => p.bought)).toBe(false);
  });

  it("only moves forward, one beat at a time", () => {
    for (let b = 1; b <= FINAL_BEAT; b++) {
      const prev = runAt(b - 1);
      const next = runAt(b);
      expect(next.stage).toBeGreaterThanOrEqual(prev.stage);
      expect(next.lines).toBeGreaterThanOrEqual(prev.lines);
      expect(next.paid.filter((p) => p.bought).length).toBeGreaterThanOrEqual(prev.paid.filter((p) => p.bought).length);
    }
  });

  it("hands out the same frame for the same beat, so memoised parts can skip a beat", () => {
    expect(runAt(3)).toBe(runAt(3));
    expect(runAt(FINAL_BEAT).chips).toBe(runAt(99).chips);
  });

  it("scores as many tokens in the transcript as the hero says it scored", () => {
    expect(STEPS_SCORED).toBe(SAMPLE_SCORED);
  });

  it("buys exactly what planEnrichment plans for each token it scores, on the default sources", () => {
    const sourceOf = { intel: INTEL_SOURCE, deep: "x-search", sellCheck: SELL_CHECK_SOURCE, smartMoney: SMART_MONEY_SOURCE } as const;
    for (const { chain, ids } of SCORE_READS) {
      const plan = planEnrichment({
        free: { total: 70, verdict: "watch", blockers: [] },
        chain,
        sources: DEFAULT_AGENT_CONFIG.dataSources,
        remainingUsd: DEFAULT_AGENT_CONFIG.risk.maxDataSpendUsdPerRun,
        minScore: DEFAULT_AGENT_CONFIG.universe.minScore,
        already: false,
      });
      const planned = (Object.keys(sourceOf) as (keyof typeof sourceOf)[]).filter((k) => plan[k]).map((k) => sourceOf[k]);
      expect([...ids].sort(), chain).toEqual([...planned].sort());
    }
  });

  it("sweeps a paid launch radar on each chain in discovery, as the run loop always does", () => {
    expect([...DISCOVER_READS].sort()).toEqual(Object.values(LAUNCH_RADARS).sort());
    for (const id of DISCOVER_READS) expect(LANDING_SOURCES.some((s) => s.id === id)).toBe(true);
  });

  it("totals the data it shows, at registry prices, inside the default budget", () => {
    const shown = runAt(FINAL_BEAT).paid;
    for (const p of shown) {
      const price = LANDING_SOURCES.find((s) => s.id === p.call.name)?.priceUsd ?? NaN;
      expect(p.priceUsd).toBeCloseTo(price * p.count, 9);
    }
    expect(usd3(DATA_TOTAL_USD)).toBe(usd3(shown.reduce((sum, p) => sum + p.priceUsd, 0)));
    expect(DATA_TOTAL_USD).toBeLessThanOrEqual(DEFAULT_AGENT_CONFIG.risk.maxDataSpendUsdPerRun);
    expect(REASONING.some((r) => r.content.includes(usd3(DATA_TOTAL_USD)))).toBe(true);
    expect(CONSOLE_SUMMARY).toContain(usd3(DATA_TOTAL_USD));
  });

  it("uses the default proposal expiry", () => {
    expect(SAMPLE_PROPOSAL_TTL_MIN).toBe(DEFAULT_AGENT_CONFIG.execution.proposalTtlMinutes);
  });
});

describe("sample copy about real coins", () => {
  const claims =
    /gate|mint|freeze|honeypot|revok|renounc|\brugs?\b|\bsafe(ty)?\b|\bclean\b|\bverified\b|audit|\block(ed)?\b|\bburn(ed|t)?\b|sellab|passed|failed|risk|top.?ten|holders? hold|\btax/i;
  const realCoin = /TIBBIR|SUPER INU|\bSOL\b/;
  const lines = [...RUN_COPY, HERO_LABEL, ...STORY.flatMap((s) => [s.title, s.body]), ...SCORE_BOARD.map((r) => r.label)].filter((line) => realCoin.test(line));

  it("covers the run, the console summary, the approval and the hero card", () => {
    expect(lines.length).toBeGreaterThan(10);
    expect(lines).toContain(HERO_LABEL);
    expect(lines).toContain(CONSOLE_SUMMARY);
  });

  it("never states a gate or safety outcome for a real token", () => {
    for (const line of lines) {
      expect(line.replace(/token safety reports?/g, ""), line).not.toMatch(claims);
    }
  });

  it("catches the claims it is there to catch", () => {
    for (const bad of ["Safety check came back clean on SUPER INU", "TIBBIR: LP burned", "SOL mint renounced", "TIBBIR is sellable"]) {
      expect(bad).toMatch(claims);
    }
    for (const fine of ["Blocklist a token you hold", "every 5 minutes on the clock"]) {
      expect(fine).not.toMatch(claims);
    }
  });
});

describe("the How story", () => {
  it("tells three steps: strategy, scored run, trade", () => {
    expect(STORY.map((s) => s.id)).toEqual(["strategy", "run", "trade"]);
  });

  it("says the universe is open and the blocklist only subtracts, with no fork or copy", () => {
    const strategy = STORY[0].body;
    expect(strategy).toMatch(/no allowlist/i);
    expect(strategy).toMatch(/blocklist only/i);
    expect(strategy).toContain(String(SAMPLE_FLOOR));
    for (const s of STORY) expect(`${s.title} ${s.body}`).not.toMatch(/\bfork|\bcopy\b|clone/i);
  });

  it("quotes the run's own numbers", () => {
    expect(STORY[1].body).toContain(usd3(DATA_TOTAL_USD));
    expect(STORY[1].body).toContain(String(SAMPLE_FOUND));
    expect(STORY[1].body).toContain(String(SAMPLE_SCORED));
  });

  it("boards every token it scored, best first, with the buys above the floor", () => {
    expect(SCORE_BOARD).toHaveLength(SAMPLE_SCORED);
    const scores = SCORE_BOARD.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(SCORE_BOARD.filter((r) => r.clears).map((r) => r.coin)).toEqual(SAMPLE_BUYS.map((r) => r.coin));
  });

  it("lists the default data sources in its strategy summary", () => {
    for (const id of STRATEGY_SOURCES) {
      expect(LANDING_SOURCES.some((s) => s.id === id)).toBe(true);
      expect(STRATEGY_SUMMARY).toContain(id);
    }
  });
});
