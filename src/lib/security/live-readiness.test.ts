import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_TRADE_PRESET,
  checkBudget,
  checkDataSources,
  databaseStep,
  evaluateFirstTradeRisk,
  paperPositionsStep,
  firstTradeChain,
  simulateFirstTrade,
  withFirstTradePreset,
  type DatabaseStepInput,
} from "./live-readiness";
import { dataChainsFor } from "@/lib/data-sources/registry";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { thinkingReserveUsd, usdcChoiceProblem } from "@/lib/agent/inference";
import type { AgentConfig } from "@/db/schema";

function config(overrides: Partial<AgentConfig["risk"]> = {}, chains: AgentConfig["chains"] = ["base"]): AgentConfig {
  return {
    strategyPrompt: "buy low",
    dataSources: [],
    chains,
    universe: {
      discovery: ["trending"],
      minScore: 60,
      minLiquidityUsd: 25_000,
      minHolderCount: 200,
      minAgeMinutes: 30,
      maxAgeHours: null,
      maxTop10HolderPct: 40,
      maxBuyTaxPct: 5,
      requireMintRevoked: true,
      requireFreezeRevoked: true,
      blocklist: [],
    },
    risk: {
      maxTradeUsd: 2,
      maxDailyTrades: 1,
      maxPositionPct: 10,
      maxDataSpendUsdPerRun: 0.25,
      stopLossPct: 25,
      takeProfitPct: null,
      slippageBps: 100,
      trailingStopPct: null,
      maxHoldHours: null,
      exitScoreBelow: null,
      exitOnLiquidityDropPct: null,
      ...overrides,
    },
    execution: { mode: "auto", proposalTtlMinutes: 30 },
    schedule: { intervalMinutes: 60 },
    llm: { provider: "anthropic", model: "claude-sonnet-5", temperature: 0.2, maxSteps: 12 },
  };
}

describe("evaluateFirstTradeRisk", () => {
  it("passes the intended first-trade shape", () => {
    expect(evaluateFirstTradeRisk(config(), 2)).toEqual({ ok: true, problems: [], cautions: [] });
  });

  it("allows more than one chain, with a caution", () => {
    const verdict = evaluateFirstTradeRisk(config({}, ["base", "solana"]), 2);
    expect(verdict.ok).toBe(true);
    expect(verdict.cautions.join(" ")).toMatch(/2 chains/);
  });

  it("refuses no chain at all", () => {
    expect(evaluateFirstTradeRisk(config({}, []), 2).ok).toBe(false);
  });

  /** The cap the operator typed is the ceiling, even when it is below the preset. */
  it("refuses a config whose per-trade cap exceeds what the operator typed", () => {
    const verdict = evaluateFirstTradeRisk(config({ maxTradeUsd: 2 }), 1);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/cap of \$1/);
  });

  /** The $2 preset is advice; the cap the operator typed is the rule. */
  it("allows a per-trade size above the preset when it is within the operator's cap, with a caution", () => {
    const verdict = evaluateFirstTradeRisk(config({ maxTradeUsd: 50 }), 100);
    expect(verdict.ok).toBe(true);
    expect(verdict.cautions.join(" ")).toMatch(/\$50/);
  });

  it("allows more than one trade a day, with a caution", () => {
    const verdict = evaluateFirstTradeRisk(config({ maxDailyTrades: 5 }), 2);
    expect(verdict.ok).toBe(true);
    expect(verdict.cautions.join(" ")).toMatch(/trades a day/);
  });

  /** Without any exit rule the exit engine has nothing to enforce. */
  it("refuses a config with no exit rule at all", () => {
    const verdict = evaluateFirstTradeRisk(
      config({ stopLossPct: null, takeProfitPct: null, trailingStopPct: null }),
      2,
    );
    expect(verdict.problems.join(" ")).toMatch(/no stop loss/);
  });

  it("accepts a trailing stop alone as the exit rule", () => {
    const verdict = evaluateFirstTradeRisk(
      config({ stopLossPct: null, takeProfitPct: null, trailingStopPct: 15 }),
      2,
    );
    expect(verdict.ok).toBe(true);
  });

  it("refuses a zero or negative cap", () => {
    expect(evaluateFirstTradeRisk(config(), 0).ok).toBe(false);
  });

  it("writes money as money, not as a raw number", () => {
    const verdict = evaluateFirstTradeRisk(config({ maxTradeUsd: 3200 }), 2.5);
    expect(verdict.problems.join(" ")).toContain("its max per trade is $3,200.00 but you asked for a cap of $2.50");
  });
});

describe("withFirstTradePreset", () => {
  it("clamps an aggressive config into the first-trade shape", () => {
    const before = config({ maxTradeUsd: 500, maxDailyTrades: 20, maxPositionPct: 80 }, ["solana", "base"]);
    const after = withFirstTradePreset(before);

    expect(after.chains).toEqual(["solana"]);
    expect(after.risk.maxTradeUsd).toBe(FIRST_TRADE_PRESET.maxTradeUsd);
    expect(after.risk.maxDailyTrades).toBe(FIRST_TRADE_PRESET.maxDailyTrades);
    expect(evaluateFirstTradeRisk(after, FIRST_TRADE_PRESET.maxTradeUsd).ok).toBe(true);
  });

  /**
   * The preset used to clamp this to 10, which made every buy fail at the size it
   * recommends: $2 of a $10 wallet is 20%. It is the operator's call and it is not a
   * first-trade question; `simulateFirstTrade` is what catches an unworkable pair now.
   */
  it("leaves position sizing to the operator", () => {
    expect(withFirstTradePreset(config({ maxPositionPct: 80 })).risk.maxPositionPct).toBe(80);
    expect(withFirstTradePreset(config({ maxPositionPct: 25 })).risk.maxPositionPct).toBe(25);
  });

  it("never loosens a config that is already tighter than the preset", () => {
    const before = config({ maxTradeUsd: 1, maxDailyTrades: 1, maxPositionPct: 5 });
    const after = withFirstTradePreset(before);
    expect(after.risk.maxTradeUsd).toBe(1);
    expect(after.risk.maxPositionPct).toBe(5);
  });

  it("gives a config with no floor under it a stop loss", () => {
    const after = withFirstTradePreset(config({ stopLossPct: null }));
    expect(after.risk.stopLossPct).toBe(25);
  });

  it("leaves an existing stop loss alone and changes nothing else", () => {
    const before = config({ stopLossPct: 12 });
    const after = withFirstTradePreset(before);
    expect(after.risk.stopLossPct).toBe(12);
    expect(after.strategyPrompt).toBe(before.strategyPrompt);
    expect(after.universe).toEqual(before.universe);
    expect(after.llm).toEqual(before.llm);
  });

  /**
   * An agent that pays for its own thinking pays from its Solana wallet. A Base agent
   * whose owner added Solana to use pay-per-use has it second, and "keep the first chain"
   * took it away: a config the server refuses on every other save, which then blocked
   * every later save of the agent's settings.
   */
  describe("for an agent that pays per use", () => {
    const paying = (chains: AgentConfig["chains"]): AgentConfig => {
      const base = config({ maxTradeUsd: 500, maxDailyTrades: 20 }, chains);
      return { ...base, llm: { ...base.llm, source: "usdc", usdc: { model: "google/gemini-2.5-flash", maxUsdPerRun: 0.3, maxUsdPerDay: 3 } } };
    };

    it("keeps Solana, the chain that pays, wherever it sits in the list", () => {
      for (const chains of [["base", "solana"], ["solana", "base"]] as Array<AgentConfig["chains"]>) {
        const before = paying(chains);
        expect(usdcChoiceProblem(before)).toBeNull();
        const after = withFirstTradePreset(before);
        expect(after.chains).toEqual(["solana"]);
        // What the preset writes is a config every other save would accept.
        expect(usdcChoiceProblem(after)).toBeNull();
        expect(after.llm).toEqual(before.llm);
        expect(after.risk.maxTradeUsd).toBe(FIRST_TRADE_PRESET.maxTradeUsd);
      }
    });

    it("leaves a Solana-only one as it is, and does not invent Solana for one that never had it", () => {
      expect(withFirstTradePreset(paying(["solana"])).chains).toEqual(["solana"]);
      // Already a config the settings form refuses; the preset does not make it look sound.
      expect(withFirstTradePreset(paying(["base"])).chains).toEqual(["base"]);
    });

    it("names that chain, so the screen that says which one is kept says the same", () => {
      expect(firstTradeChain(paying(["base", "solana"]))).toBe("solana");
      expect(firstTradeChain(paying(["solana", "base"]))).toBe("solana");
      expect(firstTradeChain(paying(["base"]))).toBe("base");
    });
  });

  it("still keeps a key agent's first chain, whichever that is", () => {
    expect(withFirstTradePreset(config({}, ["base", "solana"])).chains).toEqual(["base"]);
    expect(withFirstTradePreset(config({}, ["solana", "base"])).chains).toEqual(["solana"]);
    expect(firstTradeChain(config({}, ["base", "solana"]))).toBe("base");
    expect(firstTradeChain(config({}, []))).toBeNull();
    // Old pay-per-use limits left in a key agent's config change nothing.
    const back = config({}, ["base", "solana"]);
    const withOldLimits: AgentConfig = { ...back, llm: { ...back.llm, source: "key", usdc: { model: "google/gemini-2.5-flash", maxUsdPerRun: 0.3, maxUsdPerDay: 3 } } };
    expect(withFirstTradePreset(withOldLimits).chains).toEqual(["base"]);
  });
});

/**
 * The check that replaced the `maxPositionPct` clamp. Every case here is a config the
 * old checklist called green while `place_trade` was going to refuse it.
 */
describe("simulateFirstTrade", () => {
  beforeEach(() => {
    // The fee is capitalised into the buy, so it decides whether a ticket the exact size
    // of the balance clears. Pin it rather than inheriting whatever the environment says.
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
  });
  afterEach(() => vi.unstubAllEnvs());

  /** The operator's exact scenario: $10 deposited, the $2 preset, the default 25% cap. */
  it("passes the $2 preset against the $10 the wizard tells you to deposit", async () => {
    const preset = withFirstTradePreset(config({ maxTradeUsd: 100, maxPositionPct: 25 }, ["solana"]));
    expect(await simulateFirstTrade(preset, 10)).toBeNull();
  });

  /** The bug this exists to catch: 2/10 = 20%, above a 10% cap. Rejected, silently, forever. */
  it("catches a position cap the funded balance cannot satisfy, in the guard's own words", async () => {
    const refusal = await simulateFirstTrade(config({ maxTradeUsd: 2, maxPositionPct: 10 }, ["solana"]), 10);
    expect(refusal).toMatch(/20\.0% of equity, above maxPositionPct 10%/);
    // And it says what it simulated, so the number is arguable rather than mysterious.
    expect(refusal).toMatch(/\$2\.00 buy against the \$10\.00/);
  });

  it("is happy with the same cap once the wallet is big enough for it", async () => {
    expect(await simulateFirstTrade(config({ maxTradeUsd: 2, maxPositionPct: 10 }, ["solana"]), 25)).toBeNull();
  });

  /** The platform fee is capitalised into the buy, so cash has to cover both. */
  it("catches a ticket that leaves nothing for the platform fee, and says the fee on that ticket", async () => {
    const agent = config({ maxTradeUsd: 2, maxPositionPct: 100 }, ["solana"]);
    expect(await simulateFirstTrade(agent, 2)).toBe(
      "A $2.00 buy against the $2.00 this agent holds (plus the 0.5% Tocker fee, $0.01) would be refused by the risk guard: " +
        "Insufficient cash: $2.00 available, $2.00 requested plus the $0.01 Tocker fee (0.5% of the fill). The most this cash covers is a $1.99 buy.",
    );
    // The ticket and its one cent of fee, to the cent: a buy that empties the wallet exactly.
    expect(await simulateFirstTrade(agent, 2.01)).toBeNull();
  });

  it("works the fee out from the ticket being simulated, not from a figure per fill", async () => {
    // 0.5% of a $100 ticket is fifty cents, so $100.49 is short and $100.50 is enough.
    const agent = config({ maxTradeUsd: 100, maxPositionPct: 100 }, ["solana"]);
    expect(await simulateFirstTrade(agent, 100.5)).toBeNull();
    const refusal = await simulateFirstTrade(agent, 100.49);
    expect(refusal).toContain("(plus the 0.5% Tocker fee, $0.50)");
    expect(refusal).toContain("$100.49 available, $100.00 requested plus the $0.50 Tocker fee (0.5% of the fill).");
  });

  it("asks for the ticket alone, and names no fee, when the fee is off", async () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "0");
    const agent = config({ maxTradeUsd: 2, maxPositionPct: 100 }, ["solana"]);
    expect(await simulateFirstTrade(agent, 2)).toBeNull();
    expect(await simulateFirstTrade(agent, 1.99)).toBe(
      "A $2.00 buy against the $1.99 this agent holds would be refused by the risk guard: Insufficient cash: $1.99 available, $2.00 requested.",
    );
  });

  it("names the chain the agent actually trades, not a default", async () => {
    // A guard refusal for a chain the agent has enabled can never be a chain mismatch.
    expect(await simulateFirstTrade(config({ maxPositionPct: 100 }, ["base"]), 10)).toBeNull();
    expect(await simulateFirstTrade(config({ maxPositionPct: 100 }, ["solana"]), 10)).toBeNull();
  });

  /**
   * An agent that pays for its own thinking keeps two runs' worth of it, and the wallet
   * floor, out of its trades. The checklist has to simulate against what is left, or it
   * says green over a wallet whose first buy the guard will refuse.
   */
  describe("for an agent that pays per use", () => {
    const paying = (maxUsdPerRun: number, risk: Partial<AgentConfig["risk"]> = {}): AgentConfig => {
      const base = config({ maxTradeUsd: 2, maxPositionPct: 100, ...risk }, ["solana"]);
      return { ...base, llm: { ...base.llm, source: "usdc", usdc: { model: "google/gemini-2.5-flash", maxUsdPerRun, maxUsdPerDay: 3 } } };
    };

    it("refuses a wallet that covers the ticket but not the ticket and the thinking, and says why", async () => {
      // $2.50 covers a $2.00 buy and its $0.01 fee. Not once $0.85 is kept back.
      expect(await simulateFirstTrade(config({ maxTradeUsd: 2, maxPositionPct: 100 }, ["solana"]), 2.5)).toBeNull();
      const refusal = await simulateFirstTrade(paying(0.3), 2.5);
      expect(refusal).toMatch(/Insufficient cash/);
      expect(refusal).toMatch(/\$0\.85 is kept back to pay for its own thinking/);
    });

    it("passes once the wallet covers both", async () => {
      // The ticket, its fee, and two runs and the floor: 2.00 + 0.01 + 0.85, and 2.00 + 0.01 + 4.25.
      expect(await simulateFirstTrade(paying(0.3), 2.86)).toBeNull();
      expect(await simulateFirstTrade(paying(0.3), 2.85)).toMatch(/Insufficient cash/);
      expect(await simulateFirstTrade(paying(2), 6.26)).toBeNull();
      expect(await simulateFirstTrade(paying(2), 6.25)).toMatch(/Insufficient cash/);
    });

    /** The checklist and the live book must hold back one and the same figure. */
    it("holds back exactly what the live book does: the one function's figure", async () => {
      for (const maxUsdPerRun of [0.05, 0.3, 1, 2]) {
        const agent = paying(maxUsdPerRun);
        const needed = 2 + 0.01 + thinkingReserveUsd(agent);
        expect(await simulateFirstTrade(agent, needed)).toBeNull();
        expect(await simulateFirstTrade(agent, needed - 0.01)).toMatch(/Insufficient cash/);
      }
    });

    it("still measures concentration against the whole wallet: the money kept back is the agent's", async () => {
      // $2 of $10 is 20% of equity whichever way the agent thinks.
      expect(await simulateFirstTrade(paying(0.3, { maxPositionPct: 20 }), 10)).toBeNull();
      expect(await simulateFirstTrade(paying(0.3, { maxPositionPct: 19 }), 10)).toMatch(/above maxPositionPct 19%/);
    });

    it("changes nothing for an agent on a key, whose config may still carry old limits", async () => {
      const back = paying(2);
      expect(await simulateFirstTrade({ ...back, llm: { ...back.llm, source: "key" } }, 2.5)).toBeNull();
    });
  });
});

/**
 * The wallet-level budget is optional for an agent that thinks on a key. For one that
 * pays for its own thinking it is not: a run of such an agent is not started while its
 * Solana wallet has no policy, so going live without one is going live with an agent that
 * never thinks.
 */
describe("checkBudget", () => {
  const slug = "a";
  const key = config({ maxTradeUsd: 2 }, ["solana"]);
  const paying: AgentConfig = { ...key, llm: { ...key.llm, source: "usdc", usdc: { model: "google/gemini-2.5-flash", maxUsdPerRun: 0.3, maxUsdPerDay: 3 } } };

  it("only warns a key agent about a missing wallet budget, as before", () => {
    expect(checkBudget(key, null, 2, slug).state).toBe("warn");
    expect(checkBudget(key, { perTxUsd: 2, policyIds: {} }, 2, slug).state).toBe("pass");
    expect(checkBudget(key, { perTxUsd: 50, policyIds: { solana: "pol_1" } }, 2, slug).state).toBe("warn");
  });

  it("fails an agent that pays per use until its Solana wallet has a policy", () => {
    const none = checkBudget(paying, null, 2, slug);
    expect(none.state).toBe("fail");
    expect(none.detail).toMatch(/pays for its own thinking/);
    expect(none.fix?.href).toBe("/agents/a/settings?step=manage#budget");
    // A policy on Base is not one on the wallet that pays.
    expect(checkBudget(paying, { perTxUsd: 2, policyIds: { base: "pol_b" } }, 2, slug).state).toBe("fail");
    expect(checkBudget(paying, { perTxUsd: 2, policyIds: { solana: "pol_s" } }, 2, slug).state).toBe("pass");
  });

  it("still names the per-trade cap first when that is what is wrong", () => {
    const over = checkBudget({ ...paying, risk: { ...paying.risk, maxTradeUsd: 9 } }, null, 2, slug);
    expect(over.state).toBe("fail");
    expect(over.detail).toMatch(/above the \$2\.00 you entered/);
    expect(over.fix?.href).toBe("/agents/a/settings?step=limits#risk");
  });
});

/**
 * Which platform wallets a source list spends from. The readiness checklist and the
 * Platform card both hang off this, and it is the thing that was hard-coded to Base.
 */
describe("dataChainsFor", () => {
  it("returns Solana for a Solana-priced source", () => {
    expect(dataChainsFor(["deepnets-token-safety"])).toEqual(["solana"]);
    // SolEnrich accepts Base too; for a Solana agent only the Solana wallet has to be funded.
    expect(dataChainsFor(["solenrich-launches"], ["solana"])).toEqual(["solana"]);
    expect(dataChainsFor(["solenrich-launches"])).toEqual(["base", "solana"]);
  });

  it("returns Base for a Base-priced source", () => {
    expect(dataChainsFor(["x-search"])).toEqual(["base"]);
    // Nansen accepts Solana too; a Base agent pays it on Base.
    expect(dataChainsFor(["cmc-quotes", "nansen-smart-money"], ["base"])).toEqual(["base"]);
  });

  /** The default list: this is the pair the operator has to fund, and it is not just Base. */
  it("returns both for the default source list", () => {
    expect(dataChainsFor(DEFAULT_AGENT_CONFIG.dataSources)).toEqual(["base", "solana"]);
  });

  it("drops ids that are not in the registry any more", () => {
    expect(dataChainsFor(["token-intel-sol", "rugmunch", "xquik-search"])).toEqual([]);
    expect(dataChainsFor(["x-search", "token-intel-sol"])).toEqual(["base"]);
  });

  it("is empty for an agent that buys no data", () => {
    expect(dataChainsFor([])).toEqual([]);
  });
});

describe("checkDataSources", () => {
  const withSources = (dataSources: string[]): AgentConfig => ({ ...config(), dataSources });
  const check = (dataSources: string[]) => checkDataSources(withSources(dataSources), "a", false);

  beforeEach(() => {
    vi.stubEnv("X402_MOCK", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes on registry sources and counts only those", () => {
    const step = check(["x-search", "cmc-quotes"]);
    expect(step.state).toBe("pass");
    expect(step.detail).toContain("2 registered sources");
  });

  it("does not hold a retired id against an agent that still has it saved", () => {
    // It buys nothing and the picker cannot untick it, so it must not block going live.
    const alongside = check(["bazaar", "x-search"]);
    expect(alongside.state).toBe("pass");
    expect(alongside.detail).toContain("1 registered source ");
    expect(check(["bazaar"]).state).toBe("warn");
  });

  it("still fails on an id that was never retired on purpose", () => {
    const step = check(["x-search", "made-up-source"]);
    expect(step.state).toBe("fail");
    expect(step.detail).toContain("made-up-source");
    expect(step.fix?.href).toBe("/agents/a/settings?step=data#data");
  });
});

describe("databaseStep", () => {
  const LEAK = "connect ECONNREFUSED db.internal:5432 (postgres://tocker:hunter2@db.internal/tocker)";
  const step = (overrides: Partial<DatabaseStepInput>) =>
    databaseStep({ embedded: false, production: true, error: null, viewerIsAdmin: false, ...overrides });

  it("passes a real database for everyone, with nothing to fix", () => {
    for (const viewerIsAdmin of [false, true]) {
      const out = step({ viewerIsAdmin });
      expect(out.state).toBe("pass");
      expect(out.fix).toBeNull();
    }
  });

  it("never shows an owner the driver's words, the engine or the health endpoint", () => {
    const cases: Array<Partial<DatabaseStepInput>> = [
      { error: LEAK },
      { embedded: true, production: true },
      { embedded: true, production: false },
    ];
    for (const c of cases) {
      const out = step(c);
      expect(out.detail).not.toContain("hunter2");
      expect(out.detail).not.toContain("db.internal");
      expect(out.detail).not.toMatch(/PGlite|health/i);
      expect(out.fix).toBeNull();
    }
    expect(step({ error: LEAK }).state).toBe("fail");
    expect(step({ embedded: true, production: true }).state).toBe("fail");
    expect(step({ embedded: true, production: false }).state).toBe("warn");
  });

  it("gives an admin the diagnosis and the link", () => {
    const failed = step({ error: LEAK, viewerIsAdmin: true });
    expect(failed.detail).toContain("ECONNREFUSED");
    expect(failed.fix?.href).toBe("/api/health");
    expect(step({ embedded: true, production: false, viewerIsAdmin: true }).detail).toContain("PGlite");
  });
});

/**
 * The row that says, before the hold, what `goLiveAction` would refuse on. The count
 * itself is tested against a database in `paper-positions.test.ts`.
 */
describe("paperPositionsStep", () => {
  const step = (symbols: Array<string | null> | null, live = false) =>
    paperPositionsStep({ slug: "momentum-mike", live, symbols });

  it("passes with nothing to fix when no simulated position is open", () => {
    const out = step([]);
    expect(out.id).toBe("paperPositions");
    expect(out.title).toBe("No paper positions open");
    expect(out.state).toBe("pass");
    expect(out.fix).toBeNull();
  });

  it("fails while paper positions are open, names them, and links to where they are sold", () => {
    const out = step(["WIF", "JUP", "BONK"]);
    expect(out.state).toBe("fail");
    expect(out.detail).toContain("3 paper positions are still open (WIF, JUP, BONK).");
    expect(out.detail).toContain("They are simulated");
    expect(out.fix).toEqual({ label: "Sell them on the agent page", href: "/agents/momentum-mike#positions" });
  });

  it("speaks in the singular for one position", () => {
    const out = step(["WIF"]);
    expect(out.detail).toContain("1 paper position is still open (WIF). It is simulated");
    expect(out.fix?.label).toBe("Sell it on the agent page");
  });

  it("names three and counts the rest, and still counts a token with no symbol", () => {
    const out = step(["A", "B", "C", "D", null]);
    expect(out.detail).toContain("5 paper positions are still open (A, B, C and 2 more).");
    expect(step([null]).detail).toContain("1 paper position is still open. It is simulated");
  });

  it("keeps a creator-chosen symbol short", () => {
    expect(step(["  " + "X".repeat(80)]).detail).toContain(`(${"X".repeat(12)})`);
  });

  /** "Could not tell" is red on this screen, never green. */
  it("fails when the book could not be read", () => {
    const out = step(null);
    expect(out.state).toBe("fail");
    expect(out.detail).toMatch(/could not read/i);
  });

  it("has nothing to guard once the agent is live", () => {
    const out = step([], true);
    expect(out.state).toBe("pass");
    expect(out.fix).toBeNull();
  });
});
