import { beforeAll, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG as C } from "@/lib/agent/config";
import { CATALOGUE } from "@/lib/agent/providers";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { toNumeric } from "@/lib/money";
import { PAY_PER_USE_MODELS } from "@/lib/x402/inference-types";
import {
  EQUITY_BUCKET_MS,
  MODEL_PRICES,
  combineEquity,
  estimateModelSpendUsd,
  getMoney,
  ownKeyComparison,
  ownKeyPrice,
  pnlByDay,
  resolveModelPrice,
  utcDayKey,
  type SnapshotPoint,
} from "./money";

// A live book reads the wallet through `getPortfolio`; with no network in tests, make it
// fail the way an RPC outage does so `getMoney` takes its snapshot fallback.
vi.mock("@/lib/agent/portfolio", () => ({
  getPortfolio: async () => {
    throw new Error("offline in tests");
  },
}));

const DAY = 86_400_000;
/** 2026-09-20T00:00:00Z — a fixed Sunday, so nothing in here depends on the wall clock. */
const DAY0 = Date.UTC(2026, 8, 20);

function point(agentId: string, dayOffset: number, hour: number, equityUsd: number): SnapshotPoint {
  return { agentId, at: DAY0 + dayOffset * DAY + hour * 3_600_000, equityUsd };
}

describe("utcDayKey", () => {
  it("is UTC, never local", () => {
    expect(utcDayKey(Date.UTC(2026, 8, 20, 23, 59, 59))).toBe("2026-09-20");
    expect(utcDayKey(Date.UTC(2026, 8, 21, 0, 0, 1))).toBe("2026-09-21");
  });

  it("takes a Date or an ISO string", () => {
    expect(utcDayKey(new Date(DAY0))).toBe("2026-09-20");
    expect(utcDayKey("2026-09-20T12:00:00.000Z")).toBe("2026-09-20");
  });
});

describe("pnlByDay", () => {
  const now = DAY0 + 2 * DAY + 20 * 3_600_000;

  it("returns nothing when there is nothing", () => {
    expect(pnlByDay([], { now })).toEqual([]);
  });

  it("uses the last snapshot of each UTC day as that day's close", () => {
    const days = pnlByDay(
      [point("a", 0, 1, 100), point("a", 0, 9, 110), point("a", 0, 23, 120), point("a", 1, 12, 150)],
      { now: DAY0 + DAY + 13 * 3_600_000 },
    );
    expect(days.map((d) => [d.day, d.equityUsd])).toEqual([
      ["2026-09-20", 120],
      ["2026-09-21", 150],
    ]);
  });

  it("leaves the first day's delta null and derives the rest day over day", () => {
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 1, 12, 125), point("a", 2, 12, 100)], { now });
    expect(days[0].pnlUsd).toBeNull();
    expect(days[0].pnlPct).toBeNull();
    expect(days[1].pnlUsd).toBe(25);
    expect(days[1].pnlPct).toBeCloseTo(25, 10);
    expect(days[2].pnlUsd).toBe(-25);
    expect(days[2].pnlPct).toBeCloseTo(-20, 10);
  });

  it("sums across agents on the same day", () => {
    const days = pnlByDay([point("a", 0, 12, 100), point("b", 0, 13, 40), point("a", 1, 12, 110), point("b", 1, 9, 60)], {
      now: DAY0 + DAY + 20 * 3_600_000,
    });
    expect(days.map((d) => d.equityUsd)).toEqual([140, 170]);
    expect(days[1].pnlUsd).toBe(30);
    expect(days[1].agents).toBe(2);
  });

  it("carries a silent agent's close forward instead of reading it as a wipeout", () => {
    // `b` marks on day 0 and then goes quiet. Without the carry, day 1 is −$40 and day 2
    // is +$40, and the operator sees a crash that never happened.
    const days = pnlByDay([point("a", 0, 12, 100), point("b", 0, 12, 40), point("a", 1, 12, 100), point("a", 2, 12, 100), point("b", 2, 12, 40)], {
      now,
    });
    expect(days.map((d) => d.equityUsd)).toEqual([140, 140, 140]);
    expect(days.map((d) => d.pnlUsd)).toEqual([null, 0, 0]);
  });

  it("fills quiet days between snapshots, weekends included", () => {
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 3, 12, 130)], { now: DAY0 + 3 * DAY + 20 * 3_600_000 });
    expect(days.map((d) => d.day)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"]);
    expect(days.map((d) => d.pnlUsd)).toEqual([null, 0, 0, 30]);
  });

  it("counts an agent only from its first snapshot, so a new book is a step not a gain", () => {
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 1, 12, 100), point("b", 1, 12, 500)], {
      now: DAY0 + DAY + 20 * 3_600_000,
    });
    expect(days[0]).toMatchObject({ equityUsd: 100, agents: 1 });
    // b's $500 opening book is money in, not a $500 day.
    expect(days[1]).toMatchObject({ equityUsd: 600, pnlUsd: 0, pnlPct: 0, flowUsd: 500, agents: 2 });
  });

  it("takes a deposit out of the day's P&L and measures the percentage against what came in", () => {
    // a: 100 → deposit 500 at 14:00 → closes at 630. 30 of that is a gain, 500 is money moved.
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 1, 12, 100), point("a", 1, 20, 630)], {
      now: DAY0 + DAY + 21 * 3_600_000,
      flows: [{ agentId: "a", at: DAY0 + DAY + 14 * 3_600_000, amountUsd: 500 }],
    });
    expect(days[1]).toMatchObject({ equityUsd: 630, pnlUsd: 30, flowUsd: 500 });
    expect(days[1].pnlPct).toBeCloseTo(5, 10); // 30 on 100 + 500
  });

  it("takes a withdrawal out of the day's P&L, so money taken out is not a loss", () => {
    const days = pnlByDay([point("a", 0, 12, 600), point("a", 1, 20, 110)], {
      now: DAY0 + DAY + 21 * 3_600_000,
      flows: [{ agentId: "a", at: DAY0 + DAY + 9 * 3_600_000, amountUsd: -500 }],
    });
    expect(days[1]).toMatchObject({ equityUsd: 110, pnlUsd: 10, flowUsd: -500 });
    expect(days[1].pnlPct).toBeCloseTo((10 / 600) * 100, 10);
  });

  it("does not count a deposit twice when it is already inside the agent's opening book", () => {
    // b is funded at 11:50 and first marked at 12:00: the 500 is its opening book.
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 1, 12, 100), point("b", 1, 12, 500), point("b", 1, 20, 520)], {
      now: DAY0 + DAY + 21 * 3_600_000,
      flows: [{ agentId: "b", at: DAY0 + DAY + 11 * 3_600_000 + 50 * 60_000, amountUsd: 500 }],
      resolutionMs: EQUITY_BUCKET_MS,
    });
    expect(days[1]).toMatchObject({ equityUsd: 620, pnlUsd: 20, flowUsd: 500 });
  });

  it("ignores flows for agents it has no book for", () => {
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 1, 12, 110)], {
      now: DAY0 + DAY + 13 * 3_600_000,
      flows: [{ agentId: "ghost", at: DAY0 + DAY, amountUsd: 900 }],
    });
    expect(days[1]).toMatchObject({ pnlUsd: 10, flowUsd: 0 });
  });

  it("runs the days up to now even when nothing has been marked since", () => {
    const days = pnlByDay([point("a", 0, 12, 100)], { now });
    expect(days.map((d) => d.day)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22"]);
    expect(days.at(-1)).toMatchObject({ equityUsd: 100, pnlUsd: 0 });
  });

  it("does not truncate the series when the clock is behind the data", () => {
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 2, 12, 120)], { now: DAY0 });
    expect(days).toHaveLength(3);
    expect(days.at(-1)?.equityUsd).toBe(120);
  });

  it("keeps only the last `days` rows", () => {
    const points = Array.from({ length: 40 }, (_, i) => point("a", i, 12, 100 + i));
    const days = pnlByDay(points, { days: 30, now: DAY0 + 39 * DAY + 20 * 3_600_000 });
    expect(days).toHaveLength(30);
    expect(days[0].day).toBe(utcDayKey(DAY0 + 10 * DAY));
    // The trimmed-off day before still supplies the first row's delta.
    expect(days[0].pnlUsd).toBe(1);
    expect(days.at(-1)?.equityUsd).toBe(139);
  });

  it("reports no percentage against a zero base", () => {
    const days = pnlByDay([point("a", 0, 12, 0), point("a", 1, 12, 50)], { now: DAY0 + DAY + 20 * 3_600_000 });
    expect(days[1].pnlUsd).toBe(50);
    expect(days[1].pnlPct).toBeNull();
  });

  it("ignores points with an unusable timestamp or equity", () => {
    const days = pnlByDay(
      [
        point("a", 0, 12, 100),
        { agentId: "a", at: "not a date", equityUsd: 9_999 },
        { agentId: "a", at: DAY0 + DAY, equityUsd: Number.NaN },
      ],
      { now: DAY0 + 12 * 3_600_000 },
    );
    expect(days).toEqual([
      { day: "2026-09-20", equityUsd: 100, pnlUsd: null, pnlPct: null, flowUsd: 0, thinkingUsd: 0, agents: 1 },
    ]);
  });

  // What a pay-per-use agent pays for its own thinking leaves its wallet, so the close
  // falls by it. That is a cost of running the agent, not a result of its trading.
  it("takes what was paid for thinking out of the day's P&L, and reports it apart from the flow", () => {
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 1, 20, 99.25)], {
      now: DAY0 + DAY + 21 * 3_600_000,
      flows: [
        { agentId: "a", at: DAY0 + DAY + 9 * 3_600_000, amountUsd: -0.5, kind: "thinking" },
        { agentId: "a", at: DAY0 + DAY + 10 * 3_600_000, amountUsd: -0.25, kind: "thinking" },
      ],
    });
    expect(days[1]).toMatchObject({ equityUsd: 99.25, flowUsd: 0 });
    expect(days[1].pnlUsd).toBeCloseTo(0, 10);
    expect(days[1].thinkingUsd).toBeCloseTo(0.75, 10);
    expect(days[1].pnlPct).toBeCloseTo(0, 10);
  });

  it("keeps thinking and a deposit on the same day apart, and nets both", () => {
    // 100, then 500 in and 1 paid for thinking, then 9 made: 608.
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 1, 20, 608)], {
      now: DAY0 + DAY + 21 * 3_600_000,
      flows: [
        { agentId: "a", at: DAY0 + DAY + 9 * 3_600_000, amountUsd: 500 },
        { agentId: "a", at: DAY0 + DAY + 10 * 3_600_000, amountUsd: -1, kind: "thinking" },
      ],
    });
    expect(days[1]).toMatchObject({ flowUsd: 500, thinkingUsd: 1 });
    expect(days[1].pnlUsd).toBeCloseTo(9, 10);
    // On the prior close plus what came in. Paying for thinking does not shrink the base.
    expect(days[1].pnlPct).toBeCloseTo((9 / 600) * 100, 10);
  });

  it("does not net thinking that was paid before the agent's first point, or by an agent with no book", () => {
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 1, 12, 100)], {
      now: DAY0 + DAY + 13 * 3_600_000,
      flows: [
        // Before the opening book: that mark already lacks the money.
        { agentId: "a", at: DAY0 + 6 * 3_600_000, amountUsd: -3, kind: "thinking" },
        { agentId: "ghost", at: DAY0 + DAY, amountUsd: -9, kind: "thinking" },
      ],
    });
    expect(days[1]).toMatchObject({ pnlUsd: 0, thinkingUsd: 0, flowUsd: 0 });
  });

  it("never reads a positive amount as thinking paid", () => {
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 1, 12, 100)], {
      now: DAY0 + DAY + 13 * 3_600_000,
      flows: [{ agentId: "a", at: DAY0 + DAY + 3_600_000, amountUsd: 5, kind: "thinking" }],
    });
    // Not a payment, so nothing is added back and nothing is called a deposit.
    expect(days[1]).toMatchObject({ pnlUsd: 0, thinkingUsd: 0, flowUsd: 0 });
  });

  it("leaves a day with no thinking exactly as it was", () => {
    const flows = [{ agentId: "a", at: DAY0 + DAY + 9 * 3_600_000, amountUsd: -40 }];
    const days = pnlByDay([point("a", 0, 12, 600), point("a", 1, 20, 570)], { now: DAY0 + DAY + 21 * 3_600_000, flows });
    expect(days[1]).toMatchObject({ pnlUsd: 10, flowUsd: -40, thinkingUsd: 0 });
  });
});

describe("combineEquity", () => {
  it("buckets to 15 minutes, keeping the last point in each bucket, at its own time", () => {
    const base = Date.UTC(2026, 8, 20, 12, 0);
    const series = combineEquity([
      { agentId: "a", at: base + 60_000, equityUsd: 100, cashUsd: 100 },
      { agentId: "a", at: base + 10 * 60_000, equityUsd: 105, cashUsd: 50 },
      { agentId: "a", at: base + 20 * 60_000, equityUsd: 110, cashUsd: 20 },
    ]);
    expect(series).toEqual([
      { at: new Date(base + 10 * 60_000).toISOString(), equityUsd: 105, cashUsd: 50 },
      { at: new Date(base + 20 * 60_000).toISOString(), equityUsd: 110, cashUsd: 20 },
    ]);
  });

  it("stamps a shared bucket with the latest reading any agent made in it", () => {
    const base = Date.UTC(2026, 8, 20, 12, 0);
    const series = combineEquity([
      { agentId: "a", at: base + 2 * 60_000, equityUsd: 100, cashUsd: 10 },
      { agentId: "b", at: base + 13 * 60_000, equityUsd: 40, cashUsd: 40 },
    ]);
    expect(series).toEqual([{ at: new Date(base + 13 * 60_000).toISOString(), equityUsd: 140, cashUsd: 50 }]);
  });

  it("sums agents and carries the quiet ones forward", () => {
    const base = Date.UTC(2026, 8, 20, 12, 0);
    const series = combineEquity([
      { agentId: "a", at: base, equityUsd: 100, cashUsd: 10 },
      { agentId: "b", at: base, equityUsd: 40, cashUsd: 40 },
      { agentId: "a", at: base + 15 * 60_000, equityUsd: 120, cashUsd: 10 },
    ]);
    expect(series.map((p) => p.equityUsd)).toEqual([140, 160]);
    expect(series.map((p) => p.cashUsd)).toEqual([50, 50]);
  });

  it("is empty for no input", () => {
    expect(combineEquity([])).toEqual([]);
  });
});

describe("model pricing", () => {
  it("prices the models the builder offers", () => {
    expect(resolveModelPrice("claude-sonnet-5")).toEqual(MODEL_PRICES["claude-sonnet-5"]);
    expect(resolveModelPrice("claude-sonnet-5")).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10 });
    expect(resolveModelPrice("claude-opus-5")?.outputPerMTok).toBe(25);
    expect(resolveModelPrice("gpt-5")?.inputPerMTok).toBe(1.25);
  });

  /** One version is not another at a different price: the old prefix match read 5.5 as 5. */
  it("prices each version as itself", () => {
    expect(resolveModelPrice("claude-opus-5-5")).toMatchObject({ label: "Claude Opus 5.5", inputPerMTok: 4, outputPerMTok: 20 });
    expect(resolveModelPrice("claude-sonnet-5-5")).toMatchObject({ label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 });
    expect(resolveModelPrice("anthropic/claude-opus-5.5")?.inputPerMTok).toBe(4);
    expect(resolveModelPrice("gpt-5-mini")?.inputPerMTok).toBe(0.25);
    expect(resolveModelPrice("claude-opus-5-9")).toBeNull();
  });

  it("looks through an OpenRouter vendor prefix", () => {
    // OpenRouter resells at the same list price; only the label says where it came from.
    expect(resolveModelPrice("anthropic/claude-sonnet-5")).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10 });
    expect(resolveModelPrice("openai/gpt-5")).toEqual(MODEL_PRICES["gpt-5"]);
  });

  it("matches a dated snapshot either way round", () => {
    expect(resolveModelPrice("claude-haiku-4-5")?.inputPerMTok).toBe(1);
    expect(resolveModelPrice("claude-haiku-4-5-20251001")?.inputPerMTok).toBe(1);
  });

  it("says it does not know rather than guessing", () => {
    expect(resolveModelPrice("deepseek/deepseek-v4")).toBeNull();
    expect(resolveModelPrice("")).toBeNull();
    expect(resolveModelPrice(null)).toBeNull();
    expect(estimateModelSpendUsd("nousresearch/hermes-4-405b", { inputTokens: 1e6, outputTokens: 1e6 })).toBeNull();
  });

  it("charges input and output at their own rates, per million tokens", () => {
    // 2M in at $2, 0.5M out at $10 → $4 + $5.
    expect(estimateModelSpendUsd("claude-sonnet-5", { inputTokens: 2_000_000, outputTokens: 500_000 })).toBeCloseTo(
      9,
      10,
    );
    expect(estimateModelSpendUsd("claude-opus-5", { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("never turns a negative count into a credit", () => {
    expect(estimateModelSpendUsd("claude-sonnet-5", { inputTokens: -5_000_000, outputTokens: 1_000_000 })).toBe(10);
  });
});

/**
 * The same model id is sold by several hosts at different prices, and a host's own long
 * path is in no list but its own. A price is read where the tokens were bought.
 */
describe("model pricing, by provider", () => {
  const M = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

  it("prices one id at each host's own rate", () => {
    expect(resolveModelPrice("zai-org/GLM-5.3", "together")).toMatchObject({ inputPerMTok: 1.4, outputPerMTok: 4.4 });
    expect(resolveModelPrice("zai-org/GLM-5.3", "deepinfra")).toMatchObject({ inputPerMTok: 0.9, outputPerMTok: 4 });
    expect(estimateModelSpendUsd("zai-org/GLM-5.3", M, "together")).toBeCloseTo(5.8, 10);
    expect(estimateModelSpendUsd("zai-org/GLM-5.3", M, "deepinfra")).toBeCloseTo(4.9, 10);
    // Groq and Cerebras both sell GPT OSS 120B, under different ids and at different prices.
    expect(estimateModelSpendUsd("openai/gpt-oss-120b", M, "groq")).toBeCloseTo(0.75, 10);
    expect(estimateModelSpendUsd("gpt-oss-120b", M, "cerebras")).toBeCloseTo(1.1, 10);
  });

  it("prices a host's long model path", () => {
    expect(resolveModelPrice("accounts/fireworks/models/glm-5p3", "fireworks")).toMatchObject({
      label: "GLM 5.3",
      inputPerMTok: 1.4,
      outputPerMTok: 4.4,
    });
    expect(estimateModelSpendUsd("accounts/fireworks/models/kimi-k3", M, "fireworks")).toBeCloseTo(18, 10);
  });

  it("prices a model maker's own ids on its own key", () => {
    expect(resolveModelPrice("gemini-3.8-flash", "google")).toMatchObject({ inputPerMTok: 0.75, outputPerMTok: 3.75 });
    expect(resolveModelPrice("grok-4.7", "xai")).toMatchObject({ inputPerMTok: 2, outputPerMTok: 6 });
    expect(resolveModelPrice("deepseek-flash", "deepseek")).toMatchObject({ inputPerMTok: 0.3, outputPerMTok: 1.2 });
  });

  it("knows a free model from one with no price", () => {
    expect(estimateModelSpendUsd("glm-4.7-flash", M, "zai")).toBe(0);
    expect(estimateModelSpendUsd("glm-9", M, "zai")).toBeNull();
  });

  it("says it does not know rather than borrowing another host's price", () => {
    // Together lists this id. Fireworks, Groq and Anthropic do not.
    for (const provider of ["fireworks", "groq", "anthropic", "openrouter"]) {
      expect(resolveModelPrice("zai-org/GLM-5.3", provider)).toBeNull();
    }
    // Nor is a model maker's price read for another provider: Groq does not sell Gemini,
    // and Venice sells Claude Sonnet 5.5 under Anthropic's own id at its own, higher price.
    expect(resolveModelPrice("gemini-3.8-flash", "groq")).toBeNull();
    expect(resolveModelPrice("claude-sonnet-5-5", "venice")).toMatchObject({ inputPerMTok: 2.5, outputPerMTok: 12.5 });
    expect(resolveModelPrice("claude-sonnet-5-5", "anthropic")).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10 });
  });

  it("does not price a later provider's model when no provider is given", () => {
    for (const model of ["zai-org/GLM-5.3", "accounts/fireworks/models/glm-5p3", "gemini-3.8-flash", "grok-4.7", "kimi-k3"]) {
      expect(resolveModelPrice(model)).toBeNull();
      expect(estimateModelSpendUsd(model, M)).toBeNull();
    }
  });

  it("reads an unknown provider as no provider", () => {
    expect(resolveModelPrice("claude-sonnet-5", "constructor")).toEqual(resolveModelPrice("claude-sonnet-5"));
    expect(resolveModelPrice("zai-org/GLM-5.3", "nobody")).toBeNull();
    expect(resolveModelPrice("claude-sonnet-5", null)).toEqual(resolveModelPrice("claude-sonnet-5"));
  });

  /**
   * Nothing moves for an agent already on Anthropic, OpenAI or OpenRouter: every model
   * any of the three lists, asked about on any of the three, costs what it cost when no
   * provider was passed, and every other id is still unknown.
   */
  it("changes no price for the three providers the builder started with", () => {
    const three = ["anthropic", "openai", "openrouter"] as const;
    const ids = three.flatMap((provider) => CATALOGUE[provider].models.map((model) => model.id));
    expect(ids.length).toBeGreaterThan(40);
    for (const provider of three) {
      for (const id of ids) {
        const before = resolveModelPrice(id);
        const now = resolveModelPrice(id, provider);
        expect(before, id).not.toBeNull();
        expect([now?.inputPerMTok, now?.outputPerMTok], `${id} on ${provider}`).toEqual([before?.inputPerMTok, before?.outputPerMTok]);
        expect(estimateModelSpendUsd(id, M, provider)).toBe(estimateModelSpendUsd(id, M));
      }
      // On its own list a model keeps its name too.
      for (const model of CATALOGUE[provider].models) {
        expect(resolveModelPrice(model.id, provider)?.label).toBe(resolveModelPrice(model.id)?.label);
      }
      for (const id of ["deepseek/deepseek-v4", "nousresearch/hermes-4-405b", "claude-opus-5-9", "z-ai/glm-5.3", ""]) {
        expect(resolveModelPrice(id, provider), `${id} on ${provider}`).toBeNull();
      }
    }
  });
});

describe("what the same tokens would cost on the owner's own key", () => {
  it("prices a model the catalogue lists at the catalogue's price", () => {
    // Haiku 4.5, in the gateway's spelling, is the catalogue's own row.
    expect(ownKeyPrice("anthropic/claude-haiku-4.5")).toEqual(resolveModelPrice("claude-haiku-4-5"));
    expect(ownKeyPrice("openai/gpt-4.1-mini")).toMatchObject({ inputPerMTok: 0.4, outputPerMTok: 1.6 });
  });

  it("falls back to the pay-per-use table's list rate for a model the catalogue does not carry", () => {
    expect(resolveModelPrice("google/gemini-2.5-flash")).toBeNull();
    expect(ownKeyPrice("google/gemini-2.5-flash")).toMatchObject({ inputPerMTok: 0.3, outputPerMTok: 2.5 });
    expect(ownKeyPrice("some-model/nobody-lists")).toBeNull();
    expect(ownKeyPrice(null)).toBeNull();
  });

  /**
   * The comparison is with the model's maker. It reads no host's list, so a provider
   * being added cannot move what every pay-per-use model is compared against.
   */
  it("compares every pay-per-use model with its maker's price, whichever providers exist", () => {
    for (const offered of PAY_PER_USE_MODELS) {
      const price = ownKeyPrice(offered.id);
      expect(price, offered.id).not.toBeNull();
      const listed = resolveModelPrice(offered.id);
      expect([price?.inputPerMTok, price?.outputPerMTok], offered.id).toEqual(
        listed ? [listed.inputPerMTok, listed.outputPerMTok] : [offered.inputPerMTok, offered.outputPerMTok],
      );
    }
  });

  it("covers the same steps on both sides, and says how many it left out", () => {
    const compare = ownKeyComparison([
      { model: "google/gemini-2.5-flash", steps: 10, paidUsd: 0.5, inputTokens: 1_000_000, outputTokens: 20_000 },
      { model: "anthropic/claude-haiku-4.5", steps: 2, paidUsd: 0.3, inputTokens: 100_000, outputTokens: 10_000 },
      { model: "some-model/nobody-lists", steps: 3, paidUsd: 9, inputTokens: 5, outputTokens: 5 },
    ])!;
    expect(compare).toMatchObject({ steps: 12, inputTokens: 1_100_000, outputTokens: 30_000, unpricedSteps: 3 });
    expect(compare.ownKeyUsd).toBeCloseTo(0.3 + 0.05 + 0.1 + 0.05, 10);
    // The unpriced model's 9 dollars are in neither figure.
    expect(compare.paidUsd).toBeCloseTo(0.8, 10);
  });

  it("has nothing to say when no step can be priced", () => {
    expect(ownKeyComparison([])).toBeNull();
    expect(ownKeyComparison([{ model: "some-model/nobody-lists", steps: 4, paidUsd: 1, inputTokens: 1, outputTokens: 1 }])).toBeNull();
    expect(ownKeyComparison([{ model: "google/gemini-2.5-flash", steps: 0, paidUsd: 0, inputTokens: 0, outputTokens: 0 }])).toBeNull();
  });

  it("never turns a negative count into a credit", () => {
    const compare = ownKeyComparison([
      { model: "google/gemini-2.5-flash", steps: 1, paidUsd: -5, inputTokens: -1_000_000, outputTokens: -1_000_000 },
    ])!;
    expect(compare).toMatchObject({ ownKeyUsd: 0, paidUsd: 0, inputTokens: 0, outputTokens: 0 });
  });
});

describe("getMoney", () => {
  let db: Db;

  beforeAll(async () => {
    db = await setupTestDb();
  }, 120_000);

  async function snapshot(agentId: string, at: number, equityUsd: number, mode: "paper" | "live") {
    await db.insert(schema.equitySnapshots).values({
      id: nanoid(),
      agentId,
      equityUsd: toNumeric(equityUsd, 6),
      cashUsd: toNumeric(equityUsd, 6),
      at: new Date(at),
      mode,
    });
  }

  it("runs the bucketed snapshot query against a real Postgres", async () => {
    // The bucket expression sits in both SELECT and GROUP BY. Bound as a parameter, each
    // use is its own `$n` and Postgres rejects the query — the whole page 500'd on it.
    const { userId, agentId } = await seedAgent(db, { mode: "live" });
    const bucket = Math.floor(Date.now() / EQUITY_BUCKET_MS) * EQUITY_BUCKET_MS - EQUITY_BUCKET_MS;
    await snapshot(agentId, bucket + 60_000, 100, "live");
    await snapshot(agentId, bucket + 10 * 60_000, 112, "live");

    const money = await getMoney(userId);

    expect(money.equity).toHaveLength(1);
    expect(money.equity[0].equityUsd).toBe(112);
    expect(money.live[0]).toMatchObject({ equityUsd: 112, stale: true });
  });

  it("reads deposits and withdrawals as flows, not as the day's P&L", async () => {
    const { userId, agentId } = await seedAgent(db, { mode: "live" });
    const today = Math.floor(Date.now() / DAY) * DAY;
    const yesterday = today - DAY;
    await snapshot(agentId, yesterday + 12 * 3_600_000, 100, "live");
    // Today: $500 funded, $40 withdrawn, and the book closes at 575 — a $15 day.
    const at = Math.min(Date.now() - 60_000, today + 60_000);
    await db.insert(schema.agentFundingIntents).values({
      id: nanoid(),
      agentId,
      userId,
      chain: "base",
      asset: "usdc",
      amount: "500",
      status: "sent",
      toAddress: "0x0000000000000000000000000000000000000001",
      createdAt: new Date(at),
      settledAt: new Date(at),
    });
    await db.insert(schema.auditEvents).values([
      {
        id: nanoid(),
        userId,
        kind: "withdraw",
        agentId,
        summary: "Withdrew 40 USDC.",
        metadata: { chain: "base", asset: "usdc", amount: 40, to: "0x1", txHash: "0x2" },
        createdAt: new Date(at),
      },
      {
        // Fee settlement shares the kind, but it is a cost, not the owner taking money out.
        id: nanoid(),
        userId,
        kind: "withdraw",
        agentId,
        summary: "Settled fees.",
        metadata: { reason: "platform_fee_settlement", chain: "base", amountUsd: 0.3 },
        createdAt: new Date(at),
      },
    ]);
    await snapshot(agentId, Math.min(Date.now() - 30_000, today + 120_000), 575, "live");

    const money = await getMoney(userId);

    expect(money.today.flowUsd).toBeCloseTo(460, 6);
    expect(money.today.pnlUsd).toBeCloseTo(15, 6);
    // Postgres prints a timestamptz as "… +00", which `Date` cannot parse.
    expect(money.live[0].firstFundedAt).toBe(new Date(at).toISOString());
  });

  /** One paper agent that ran a million tokens each way on its owner's key. */
  async function agentOn(provider: string, model: string) {
    const llm = { ...C.llm, provider, model } as typeof C.llm;
    const { userId, agentId } = await seedAgent(db, { config: { llm } });
    await db.insert(schema.agentRuns).values({
      id: nanoid(),
      agentId,
      trigger: "schedule",
      status: "succeeded",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      llmSource: "key",
    });
    const [row] = (await getMoney(userId)).paper;
    return row;
  }

  it("estimates an agent's tokens at its own provider's price", async () => {
    // The same id, the same tokens, two hosts, two bills.
    const together = await agentOn("together", "zai-org/GLM-5.3");
    const deepinfra = await agentOn("deepinfra", "zai-org/GLM-5.3");
    expect(together).toMatchObject({ provider: "together", model: "zai-org/GLM-5.3" });
    expect(together.modelSpendUsd).toBeCloseTo(5.8, 6);
    expect(deepinfra.modelSpendUsd).toBeCloseTo(4.9, 6);

    const fireworks = await agentOn("fireworks", "accounts/fireworks/models/glm-5p3");
    expect(fireworks.modelSpendUsd).toBeCloseTo(5.8, 6);

    // A model its provider does not list is unknown, not priced from another host's row.
    const unlisted = await agentOn("fireworks", "zai-org/GLM-5.3");
    expect(unlisted.modelSpendUsd).toBeNull();
    expect(unlisted).toMatchObject({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
  });

  it("estimates an Anthropic, OpenAI or OpenRouter agent exactly as before", async () => {
    for (const [provider, model] of [
      ["anthropic", "claude-sonnet-5-5"],
      ["anthropic", "claude-haiku-4-5-20251001"],
      ["openai", "gpt-5-mini"],
      ["openrouter", "anthropic/claude-sonnet-5.5"],
      ["openrouter", "openai/gpt-5"],
      ["openrouter", "deepseek/deepseek-v4.1-flash"],
      ["openrouter", "z-ai/glm-5.3"],
    ] as const) {
      const row = await agentOn(provider, model);
      // What the page showed when the lookup took no provider: the id alone, in three lists.
      const before = estimateModelSpendUsd(model, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
      expect(row.modelSpendUsd, `${model} on ${provider}`).toBe(before);
      expect(row.provider).toBe(provider);
    }
  }, 60_000);
});
