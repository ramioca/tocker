/**
 * The sentences and figures the builder quotes about a draft, decided without a browser.
 *
 * The first block is the proof that moving the card summaries out of `agent-builder.tsx`
 * changed nothing: each string is what the page showed for a fresh draft before the move,
 * character for character, "≈", "·" and "—" included.
 */
import { describe, expect, it } from "vitest";
import { chooseSource, usdcEstimate, walletNeedUsd } from "@/components/agents/thinking";
import { formatUsd } from "@/components/common/format";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { getDataSource } from "@/lib/data-sources/registry";
import type { DataSourceInfo } from "@/server/types";
import { REQUIRED_ORDER, REQUIRED_PLACE, ROW_PLACE, type SummaryEdit, type SummaryLabels } from "./contract";
import {
  commitShortLine,
  costFacts,
  costLines,
  dataSummary,
  executionLabel,
  exitSummary,
  fundingSummary,
  paperLabel,
  previewRows,
  readyItems,
  riskSummary,
  runLine,
  scheduleSummary,
  stillNeeded,
  strategyLabel,
  thinkSummary,
  skipWhenFullHint,
} from "./summaries";
import { STRATEGY_PRESETS, emptyDraft, onProvider, type BuilderDraft } from "./types";
import { universeSummary } from "./universe-copy";
import { validateDraft } from "./validate";

// The two labels live in `.tsx` files (`intervalLabel`, `ttlLabel`), which a node test
// cannot load. These are the same rules, written out.
const labels: SummaryLabels = {
  interval: (minutes) => {
    if (minutes === 0) return "Manual only";
    if (minutes < 60) return `Every ${minutes} min`;
    if (minutes % 1440 === 0) return `Every ${minutes / 1440}d`;
    if (minutes % 60 === 0) return `Every ${minutes / 60}h`;
    return `Every ${minutes} min`;
  },
  ttl: (minutes) => (minutes < 60 || minutes % 60 !== 0 ? `${minutes} min` : `${minutes / 60} h`),
};

/** The three default sources, a cent a call each. */
const sources = DEFAULT_AGENT_CONFIG.dataSources.map((id) => ({ id, priceUsd: 0.01 }) as DataSourceInfo);

/** The rate the product charges by default, in basis points: 0.5% of each fill. */
const FEE = 50;
const opts = { payPerUseAllowed: false, feeBps: FEE };
const usdcOpts = { payPerUseAllowed: true, feeBps: FEE };

const anthropic = { id: "key_a", provider: "anthropic" as const };
const openai = { id: "key_oa", provider: "openai" as const };

function draftWith(change: (draft: BuilderDraft) => void = () => {}): BuilderDraft {
  const draft = emptyDraft();
  change(draft);
  return draft;
}

function payPerUse(change: (draft: BuilderDraft) => void = () => {}): BuilderDraft {
  const draft = emptyDraft();
  draft.config = chooseSource(draft.config, "usdc").config;
  change(draft);
  return draft;
}

function funded(goLive: boolean): BuilderDraft {
  return draftWith((draft) => {
    draft.funding = { ...draft.funding, mode: "fund", amountUsd: 25 };
    draft.goLive = goLive;
  });
}

describe("a fresh draft reads as the page read before the move", () => {
  const draft = emptyDraft();
  const facts = costFacts(draft, sources, opts);

  it("Data it buys", () => {
    expect(dataSummary(facts)).toBe("3 paid sources + launch radar · ≈$0.05 per run, paid by Tocker");
  });

  it("Risk limits", () => {
    expect(riskSummary(draft.config.risk, FEE)).toBe(
      "$100.00/trade · 10/day · 25% max position · $1.00 data/run · Tocker fee 0.5% of each fill",
    );
  });

  it("Funding", () => {
    expect(fundingSummary(draft, facts)).toBe("Paper only — its wallets are created empty, fund it whenever you like");
  });

  it("Schedule & mode", () => {
    expect(scheduleSummary(draft, facts, labels)).toBe(
      "Every 15 min · asks before each trade (1 h to decide) · starts active · $10K paper",
    );
  });

  it("the phone bar's one line", () => {
    expect(commitShortLine(draft, facts)).toBe("~96 runs/day on your key");
  });
});

describe("dataSummary", () => {
  it("says what is still bought when nothing is chosen and the radar is off", () => {
    const draft = draftWith((d) => {
      d.config.dataSources = [];
      d.config.universe.discovery = ["trending"];
    });
    expect(dataSummary(costFacts(draft, sources, opts))).toBe(
      "No paid sources. Each sweep still buys the launch radar (about $0.02 a chain), paid by Tocker.",
    );
  });

  it("counts one source in the singular", () => {
    const draft = draftWith((d) => {
      d.config.dataSources = ["x-search"];
    });
    expect(dataSummary(costFacts(draft, sources, opts))).toBe(
      "1 paid source + launch radar · ≈$0.03 per run, paid by Tocker",
    );
  });

  it("leaves the radar out when the feed is off", () => {
    const draft = draftWith((d) => {
      d.config.universe.discovery = ["trending"];
    });
    expect(dataSummary(costFacts(draft, sources, opts))).toBe("3 paid sources · ≈$0.03 per run, paid by Tocker");
  });
});

describe("riskSummary", () => {
  it("has no fee part when the fee is off", () => {
    expect(riskSummary(emptyDraft().config.risk, 0)).toBe(
      "$100.00/trade · 10/day · 25% max position · $1.00 data/run",
    );
  });

  it("states the fee as the rate it is handed, the same on any ticket", () => {
    const risk = emptyDraft().config.risk;
    expect(riskSummary(risk, 25)).toMatch(/ · Tocker fee 0\.25% of each fill$/);
    expect(riskSummary(risk, 100)).toMatch(/ · Tocker fee 1% of each fill$/);
    expect(riskSummary({ ...risk, maxTradeUsd: 2 }, FEE)).toBe(
      "$2.00/trade · 10/day · 25% max position · $1.00 data/run · Tocker fee 0.5% of each fill",
    );
  });
});

describe("riskSummary: the position limit and the cash reserve", () => {
  const risk = emptyDraft().config.risk;

  it("names each one only when it is set, after the caps and before the fee", () => {
    expect(riskSummary({ ...risk, maxOpenPositions: 3, cashReserveUsd: 5 }, FEE)).toBe(
      "$100.00/trade · 10/day · 25% max position · $1.00 data/run · max 3 positions · $5.00 cash reserve · Tocker fee 0.5% of each fill",
    );
    expect(riskSummary({ ...risk, maxOpenPositions: 1 }, 0)).toBe(
      "$100.00/trade · 10/day · 25% max position · $1.00 data/run · max 1 position",
    );
    expect(riskSummary({ ...risk, cashReserveUsd: 12.5 }, 0)).toBe(
      "$100.00/trade · 10/day · 25% max position · $1.00 data/run · $12.50 cash reserve",
    );
  });

  it("says nothing of either while they are off, written out or absent", () => {
    const plain = "$100.00/trade · 10/day · 25% max position · $1.00 data/run";
    expect(riskSummary({ ...risk, maxOpenPositions: null, cashReserveUsd: 0 }, 0)).toBe(plain);
    const old = { ...risk };
    delete old.maxOpenPositions;
    delete old.cashReserveUsd;
    expect(riskSummary(old, 0)).toBe(plain);
  });

  it("is the line on the agent card as well", () => {
    const draft = emptyDraft();
    draft.config.risk = { ...draft.config.risk, maxOpenPositions: 3, cashReserveUsd: 5 };
    const rows = previewRows(draft, costFacts(draft, sources, opts), validateDraft(draft, []), {
      hunts: "anything",
      labels,
      payPerUseAllowed: false,
    });
    expect(rows.find((row) => row.id === "limits")?.text).toBe(riskSummary(draft.config.risk, FEE));
    expect(rows.find((row) => row.id === "limits")?.text).toContain("max 3 positions · $5.00 cash reserve");
  });
});

/**
 * The switch's sentence promises that the automatic exits still fire. That is only so
 * while one of them is on, so with all of them off it says what happens instead.
 */
describe("skipWhenFullHint", () => {
  const config = emptyDraft().config;
  const noExits = {
    ...config.risk,
    stopLossPct: null,
    takeProfitPct: null,
    trailingStopPct: null,
    maxHoldHours: null,
    exitScoreBelow: null,
    exitOnLiquidityDropPct: null,
  };

  it("says what is and is not skipped, for an agent with an exit rule on", () => {
    expect(skipWhenFullHint(config)).toBe(
      "When it is at its position limit, has no cash for its smallest order after the reserve, or has used the day's buys, a scheduled run is not started: it does not think, buys no data and does not review its positions. Stop loss, take profit and the other automatic exits still fire on their own, and Run now always runs.",
    );
    // One rule is enough for the promise to hold.
    expect(skipWhenFullHint({ ...config, risk: { ...noExits, maxHoldHours: 24 } })).toContain("automatic exits still fire");
  });

  it("does not promise exits to an agent with every exit rule off, and says its runs go on while it holds a position", () => {
    const hint = skipWhenFullHint({ ...config, risk: noExits });
    expect(hint).toBe(
      "When it is at its position limit, has no cash for its smallest order after the reserve, or has used the day's buys, a scheduled run is not started: it does not think and buys no data. Every exit rule is off, so only a run can sell: while it holds a position its runs are not skipped. Run now always runs.",
    );
    expect(hint).not.toContain("still fire");
  });

  it("says a manual schedule has nothing to skip, whatever the exit rules", () => {
    const manual = "With a manual schedule there is no scheduled run to skip. Run now always runs.";
    expect(skipWhenFullHint({ ...config, schedule: { intervalMinutes: 0, skipWhenFull: true } })).toBe(manual);
    expect(skipWhenFullHint({ risk: noExits, schedule: { intervalMinutes: 0 } })).toBe(manual);
  });
});

describe("fundingSummary and scheduleSummary", () => {
  it("fund mode, headed for the live checklist", () => {
    const draft = funded(true);
    const facts = costFacts(draft, sources, opts);
    expect(fundingSummary(draft, facts)).toBe("$25.00 USDC, signed by you on create");
    expect(scheduleSummary(draft, facts, labels)).toBe(
      "Every 15 min · asks before each trade (1 h to decide) · real money only, live after the checklist",
    );
  });

  it("fund mode, staying on paper", () => {
    const draft = funded(false);
    const facts = costFacts(draft, sources, opts);
    expect(fundingSummary(draft, facts)).toBe("$25.00 USDC, signed by you on create");
    expect(scheduleSummary(draft, facts, labels)).toBe(
      "Every 15 min · asks before each trade (1 h to decide) · paper on the funded amount until you go live",
    );
  });

  it("pay per use on paper names what the wallet must hold before it can think", () => {
    const draft = payPerUse();
    const facts = costFacts(draft, sources, usdcOpts);
    const need = walletNeedUsd(draft.config.llm.usdc!);
    expect(fundingSummary(draft, facts)).toBe(
      `Paper only. Its wallets are created empty, and it cannot think until its Solana wallet holds ${formatUsd(need)} of USDC`,
    );
  });

  it("a paused start and a trade-on-its-own agent", () => {
    const draft = draftWith((d) => {
      d.activate = false;
      d.paperStartingUsd = 500;
      d.config.execution = { mode: "auto", proposalTtlMinutes: 60 };
      d.config.schedule = { intervalMinutes: 60 };
    });
    expect(scheduleSummary(draft, costFacts(draft, sources, opts), labels)).toBe(
      "Every 1h · trades on its own · starts paused · $500.00 paper",
    );
  });

  it("the two labels the schedule line is made of", () => {
    expect(executionLabel({ mode: "approve", proposalTtlMinutes: 5 }, labels)).toBe(
      "asks before each trade (5 min to decide)",
    );
    expect(executionLabel({ mode: "auto", proposalTtlMinutes: 60 }, labels)).toBe("trades on its own");
    expect(paperLabel(1_000)).toBe("$1K");
    expect(paperLabel(100_000)).toBe("$100K");
    expect(paperLabel(500)).toBe("$500.00");
    // Not a whole number of thousands: the full amount, never "$12.345K".
    expect(paperLabel(12_345)).toBe("$12,345.00");
    expect(paperLabel(1_500)).toBe("$1,500.00");
  });
});

describe("costFacts", () => {
  it("never shows more data cost than the cap", () => {
    const draft = draftWith((d) => {
      d.config.risk.maxDataSpendUsdPerRun = 0.02;
    });
    const facts = costFacts(draft, sources, opts);
    expect(facts.sourcesPerRun + facts.radarPerRun).toBeGreaterThan(0.02);
    expect(facts.costPerRun).toBe(0.02);
    expect(facts.dataCapUsd).toBe(0.02);
  });

  it("counts no runs on a manual schedule", () => {
    const draft = draftWith((d) => {
      d.config.schedule = { intervalMinutes: 0 };
    });
    expect(costFacts(draft, sources, opts).runsPerDay).toBe(0);
    expect(costFacts(emptyDraft(), sources, opts).runsPerDay).toBe(96);
  });

  it("adds two cents a chain for the radar, and only when the feed is on", () => {
    const one = costFacts(emptyDraft(), sources, opts);
    expect(one.radarPerRun).toBeCloseTo(0.02);
    const two = costFacts(
      draftWith((d) => {
        d.config.chains = ["solana", "base"];
      }),
      sources,
      opts,
    );
    expect(two.radarPerRun).toBeCloseTo(0.04);
    const off = costFacts(
      draftWith((d) => {
        d.config.chains = ["solana", "base"];
        d.config.universe.discovery = ["trending"];
      }),
      sources,
      opts,
    );
    expect(off.radarPerRun).toBe(0);
  });

  /**
   * The smart money board is a feed that buys from a source. It is in the estimate only
   * when both are on, which is the rule a sweep buys it under; the source alone is the
   * per-token read, quoted at the registry's price like any other source.
   */
  it("adds five cents a chain for the smart money board, and only when the feed and the source are both on", () => {
    const nansen = { id: "nansen-smart-money", priceUsd: getDataSource("nansen-smart-money")?.priceUsd } as DataSourceInfo;
    expect(nansen.priceUsd).toBe(0.01);
    const priced = [...sources, nansen];
    const withBoard = (dataSources: string[], discovery: BuilderDraft["config"]["universe"]["discovery"], chains: Array<"solana" | "base"> = ["solana"]) =>
      costFacts(
        draftWith((d) => {
          d.config.dataSources = dataSources;
          d.config.universe.discovery = discovery;
          d.config.chains = chains;
        }),
        priced,
        opts,
      );

    // Neither, which is every default: nothing.
    expect(costFacts(emptyDraft(), priced, opts).boardPerRun).toBe(0);
    // The source alone: one cent for the per-token read, and no board.
    const sourceOnly = withBoard(["nansen-smart-money"], ["trending"]);
    expect(sourceOnly).toMatchObject({ chosenCount: 1, boardPerRun: 0 });
    expect(sourceOnly.sourcesPerRun).toBeCloseTo(0.01);
    expect(dataSummary(sourceOnly)).toBe("1 paid source · ≈$0.01 per run, paid by Tocker");
    // The feed alone buys nothing, so it costs nothing.
    expect(withBoard(["x-search"], ["trending", "smart_money"]).boardPerRun).toBe(0);

    const both = withBoard(["nansen-smart-money"], ["trending", "smart_money"]);
    expect(both.boardPerRun).toBeCloseTo(0.05);
    expect(both.costPerRun).toBeCloseTo(0.06);
    expect(dataSummary(both)).toBe("1 paid source + smart money board · ≈$0.06 per run, paid by Tocker");
    expect(costLines(draftWith(), both)).toContainEqual({ id: "data", label: "Data", text: "≈$0.06 a run, capped at $1.00 · Tocker pays" });

    const twoChains = withBoard(["nansen-smart-money"], ["paid_launches", "smart_money"], ["solana", "base"]);
    expect(twoChains.boardPerRun).toBeCloseTo(0.1);
    expect(twoChains.radarPerRun).toBeCloseTo(0.04);
    expect(dataSummary(twoChains)).toBe("1 paid source + launch radar + smart money board · ≈$0.15 per run, paid by Tocker");
  });

  it("prices a source with no listed price at a cent, and ignores sources not chosen", () => {
    const priced = [
      { id: "x-search", priceUsd: null },
      { id: "cmc-quotes", priceUsd: 0.05 },
      { id: "not-chosen", priceUsd: 9 },
    ] as DataSourceInfo[];
    const facts = costFacts(emptyDraft(), priced, opts);
    expect(facts.chosenCount).toBe(2);
    expect(facts.sourcesPerRun).toBeCloseTo(0.06);
  });

  it("on pay per use, quotes the panel's own estimate and what the wallet needs", () => {
    const draft = payPerUse();
    const facts = costFacts(draft, sources, usdcOpts);
    expect(facts.payPerUse).toBe(true);
    expect(facts.thinking).toEqual(usdcEstimate(draft.config.llm.usdc!.model, draft.config.schedule.intervalMinutes));
    expect(facts.thinking?.model).not.toBeNull();
    expect(facts.thinkingNeedUsd).toBe(walletNeedUsd(draft.config.llm.usdc!));
  });

  it("costs a pay-per-use draft as a key draft when pay per use is not allowed", () => {
    const facts = costFacts(payPerUse(), sources, opts);
    expect(facts.payPerUse).toBe(false);
    expect(facts.thinking).toBeNull();
    expect(facts.thinkingNeedUsd).toBeNull();
  });

  it("carries the provider's name, the fee and the hold", () => {
    const facts = costFacts(funded(true), sources, opts);
    expect(facts.providerLabel).toBe("Anthropic");
    expect(facts.feeBps).toBe(FEE);
    expect(facts.heldForLive).toBe(true);
    expect(costFacts(funded(false), sources, opts).heldForLive).toBe(false);
    expect(costFacts(emptyDraft(), sources, opts).heldForLive).toBe(false);
  });
});

describe("commitShortLine", () => {
  it("fund mode names the money being signed", () => {
    const draft = funded(true);
    expect(commitShortLine(draft, costFacts(draft, sources, opts))).toBe("Signs $25.00 USDC · ~96/day");
    draft.config.schedule = { intervalMinutes: 0 };
    expect(commitShortLine(draft, costFacts(draft, sources, opts))).toBe("Signs $25.00 USDC · manual runs");
  });

  it("a manual schedule", () => {
    const draft = draftWith((d) => {
      d.config.schedule = { intervalMinutes: 0 };
    });
    expect(commitShortLine(draft, costFacts(draft, sources, opts))).toBe("Manual runs only");
  });

  it("pay per use with a model quotes the day of thinking", () => {
    const draft = payPerUse();
    const facts = costFacts(draft, sources, usdcOpts);
    const estimate = usdcEstimate(draft.config.llm.usdc!.model, draft.config.schedule.intervalMinutes);
    expect(estimate.runsPerDay).toBeGreaterThan(0);
    expect(commitShortLine(draft, facts)).toBe(
      `~${estimate.runsPerDay} runs/day · ≈${formatUsd(estimate.dayUsd)} thinking`,
    );
  });

  it("pay per use without a listed model quotes nothing", () => {
    const draft = payPerUse((d) => {
      d.config.llm.usdc = { ...d.config.llm.usdc!, model: "nobody/nothing" };
    });
    expect(commitShortLine(draft, costFacts(draft, sources, usdcOpts))).toBe("Pick a model to see the cost");
  });

  it("on a key, says whose bill the runs are", () => {
    const draft = draftWith((d) => {
      d.config.schedule = { intervalMinutes: 5 };
    });
    expect(commitShortLine(draft, costFacts(draft, sources, opts))).toBe("~288 runs/day on your key");
  });
});

describe("exitSummary", () => {
  it("the default exits", () => {
    expect(exitSummary(emptyDraft().config.risk)).toBe("Stop 15% · take 40% · score under 40 · liquidity −50%");
  });

  it("says so when every exit is off", () => {
    const risk = {
      ...emptyDraft().config.risk,
      stopLossPct: null,
      takeProfitPct: null,
      trailingStopPct: null,
      maxHoldHours: null,
      exitScoreBelow: null,
      exitOnLiquidityDropPct: null,
    };
    expect(exitSummary(risk)).toBe("No automatic exits");
  });

  it("states the first-fifteen preset's half-hour hold in minutes", () => {
    const preset = STRATEGY_PRESETS.find((candidate) => candidate.id === "first-fifteen")!;
    const risk = { ...emptyDraft().config.risk, ...preset.risk };
    const line = exitSummary(risk);
    expect(line).toBe("Stop 40% · take 100% · trail 30% · max hold 30 min · score under 40 · liquidity −30%");
    expect(line).not.toContain("0.5");
  });

  it("states whole hours and whole days as such, and leaves out a rule that is off", () => {
    const base = { ...emptyDraft().config.risk, stopLossPct: null, takeProfitPct: null, exitOnLiquidityDropPct: null };
    expect(exitSummary({ ...base, maxHoldHours: 6 })).toBe("Max hold 6 h · score under 40");
    expect(exitSummary({ ...base, maxHoldHours: 72 })).toBe("Max hold 3 d · score under 40");
    expect(exitSummary({ ...base, maxHoldHours: 1.5, exitScoreBelow: null })).toBe("Max hold 90 min");
  });
});

describe("thinkSummary", () => {
  const keyed = draftWith((d) => {
    d.llmKeyId = "key_a";
  });
  const usdcNoModel = payPerUse((d) => {
    d.config.llm.usdc = { ...d.config.llm.usdc!, model: "nobody/nothing" };
  });
  const usdcLowDay = payPerUse((d) => {
    d.config.llm.usdc = { ...d.config.llm.usdc!, maxUsdPerDay: 0.01 };
  });

  it("a key of the draft's provider", () => {
    expect(thinkSummary(keyed, [anthropic], { payPerUseAllowed: false })).toEqual({
      text: `Anthropic · ${DEFAULT_AGENT_CONFIG.llm.model} on your key`,
      needed: false,
    });
  });

  it("no key", () => {
    expect(thinkSummary(emptyDraft(), [], { payPerUseAllowed: false })).toEqual({
      text: "Needs an Anthropic key",
      needed: true,
    });
  });

  it("a key of another provider is as good as none", () => {
    const draft = draftWith((d) => {
      d.llmKeyId = "key_oa";
    });
    expect(thinkSummary(draft, [openai], { payPerUseAllowed: false })).toEqual({
      text: "Needs an Anthropic key",
      needed: true,
    });
  });

  it("takes the article from the provider's name", () => {
    const draft = emptyDraft();
    draft.config = { ...draft.config, llm: onProvider(draft.config.llm, "groq") };
    expect(thinkSummary(draft, [], { payPerUseAllowed: false }).text).toBe("Needs a Groq key");
  });

  it("pay per use names the model and needs no key", () => {
    const draft = payPerUse();
    expect(thinkSummary(draft, [], { payPerUseAllowed: true })).toEqual({
      text: `Pay per use · ${draft.config.llm.usdc!.model}`,
      needed: false,
    });
  });

  it("pay per use says which of its two things is wrong", () => {
    expect(thinkSummary(usdcNoModel, [], { payPerUseAllowed: true })).toEqual({ text: "Pick a model", needed: true });
    expect(thinkSummary(usdcLowDay, [], { payPerUseAllowed: true })).toEqual({ text: "Check the limits", needed: true });
  });

  it("a pay-per-use draft is a key draft when pay per use is not allowed", () => {
    expect(thinkSummary(payPerUse(), [], { payPerUseAllowed: false })).toEqual({
      text: "Needs an Anthropic key",
      needed: true,
    });
  });

  it("is needed exactly when validateDraft refuses the draft for how it thinks", () => {
    const badLlm = draftWith((d) => {
      d.llmKeyId = "key_a";
      d.config.llm = { ...d.config.llm, temperature: 9 };
    });
    const cases: Array<[BuilderDraft, Array<{ id: string; provider: "anthropic" | "openai" }>, boolean]> = [
      [emptyDraft(), [], false],
      [emptyDraft(), [anthropic], false],
      [keyed, [anthropic], false],
      [keyed, [openai], false],
      [keyed, [], true],
      [badLlm, [anthropic], false],
      [payPerUse(), [], true],
      [payPerUse(), [], false],
      [usdcNoModel, [], true],
      [usdcLowDay, [], true],
      // No Solana wallet to pay from: refused, but for its chains, not for how it thinks.
      [
        payPerUse((d) => {
          d.config.chains = ["base"];
        }),
        [],
        true,
      ],
    ];
    for (const [draft, keys, payPerUseAllowed] of cases) {
      const errors = validateDraft(draft, keys, { payPerUseAllowed });
      const refused = Boolean(errors.llmKeyId || errors.thinking || errors.llm);
      expect(thinkSummary(draft, keys, { payPerUseAllowed }).needed).toBe(refused);
    }
    expect(validateDraft(badLlm, [anthropic]).llm).toBeTruthy();
    expect(thinkSummary(badLlm, [anthropic], { payPerUseAllowed: false }).text).toBe("Check the model settings");
  });
});

describe("strategyLabel", () => {
  it("names the preset a prompt came from", () => {
    for (const preset of STRATEGY_PRESETS) {
      expect(strategyLabel(preset.prompt), preset.id).toBe(`${preset.label} preset`);
    }
  });

  it("the default prompt was written for the user", () => {
    expect(strategyLabel(DEFAULT_AGENT_CONFIG.strategyPrompt)).toBe("written for you");
  });

  it("anything else is the user's own, an edited preset and an empty box included", () => {
    expect(strategyLabel(`${STRATEGY_PRESETS[0].prompt} And never on a Sunday.`)).toBe("your own");
    expect(strategyLabel("")).toBe("your own");
  });
});

describe("readyItems", () => {
  const ready = (draft: BuilderDraft, keys: Array<typeof anthropic>) =>
    readyItems(draft, validateDraft(draft, keys), keys, { payPerUseAllowed: false });

  it("is always the three required things, in order, each with its place", () => {
    for (const items of [ready(emptyDraft(), []), ready(emptyDraft(), [anthropic])]) {
      expect(items.map((item) => item.id)).toEqual([...REQUIRED_ORDER]);
      expect(items.map((item) => item.label)).toEqual(["Name", "Strategy", "A way to think"]);
      for (const item of items) expect(item.place).toEqual(REQUIRED_PLACE[item.id]);
    }
  });

  it("a fresh draft with no key has one of three ready", () => {
    const items = ready(emptyDraft(), []);
    expect(items.map((item) => item.ready)).toEqual([false, true, false]);
    expect(items.map((item) => item.value)).toEqual(["needed", "written for you", "Needs an Anthropic key"]);
  });

  it("a fresh draft on a key has two of three ready", () => {
    const draft = draftWith((d) => {
      d.llmKeyId = "key_a";
    });
    const items = ready(draft, [anthropic]);
    expect(items.map((item) => item.ready)).toEqual([false, true, true]);
    expect(items[2].value).toBe(`Anthropic · ${DEFAULT_AGENT_CONFIG.llm.model} on your key`);
  });

  it("a named draft shows the trimmed name, and an empty prompt is needed", () => {
    const draft = draftWith((d) => {
      d.llmKeyId = "key_a";
      d.name = "  Momentum Mike ";
      d.config.strategyPrompt = "";
    });
    const items = ready(draft, [anthropic]);
    expect(items.map((item) => item.ready)).toEqual([true, false, true]);
    expect(items[1].value).toBe("needed");
    expect(items[0].value).toBe("Momentum Mike");
  });
});

describe("stillNeeded", () => {
  const needed = (draft: BuilderDraft, keys: Array<typeof anthropic>, payPerUseAllowed = false) => {
    const errors = validateDraft(draft, keys, { payPerUseAllowed });
    return stillNeeded(readyItems(draft, errors, keys, { payPerUseAllowed }), errors);
  };
  const complete = (draft: BuilderDraft) => {
    draft.name = "Momentum Mike";
    draft.llmKeyId = "key_a";
  };

  it("is null when nothing required is missing", () => {
    expect(needed(draftWith(complete), [anthropic])).toBeNull();
  });

  it("names one, two and three missing things", () => {
    expect(
      needed(
        draftWith((d) => {
          d.llmKeyId = "key_a";
        }),
        [anthropic],
      ),
    ).toBe("a name");
    expect(needed(emptyDraft(), [])).toBe("a name and a key");
    expect(
      needed(
        draftWith((d) => {
          d.config.strategyPrompt = "";
        }),
        [],
      ),
    ).toBe("a name, a strategy and a key");
  });

  it("on pay per use asks for a model, or for the limits to be checked", () => {
    const noModel = payPerUse((d) => {
      d.name = "Momentum Mike";
      d.config.llm.usdc = { ...d.config.llm.usdc!, model: "nobody/nothing" };
    });
    expect(needed(noModel, [], true)).toBe("a model");
    const lowDay = payPerUse((d) => {
      d.config.llm.usdc = { ...d.config.llm.usdc!, maxUsdPerDay: 0.01 };
    });
    expect(needed(lowDay, [], true)).toBe("a name and its limits checked");
    expect(
      needed(
        payPerUse((d) => {
          d.name = "Momentum Mike";
        }),
        [],
        true,
      ),
    ).toBeNull();
  });
});

describe("previewRows", () => {
  const draft = emptyDraft();
  const facts = costFacts(draft, sources, opts);
  const rows = previewRows(draft, facts, validateDraft(draft, []), {
    hunts: "Solana · score 62+ · $15K+ liquidity · 4 feeds",
    labels,
    payPerUseAllowed: false,
  });

  it("is seven rows in a fixed order, each named after the card it opens", () => {
    expect(rows.map((row) => row.id)).toEqual(["hunts", "data", "limits", "exits", "runs", "thinks", "money"]);
    expect(rows.map((row) => row.label)).toEqual([
      "Where it hunts",
      "Data it buys",
      "Risk limits",
      "When it sells",
      "Schedule & mode",
      "How it thinks",
      "Funding",
    ]);
    for (const row of rows) expect(row.place).toEqual(ROW_PLACE[row.id]);
  });

  it("quotes the same sentences as the closed cards", () => {
    const text = Object.fromEntries(rows.map((row) => [row.id, row.text]));
    expect(text.hunts).toBe("Solana · score 62+ · $15K+ liquidity · 4 feeds");
    expect(text.data).toBe(dataSummary(facts));
    expect(text.limits).toBe(riskSummary(draft.config.risk, FEE));
    expect(text.exits).toBe(exitSummary(draft.config.risk));
    expect(text.runs).toBe(scheduleSummary(draft, facts, labels));
    expect(text.thinks).toBe("Needs an Anthropic key");
    expect(text.money).toBe(fundingSummary(draft, facts));
  });

  it("quotes a typed liquidity gate as the number it is", () => {
    // Every gate off its ladder, as somebody typing exact values would leave it.
    const odd = draftWith((d) => {
      Object.assign(d.config.universe, {
        minScore: 61.5,
        minLiquidityUsd: 12_345,
        minHolderCount: 37,
        minAgeMinutes: 7,
        maxAgeHours: 36,
        maxTop10HolderPct: 42.5,
        maxBuyTaxPct: 7.5,
      });
    });
    const hunts = universeSummary(odd.config.universe, odd.config.chains);
    expect(hunts).toBe("Solana · score 62+ · $12,345+ liquidity · 4 feeds");
    const oddRows = previewRows(odd, costFacts(odd, sources, opts), validateDraft(odd, []), {
      hunts,
      labels,
      payPerUseAllowed: false,
    });
    expect(oddRows.find((row) => row.id === "hunts")?.text).toBe(hunts);
  });

  it("marks only how it thinks as needed, and only while it is", () => {
    expect(rows.filter((row) => row.needed).map((row) => row.id)).toEqual(["thinks"]);
    const keyed = draftWith((d) => {
      d.llmKeyId = "key_a";
    });
    const done = previewRows(keyed, costFacts(keyed, sources, opts), validateDraft(keyed, [anthropic]), {
      hunts: "",
      labels,
      payPerUseAllowed: false,
    });
    expect(done.some((row) => row.needed)).toBe(false);
  });
});

describe("costLines", () => {
  const lines = (draft: BuilderDraft, options = opts) => costLines(draft, costFacts(draft, sources, options));
  const ids = (draft: BuilderDraft, options = opts) => lines(draft, options).map((line) => line.id);
  const text = (draft: BuilderDraft, id: string, options = opts) =>
    lines(draft, options).find((line) => line.id === id)?.text;

  it("a fresh draft on a key", () => {
    expect(lines(emptyDraft())).toEqual([
      { id: "runs", label: "Runs", text: "96 a day" },
      { id: "thinking", label: "Thinking", text: "billed to your Anthropic key" },
      { id: "data", label: "Data", text: "≈$0.05 a run, capped at $1.00 · Tocker pays" },
      { id: "fee", label: "Fee", text: "0.5% of each fill" },
    ]);
  });

  it("has the sign line only in fund mode", () => {
    expect(ids(emptyDraft())).not.toContain("sign");
    expect(lines(funded(false)).at(-1)).toEqual({
      id: "sign",
      label: "You sign",
      text: "$25.00 USDC right after it is created",
    });
  });

  it("has the wallet line only for pay per use on paper", () => {
    const draft = payPerUse();
    expect(text(draft, "wallet", usdcOpts)).toBe(
      `${formatUsd(walletNeedUsd(draft.config.llm.usdc!))} of USDC before it can think`,
    );
    expect(ids(emptyDraft())).not.toContain("wallet");
    expect(ids(payPerUse(), opts)).not.toContain("wallet");
    const fundedUsdc = payPerUse((d) => {
      d.funding = { ...d.funding, mode: "fund" };
    });
    expect(ids(fundedUsdc, usdcOpts)).not.toContain("wallet");
    expect(ids(fundedUsdc, usdcOpts)).toContain("sign");
  });

  it("has no fee line when the fee is off, and the rate, the same on a small ticket, when it is not", () => {
    expect(ids(emptyDraft(), { payPerUseAllowed: false, feeBps: 0 })).not.toContain("fee");
    const small = draftWith((d) => {
      d.config.risk.maxTradeUsd = 2;
    });
    expect(text(small, "fee")).toBe("0.5% of each fill");
    expect(text(emptyDraft(), "fee", { payPerUseAllowed: false, feeBps: 25 })).toBe("0.25% of each fill");
  });

  it("a manual schedule runs only by hand", () => {
    const manual = draftWith((d) => {
      d.config.schedule = { intervalMinutes: 0 };
    });
    expect(text(manual, "runs")).toBe("Manual only");
  });

  it("a funded agent headed for the checklist runs nothing until then", () => {
    expect(text(funded(true), "runs")).toBe("None until you switch it live on the checklist");
    expect(text(funded(false), "runs")).toBe("96 a day");
  });

  it("pay per use quotes the estimate, or asks for a model", () => {
    const draft = payPerUse();
    const estimate = usdcEstimate(draft.config.llm.usdc!.model, draft.config.schedule.intervalMinutes);
    expect(text(draft, "runs", usdcOpts)).toBe(`${estimate.runsPerDay} a day`);
    expect(text(draft, "thinking", usdcOpts)).toContain("a run, about ");
    expect(text(draft, "thinking", usdcOpts)).toMatch(/^≈\$.+ a day, from the agent's wallet$/);
    const noModel = payPerUse((d) => {
      d.config.llm.usdc = { ...d.config.llm.usdc!, model: "nobody/nothing" };
    });
    expect(text(noModel, "thinking", usdcOpts)).toBe("pick a model to see the cost");
    const manual = payPerUse((d) => {
      d.config.schedule = { intervalMinutes: 0 };
    });
    expect(text(manual, "thinking", usdcOpts)).toMatch(/^≈\$.+ a run, from the agent's wallet$/);
    expect(text(manual, "thinking", usdcOpts)).not.toContain("a day");
  });
});

describe("runLine", () => {
  it("quotes the draft's own score floor", () => {
    expect(runLine(emptyDraft().config)).toBe("Discover → Score 62+ → Propose → You approve");
    const draft = draftWith((d) => {
      d.config.universe.minScore = 45;
    });
    expect(runLine(draft.config)).toBe("Discover → Score 45+ → Propose → You approve");
  });

  it("ends on the trade when the agent trades on its own", () => {
    const draft = draftWith((d) => {
      d.config.execution = { mode: "auto", proposalTtlMinutes: 60 };
    });
    expect(runLine(draft.config)).toBe("Discover → Score 62+ → Propose → Trade");
  });
});

/**
 * The same card over a saved agent, on its settings page. How it starts, how it is funded
 * and what is signed were all settled when it was created, so the three summaries that
 * state them say what is true of the agent now.
 */
describe("a saved agent's card", () => {
  const live: SummaryEdit = { mode: "live", status: "active", balanceText: "$20.00 USDC in its wallets" };
  const paper: SummaryEdit = { mode: "paper", status: "paused", balanceText: "$0.00 USDC in its wallets" };
  const ctx = { hunts: "Solana · score 62+ · $15K+ liquidity · 4 feeds", labels, payPerUseAllowed: false };

  it("closes the schedule row on the mode it is in, not on how it starts or its paper balance", () => {
    const draft = emptyDraft();
    const facts = costFacts(draft, sources, opts);
    expect(scheduleSummary(draft, facts, labels, live)).toBe(
      "Every 15 min · asks before each trade (1 h to decide) · live",
    );
    const line = scheduleSummary(draft, facts, labels, paper);
    expect(line).toBe("Every 15 min · asks before each trade (1 h to decide) · paper");
    expect(line).not.toContain("starts");
    expect(line).not.toContain("$10K");
    // The mode is all it reads, so the Schedule step can quote it without the balance.
    expect(scheduleSummary(draft, facts, labels, { mode: "live" })).toBe(scheduleSummary(draft, facts, labels, live));
  });

  it("reads the interval and the execution from the working copy", () => {
    const draft = draftWith((d) => {
      d.config.schedule = { intervalMinutes: 60 };
      d.config.execution = { mode: "auto", proposalTtlMinutes: 60 };
    });
    expect(scheduleSummary(draft, costFacts(draft, sources, opts), labels, live)).toBe(
      "Every 1h · trades on its own · live",
    );
    const manual = draftWith((d) => {
      d.config.schedule = { intervalMinutes: 0 };
    });
    expect(scheduleSummary(manual, costFacts(manual, sources, opts), labels, paper)).toBe(
      "Manual only · asks before each trade (1 h to decide) · paper",
    );
  });

  it("states no plan a draft could hold: not a paused start, not a funded amount, not the checklist", () => {
    for (const draft of [
      funded(true),
      funded(false),
      draftWith((d) => {
        d.activate = false;
        d.paperStartingUsd = 500;
      }),
    ]) {
      expect(scheduleSummary(draft, costFacts(draft, sources, opts), labels, live)).toBe(
        "Every 15 min · asks before each trade (1 h to decide) · live",
      );
    }
  });

  it("makes the money row the balance the page shows, then the mode", () => {
    const draft = emptyDraft();
    const facts = costFacts(draft, sources, opts);
    expect(fundingSummary(draft, facts, live)).toBe("$20.00 USDC in its wallets · live");
    expect(fundingSummary(draft, facts, paper)).toBe("$0.00 USDC in its wallets · paper");
    // The page's own words when a wallet could not be read, never a figure in their place.
    expect(fundingSummary(draft, facts, { ...live, balanceText: "Balance unavailable" })).toBe(
      "Balance unavailable · live",
    );
    // Whatever funding a draft would have planned.
    expect(fundingSummary(funded(true), costFacts(funded(true), sources, opts), live)).toBe(
      "$20.00 USDC in its wallets · live",
    );
    const usdc = payPerUse();
    expect(fundingSummary(usdc, costFacts(usdc, sources, usdcOpts), paper)).toBe("$0.00 USDC in its wallets · paper");
  });

  it("calls the last row Money and sends it to the agent's wallets", () => {
    const draft = emptyDraft();
    const facts = costFacts(draft, sources, opts);
    const rows = previewRows(draft, facts, validateDraft(draft, []), { ...ctx, edit: live });
    expect(rows.map((row) => row.id)).toEqual(["hunts", "data", "limits", "exits", "runs", "thinks", "money"]);
    expect(rows.map((row) => row.label)).toEqual([
      "Where it hunts",
      "Data it buys",
      "Risk limits",
      "When it sells",
      "Schedule & mode",
      "How it thinks",
      "Money",
    ]);
    const money = rows.find((row) => row.id === "money");
    expect(money?.text).toBe("$20.00 USDC in its wallets · live");
    expect(money?.place).toEqual({ step: "manage", sub: "wallets" });
    expect(money?.needed).toBe(false);
    expect(rows.find((row) => row.id === "runs")?.text).toBe(scheduleSummary(draft, facts, labels, live));
    // Every other row is the one a draft has, and leads where it always did.
    const drafted = previewRows(draft, facts, validateDraft(draft, []), ctx);
    for (const row of rows) {
      if (row.id === "money") continue;
      expect(row.place).toEqual(ROW_PLACE[row.id]);
      if (row.id !== "runs") expect(row).toEqual(drafted.find((other) => other.id === row.id));
    }
  });

  it("leaves what is signed and what the wallet needs out of a run", () => {
    const usdc = payPerUse();
    const usdcFacts = costFacts(usdc, sources, usdcOpts);
    expect(costLines(usdc, usdcFacts).map((line) => line.id)).toContain("wallet");
    expect(costLines(usdc, usdcFacts, paper).map((line) => line.id)).toEqual(["runs", "thinking", "data", "fee"]);
    const fund = funded(false);
    const fundFacts = costFacts(fund, sources, opts);
    expect(costLines(fund, fundFacts).map((line) => line.id)).toContain("sign");
    expect(costLines(fund, fundFacts, live).map((line) => line.id)).toEqual(["runs", "thinking", "data", "fee"]);
    // The lines that stay are the ones a draft has.
    expect(costLines(usdc, usdcFacts, paper)).toEqual(costLines(usdc, usdcFacts).slice(0, 4));
    const draft = emptyDraft();
    const facts = costFacts(draft, sources, opts);
    expect(costLines(draft, facts, live)).toEqual(costLines(draft, facts));
  });

  it("changes nothing when it is not told about a saved agent", () => {
    for (const [draft, options] of [
      [emptyDraft(), opts],
      [funded(true), opts],
      [funded(false), opts],
      [payPerUse(), usdcOpts],
    ] as const) {
      const facts = costFacts(draft, sources, options);
      const errors = validateDraft(draft, [], options);
      const rowsCtx = { ...ctx, payPerUseAllowed: options.payPerUseAllowed };
      expect(scheduleSummary(draft, facts, labels, undefined)).toBe(scheduleSummary(draft, facts, labels));
      expect(fundingSummary(draft, facts, undefined)).toBe(fundingSummary(draft, facts));
      expect(costLines(draft, facts, undefined)).toEqual(costLines(draft, facts));
      expect(previewRows(draft, facts, errors, { ...rowsCtx, edit: undefined })).toEqual(
        previewRows(draft, facts, errors, rowsCtx),
      );
    }
    const draft = emptyDraft();
    const rows = previewRows(draft, costFacts(draft, sources, opts), validateDraft(draft, []), ctx);
    expect(rows.at(-1)).toMatchObject({ label: "Funding", place: { step: "create" } });
  });
});
