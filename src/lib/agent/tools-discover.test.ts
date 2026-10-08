/**
 * `discover_tokens` and `finish`, when the model narrows a sweep to nothing.
 *
 * Seen live on 2026-10-08: the cheapest pay-per-use model swept "under 1h" on an agent
 * whose owner set a 30-minute minimum age, got an empty table, and finished. The run
 * succeeded, cost its owner two steps and the platform one launch radar, and did nothing.
 *
 * What is pinned here: the model's filters can only narrow the owner's; a narrowed sweep
 * that comes back thin is run once more under the owner's settings, without paying for
 * the launch radar again; and a tick about to end having looked at nothing is sent back
 * once, and only once. Nothing a tool says sends a tick to buy a radar it has already
 * bought: not a sweep's note, and not `finish` while a sweep is out or after one failed.
 *
 * The tools are the real ones on PGlite. Tokens come from the providers' fixtures
 * (`TOKENS_MOCK`), and the launch radar from the paid path in its mock mode, which
 * writes a payment row for every purchase: counting rows is counting payments.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { toNumeric } from "@/lib/money";
import { resetPriceCache } from "@/lib/trading/prices";
import { seedKnownTokens, tokenId, USDC_SOLANA } from "@/lib/trading/tokens";
import { newBudget } from "@/lib/x402/types";
import { DEFAULT_AGENT_CONFIG } from "./config";
import { MIN_SCORED_PER_TICK } from "./limits";
import { RunLogger } from "./logger";
import { describeResult } from "./narrate";
import { buildTools, type RunContext } from "./tools";
import { seedAgent, setupTestDb, type SeedConfigOverrides } from "./test-support";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BONK_ID = tokenId("solana", BONK);
const USDC_ID = tokenId("solana", USDC_SOLANA);
const BONK_PRICE = 0.0000027;

/** The call the owner's agent made, as the run recorded it. */
const PRODUCTION_CALL = { feeds: ["trending", "momentum"], chain: "solana", limit: 20, maxAgeHours: 1, minLiquidityUsd: 15_000 };

/**
 * One read `discover_tokens` makes after its sweep has paid for the launch radar. A test
 * sets the flag to make that read fail once, which is a sweep that paid and never came back.
 */
const fault = vi.hoisted(() => ({ readAfterSweepFails: false }));

vi.mock("@/lib/trading/proposals", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/trading/proposals")>();
  return {
    ...real,
    pendingProposalTokenIds: async (agentId: string) => {
      if (fault.readAfterSweepFails) {
        fault.readAfterSweepFails = false;
        throw new Error("db connection reset");
      }
      return real.pendingProposalTokenIds(agentId);
    },
  };
});

let db: Db;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

beforeEach(() => {
  fault.readAfterSweepFails = false;
  // A held position is marked, and a paper sell is priced, from Jupiter. Keep both offline.
  resetPriceCache();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/ultra/v1/order")) {
      const amount = Number(new URL(url).searchParams.get("amount"));
      const out = (amount / 1e6 / BONK_PRICE) * 10 ** 5;
      return new Response(JSON.stringify({ requestId: "req", transaction: null, inAmount: String(amount), outAmount: String(Math.round(out)) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("api.jup.ag/price/v3")) {
      return new Response(JSON.stringify({ [BONK]: { usdPrice: BONK_PRICE } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

type ToolExec = (input: unknown, options: unknown) => Promise<Record<string, unknown>>;
type Row = {
  symbol: string;
  chain: "solana" | "base";
  address: string;
  origin: string;
  liquidityUsd: number | null;
  ageHours: number | null;
  seen: string | null;
};

const universe = (over: Partial<typeof DEFAULT_AGENT_CONFIG.universe> = {}) => ({ ...DEFAULT_AGENT_CONFIG.universe, ...over });

/** One tick's tools for a freshly seeded Solana paper agent, called the way the AI SDK would. */
async function tick(config: SeedConfigOverrides = {}, seed: { paperStartingUsd?: string } = {}) {
  const { agentId } = await seedAgent(db, { config: { chains: ["solana"], dataSources: [], ...config }, ...seed });
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
  if (!agent) throw new Error("agent missing");
  const runId = `run-${agentId.slice(0, 8)}`;
  await db.insert(schema.agentRuns).values({ id: runId, agentId, trigger: "manual", status: "running", startedAt: new Date() });
  const budget = newBudget(agent.config.risk.maxDataSpendUsdPerRun);
  const ctx: RunContext = {
    runId,
    agent: { id: agent.id, ownerId: agent.ownerId, slug: agent.slug, name: agent.name, mode: agent.mode, config: agent.config },
    x402: { agentId: agent.id, runId, mode: agent.mode, wallets: [], budget },
    budget,
    logger: new RunLogger(runId),
    finished: { summary: null },
    tradeIds: [],
    postIds: [],
  };
  const tools = buildTools(ctx);
  const call = (name: string) => {
    const execute = tools[name]?.execute as unknown as ToolExec | undefined;
    if (!execute) throw new Error(`${name} is not registered`);
    return (input: unknown = {}) => execute(input, { toolCallId: `call_${name}`, messages: [] });
  };
  return {
    agentId,
    ownerId: agent.ownerId,
    ctx,
    budget,
    tools,
    discover: call("discover_tokens"),
    review: call("review_positions"),
    trade: call("place_trade"),
    finish: () => call("finish")({ summary: "Nothing cleared the bar this tick." }),
    /** Launch radars paid for by this agent, by source. */
    radars: async () =>
      (await db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId))).map((row) => row.sourceId).sort(),
  };
}

const rows = (result: Record<string, unknown>) => result.candidates as Row[];
const symbols = (result: Record<string, unknown>) => rows(result).map((row) => row.symbol);

/**
 * Runs `body` with these tokens scored 20 minutes ago, by anyone: the score cache is
 * shared, and a token scored inside the seen window is not fresh research for any agent.
 */
async function withSeen(seen: readonly Row[], body: () => Promise<void>) {
  const ids = seen.map((row) => `${row.chain}:${row.address}`);
  await db.delete(schema.tokenScores).where(inArray(schema.tokenScores.id, ids));
  await db.insert(schema.tokenScores).values(
    seen.map((row) => ({
      id: `${row.chain}:${row.address}`,
      chain: row.chain,
      address: row.address,
      symbol: row.symbol,
      total: "55.00",
      verdict: "watch" as const,
      components: {},
      blockers: [],
      warnings: [],
      sources: ["jupiter"],
      scoredAt: new Date(Date.now() - 20 * 60_000),
    })),
  );
  try {
    await body();
  } finally {
    await db.delete(schema.tokenScores).where(inArray(schema.tokenScores.id, ids));
  }
}

describe("discover_tokens: the model's filters only narrow the owner's", () => {
  it("raises a liquidity floor below the owner's to the owner's, and says so", async () => {
    const own = await (await tick()).discover({});
    const asked = await (await tick()).discover({ minLiquidityUsd: 0 });

    expect(asked.ok).toBe(true);
    expect(symbols(asked)).toEqual(symbols(own));
    for (const row of rows(asked)) if (row.liquidityUsd !== null) expect(row.liquidityUsd, row.symbol).toBeGreaterThanOrEqual(15_000);
    // Not a narrowing, so nothing was widened; the model is told what was applied.
    expect(asked.widened).toBeUndefined();
    expect(String(asked.note)).toContain("minLiquidityUsd was raised to your owner's floor of $15K");
    expect(String(own.note)).not.toContain("was raised");
  });

  it("lowers an age ceiling past the owner's maximum age to it, and says so", async () => {
    const config = { universe: universe({ maxAgeHours: 2 }) };
    const own = await (await tick(config)).discover({});
    const asked = await (await tick(config)).discover({ maxAgeHours: 500 });

    expect(symbols(own).length).toBeGreaterThan(0);
    expect(symbols(asked)).toEqual(symbols(own));
    for (const row of rows(asked)) if (row.ageHours !== null) expect(row.ageHours, row.symbol).toBeLessThanOrEqual(2);
    expect(asked.widened).toBeUndefined();
    expect(String(asked.note)).toContain("maxAgeHours was lowered to your owner's maximum age of 2h");
  });

  it("leaves a narrower sweep alone when it finds enough fresh candidates", async () => {
    const t = await tick();
    const narrow = await t.discover({ minLiquidityUsd: 1_000_000 });

    expect(Number(narrow.freshCount)).toBeGreaterThanOrEqual(MIN_SCORED_PER_TICK);
    expect(narrow.widened).toBeUndefined();
    expect(narrow.matchedYourFilters).toBeUndefined();
    // BONK has $996K of liquidity: inside the owner's floor, outside the model's.
    expect(symbols(narrow)).not.toContain("BONK");
    for (const row of rows(narrow)) if (row.liquidityUsd !== null) expect(row.liquidityUsd, row.symbol).toBeGreaterThanOrEqual(1_000_000);
    expect(String(narrow.rendered).startsWith("  #  SYMBOL")).toBe(true);
    // It has enough to score, so it is not sent to sweep again: every sweep buys the
    // launch radar, and that one would buy the radar this one has just bought.
    expect(narrow.note).toBe(`quickScore is a cheap pre-rank, not the real score. Score at least ${MIN_SCORED_PER_TICK} of the fresh candidates before deciding.`);
    expect(await t.radars()).toEqual(["solenrich-launches"]);
  });

  it("never sends a sweep that found enough to sweep again, whatever it narrowed", async () => {
    // The owner's feeds include new_launches, so the first of these leaves a feed out.
    for (const call of [{ feeds: ["trending", "momentum"] }, { maxAgeHours: 80_000 }, { minLiquidityUsd: 1_000_000 }, {}]) {
      const t = await tick();
      const result = await t.discover(call);
      expect(Number(result.freshCount), JSON.stringify(call)).toBeGreaterThanOrEqual(MIN_SCORED_PER_TICK);
      expect(`${result.note} ${result.rendered}`, JSON.stringify(call)).not.toMatch(/call discover_tokens|no arguments|sweep again/i);
      expect(await t.radars()).toEqual(["solenrich-launches"]);
    }
  });

  it("says a round liquidity figure in full", async () => {
    // "$1K" is what a $100,000 floor read as: the owner's own rule, misstated to the model.
    const strict = await tick({ universe: universe({ minLiquidityUsd: 100_000 }) });
    expect(String((await strict.discover({ minLiquidityUsd: 50_000 })).note)).toContain(
      "minLiquidityUsd was raised to your owner's floor of $100K. A token outside your owner's settings can never be bought.",
    );
    const asked = await (await tick()).discover({ minLiquidityUsd: 100_000_000 });
    expect(String(asked.note)).toContain("Your filters ($100M+ liquidity) matched ");
  });

  it("does not count a feed list that covers the owner's feeds as a narrowing", async () => {
    const t = await tick({ universe: universe({ maxAgeHours: 0.4 }) });
    // Nothing is inside a 0.4h ceiling over a 30-minute minimum age, so the table is empty
    // either way; a narrowing would have been widened, and this is not one.
    const swept = await t.discover({ feeds: ["new_launches", "trending", "top_organic"] });
    expect(swept.freshCount).toBe(0);
    expect(swept.widened).toBeUndefined();
    expect(await t.radars()).toEqual(["solenrich-launches"]);
  });
});

describe("discover_tokens: a narrowed sweep that comes back thin widens itself", () => {
  it("returns the owner's candidates for the call that ended the owner's tick, and pays for the radar once", async () => {
    const t = await tick();
    const result = await t.discover(PRODUCTION_CALL);

    expect(result).toMatchObject({ ok: true, widened: true, chains: ["solana"] });
    // In the fixtures one launch is 41 minutes old, so the model's filters match it alone.
    expect(result.matchedYourFilters).toBe(1);
    expect(rows(result)[0]).toMatchObject({ symbol: "GLMP", origin: "paid_launches" });
    expect(Number(result.freshCount)).toBeGreaterThanOrEqual(MIN_SCORED_PER_TICK);
    expect(Number(result.count)).toBeLessThanOrEqual(PRODUCTION_CALL.limit);
    expect(new Set(symbols(result)).size).toBe(symbols(result).length);
    // Years old: only the owner's settings, which set no maximum age, let it in.
    expect(symbols(result)).toContain("BONK");
    // The feed the model left out was swept too.
    expect(result.feeds).toEqual(["trending", "momentum", "gecko_launches", "paid_launches", "new_launches"]);

    const said =
      "Your filters (under 1h, feeds trending + momentum) matched 1 fresh token, so this table also includes what a sweep with your owner's settings alone found. The tokens your filters matched are listed first.";
    expect(String(result.rendered).startsWith(`${said}\n\n  #  SYMBOL`)).toBe(true);
    expect(result.note).toBe(`${said} quickScore is a cheap pre-rank, not the real score. Score at least ${MIN_SCORED_PER_TICK} of the fresh candidates before deciding.`);

    // One payment, and the second sweep still read the radar: PLNK is a paid launch
    // 1.6 hours old, which the model's "under 1h" refused and the owner's settings allow.
    expect(await t.radars()).toEqual(["solenrich-launches"]);
    expect(t.budget.spentUsd).toBeCloseTo(0.012, 6);
    expect(rows(result).find((row) => row.symbol === "PLNK")).toMatchObject({ origin: "paid_launches", ageHours: 1.6 });

    expect(describeResult("discover_tokens", result)).toBe(
      `1 fresh matched the agent's filters · widened to the configured settings: ${result.freshCount} fresh candidates · 5 feeds`,
    );
  });

  it("says so when the model's filters match nothing at all", async () => {
    const t = await tick();
    const result = await t.discover({ maxAgeHours: 0.6 });

    expect(result).toMatchObject({ ok: true, widened: true, matchedYourFilters: 0 });
    expect(Number(result.freshCount)).toBeGreaterThanOrEqual(MIN_SCORED_PER_TICK);
    expect(String(result.note)).toContain(
      "Your filters (under 36m) matched 0 fresh tokens, so this table also includes what a sweep with your owner's settings alone found. quickScore",
    );
    expect(await t.radars()).toEqual(["solenrich-launches"]);
  });

  it("pays for nothing when it widens, on a chain the model had left out either", async () => {
    const t = await tick({ chains: ["solana", "base"] });
    const result = await t.discover({ chain: "solana", maxAgeHours: 0.6 });

    expect(result).toMatchObject({ ok: true, widened: true, matchedYourFilters: 0, chains: ["solana", "base"] });
    expect(String(result.rendered)).toContain("Your filters (under 36m, solana only) matched 0 fresh tokens");
    // Solana's radar was bought by the narrow sweep and read again. Base's never was, and
    // the widening does not buy it: a later sweep of Base would pay for it a second time.
    expect(await t.radars()).toEqual(["solenrich-launches"]);
    expect(t.budget.spentUsd).toBeCloseTo(0.012, 6);
    expect(rows(result).filter((row) => row.origin === "paid_launches").map((row) => row.chain)).toEqual(["solana", "solana", "solana"]);

    // That later sweep buys Base's radar once, as any sweep of Base does.
    const base = await t.discover({ chain: "base" });
    expect(rows(base).some((row) => row.chain === "base" && row.origin === "paid_launches")).toBe(true);
    expect(await t.radars()).toEqual(["gate402-base-radar", "solenrich-launches"]);
  });

  it("says that the owner's settings found nothing either, and lets the tick end", async () => {
    const t = await tick({ universe: universe({ maxAgeHours: 0.4 }) });
    const result = await t.discover({ maxAgeHours: 0.3 });

    expect(result).toMatchObject({ ok: true, widened: true, matchedYourFilters: 0, freshCount: 0, count: 0 });
    const said =
      "Your filters (under 18m) matched 0 fresh tokens. The sweep was run again with your owner's settings alone and also found 0 fresh tokens. There is nothing new to score this tick; that is a valid result.";
    expect(String(result.rendered).startsWith(said)).toBe(true);
    expect(result.note).toBe(`${said} quickScore is a cheap pre-rank, not the real score. There are no fresh candidates to score.`);
    expect(describeResult("discover_tokens", result)).toBe(
      "0 fresh matched the agent's filters · widened to the configured settings: 0 fresh candidates · 4 feeds",
    );
    expect(await t.radars()).toEqual(["solenrich-launches"]);

    // The owner's own sweep came back empty: a real answer, so finish is not refused.
    expect(await t.finish()).toMatchObject({ ok: true });
    expect(t.ctx.finished.summary).not.toBeNull();
  });

  it("does not sweep the owner's settings twice in one tick", async () => {
    const t = await tick();
    const first = await t.discover({});
    const second = await t.discover({ maxAgeHours: 0.6 });

    expect(Number(first.freshCount)).toBeGreaterThanOrEqual(MIN_SCORED_PER_TICK);
    expect(second.widened).toBeUndefined();
    expect(second.count).toBe(0);
    expect(String(second.note)).toContain(
      "Your filters (under 36m) matched 0 fresh tokens. A sweep with your owner's settings alone already ran this tick, so it was not run again.",
    );
  });

  it("does not call a table thin because the model's own limit is low", async () => {
    for (const call of [{ minLiquidityUsd: 1_000_000 }, { feeds: ["trending"] }]) {
      const t = await tick();
      const result = await t.discover({ ...call, limit: 3 });

      // Three rows were asked for and three matched: the table is full, not thin.
      expect(result, JSON.stringify(call)).toMatchObject({ ok: true, count: 3, freshCount: 3 });
      expect(result.widened).toBeUndefined();
      expect(result.matchedYourFilters).toBeUndefined();
      expect(String(result.rendered).startsWith("  #  SYMBOL")).toBe(true);
      expect(result.note).toBe("quickScore is a cheap pre-rank, not the real score. Score all 3 fresh candidates before deciding.");
      expect(describeResult("discover_tokens", result)).toMatch(/^3 fresh candidates · \d feeds$/);
    }
    // Two tokens in the fixtures hold $100M of liquidity. Two were asked for, so two is a
    // full table, though it is under the five a tick is held to.
    const deep = await tick();
    const two = await deep.discover({ minLiquidityUsd: 100_000_000, limit: 2 });
    expect(two).toMatchObject({ ok: true, count: 2, freshCount: 2 });
    expect(two.widened).toBeUndefined();
    expect(two.note).toBe("quickScore is a cheap pre-rank, not the real score. Score all 2 fresh candidates before deciding.");
    expect(await deep.radars()).toEqual(["solenrich-launches"]);

    // A limit the filters cannot fill is still thin, and the room left is the owner's rows.
    const t = await tick();
    const thin = await t.discover({ maxAgeHours: 1, limit: 3 });
    expect(thin).toMatchObject({ ok: true, widened: true, matchedYourFilters: 1, count: 3, freshCount: 3 });
    expect(symbols(thin)[0]).toBe("GLMP");
  });

  it("counts what the filters matched before the table is cut, not after", async () => {
    const pool = rows(await (await tick()).discover({ minLiquidityUsd: 1_000_000 }));
    expect(pool.length).toBeGreaterThanOrEqual(9);

    // The four names at the top of that table have been scored already. Cut to five rows
    // first, the table held four seen names and one fresh one, read as "matched 1", and was
    // padded with tokens outside the filter while five that matched sat past the cut.
    await withSeen(pool.slice(0, 4), async () => {
      const t = await tick();
      const result = await t.discover({ minLiquidityUsd: 1_000_000, limit: 5 });

      expect(result).toMatchObject({ ok: true, count: 5, freshCount: 5 });
      expect(result.widened).toBeUndefined();
      expect(symbols(result)).toEqual(pool.slice(4, 9).map((row) => row.symbol));
      for (const row of rows(result)) if (row.liquidityUsd !== null) expect(row.liquidityUsd, row.symbol).toBeGreaterThanOrEqual(1_000_000);
    });
  });

  it("finds the fresh candidates past the names already seen, and does not call the tick empty", async () => {
    const own = rows(await (await tick()).discover({}));
    expect(own.length).toBeGreaterThanOrEqual(6);

    // The top of the owner's table was scored 20 minutes ago. Cut to the model's limit
    // before freshness was known, the widened table was those three seen names, the model
    // was told "There is nothing new to score this tick" and `finish` let the tick end.
    await withSeen(own.slice(0, 3), async () => {
      const t = await tick();
      const result = await t.discover({ maxAgeHours: 0.6, limit: 3 });

      expect(result).toMatchObject({ ok: true, widened: true, matchedYourFilters: 0, count: 3, freshCount: 3 });
      expect(symbols(result)).toEqual(own.slice(3, 6).map((row) => row.symbol));
      expect(String(result.note)).not.toContain("nothing new");
      expect(String(result.note)).toContain(
        "Your filters (under 36m) matched 0 fresh tokens, so this table also includes what a sweep with your owner's settings alone found.",
      );
      expect(await t.finish()).toMatchObject({ ok: false, nudged: true, unscored: symbols(result) });
      expect(await t.radars()).toEqual(["solenrich-launches"]);

      // The same for a sweep with no filters: fresh rows are not hidden behind seen ones.
      const plain = await (await tick()).discover({ limit: 3 });
      expect(plain).toMatchObject({ ok: true, count: 3, freshCount: 3 });
      expect(symbols(plain)).toEqual(own.slice(3, 6).map((row) => row.symbol));
    });
  });
});

describe("discover_tokens: what the model is told", () => {
  it("never tells it to widen a sweep with its filters", async () => {
    const t = await tick();
    const tool = t.tools.discover_tokens;
    const declared = `${tool?.description} ${JSON.stringify(z.toJSONSchema(tool?.inputSchema as z.ZodType))}`;
    expect(declared).not.toMatch(/widen/i);
    expect(declared).toContain("Call it with no arguments first");
    expect(declared).toContain("only NARROW the sweep");
    expect(declared).toContain("drop them or try other feeds");

    const empty = await (await tick({ universe: universe({ maxAgeHours: 0.4 }) })).discover({});
    for (const result of [await t.discover({}), empty]) expect(`${result.note} ${result.rendered}`).not.toMatch(/widen/i);
    expect(empty.note).toBe(
      "quickScore is a cheap pre-rank, not the real score. There are no fresh candidates to score. This sweep already used your owner's settings with no extra filters. maxAgeHours and minLiquidityUsd only narrow a sweep, so they cannot find more; only other feeds can. Finding nothing new is a valid result.",
    );

    // A table that filled its limit is not called the whole of what there is.
    const short = await (await tick()).discover({ limit: 3 });
    expect(short.note).toBe(
      "quickScore is a cheap pre-rank, not the real score. Score all 3 fresh candidates before deciding. This sweep already used your owner's settings with no extra filters and stopped at its limit of 3 rows. maxAgeHours and minLiquidityUsd only narrow a sweep, so they cannot find more; a higher limit or other feeds can.",
    );
  });
});

describe("finish: a tick about to end having looked at nothing", () => {
  it("is sent back once to sweep with no arguments, and only once", async () => {
    const t = await tick();

    const first = await t.finish();
    expect(first).toMatchObject({ ok: false, nudged: true, notSwept: true });
    expect(first.reason).toBe(
      "Not yet. No token sweep with your owner's settings has come back this tick. Call discover_tokens with no arguments, score what it returns with score_token, then call finish again.",
    );
    expect(t.ctx.finished.summary).toBeNull();
    expect(describeResult("finish", first)).toBe("Sent back — no sweep under the configured settings had come back this tick");

    expect(await t.finish()).toMatchObject({ ok: true });
    expect(t.ctx.finished.summary).toBe("Nothing cleared the bar this tick.");
  });

  it("is never sent back a second time for research, whatever the sweep then surfaces", async () => {
    const t = await tick();
    expect(await t.finish()).toMatchObject({ ok: false, notSwept: true });

    const swept = await t.discover({});
    expect(Number(swept.freshCount)).toBeGreaterThanOrEqual(MIN_SCORED_PER_TICK);
    // Fresh candidates it has not scored would send another tick back. This one has been.
    expect(await t.finish()).toMatchObject({ ok: true });
  });

  it("is sent back when the only sweep it made did not come back", async () => {
    const t = await tick();
    expect(await t.discover({ chain: "base" })).toMatchObject({ ok: false });
    expect(await t.finish()).toMatchObject({ ok: false, nudged: true, notSwept: true });
    expect(await t.finish()).toMatchObject({ ok: true });
  });

  it("ends at once when a sweep under the owner's settings found nothing", async () => {
    const t = await tick({ universe: universe({ maxAgeHours: 0.4 }) });
    expect(await t.discover({})).toMatchObject({ ok: true, freshCount: 0 });
    expect(await t.finish()).toMatchObject({ ok: true });
  });

  /**
   * One step's tool calls run side by side. Judged while the sweep was still out, `finish`
   * said no sweep had come back and ordered another, which bought the same radar again.
   */
  it("waits for a sweep called in the same step, and judges the tick on its table", async () => {
    for (const finishFirst of [false, true]) {
      const t = await tick();
      const [swept, finished] = finishFirst
        ? (await Promise.all([t.finish(), t.discover({})])).reverse()
        : await Promise.all([t.discover({}), t.finish()]);
      if (!swept || !finished) throw new Error("a tool did not answer");

      expect(Number(swept.freshCount)).toBeGreaterThanOrEqual(MIN_SCORED_PER_TICK);
      // Sent back for the candidates the sweep surfaced, not to sweep a second time.
      expect(finished).toMatchObject({ ok: false, nudged: true, unscored: symbols(swept) });
      expect(finished.notSwept).toBeUndefined();
      expect(String(finished.reason)).not.toContain("discover_tokens");
      expect(await t.radars()).toEqual(["solenrich-launches"]);
      // Once per tick still: the second finish ends it.
      expect(await t.finish()).toMatchObject({ ok: true });
    }
  });

  it("is not sent to sweep again when its sweep paid for the radar and then failed", async () => {
    const t = await tick();
    fault.readAfterSweepFails = true;
    expect(await t.discover({})).toMatchObject({ ok: false, reason: "db connection reset" });
    expect(await t.radars()).toEqual(["solenrich-launches"]);

    // Nothing scored, no candidate surfaced and the agent can buy. A sweep ordered from
    // here would buy the radar this tick has already paid for, so the tick ends.
    expect(await t.finish()).toMatchObject({ ok: true });
    expect(await t.radars()).toEqual(["solenrich-launches"]);
    expect(t.budget.spentUsd).toBeCloseTo(0.012, 6);
  });

  /** Looking after the book says nothing about what is new, so such a tick is sent back like any other. */
  it("is sent back when it only managed its positions and can still buy", async () => {
    const holding = async () => {
      const t = await tick();
      await db.insert(schema.positions).values({
        agentId: t.agentId,
        tokenId: BONK_ID,
        amountToken: "10000000.000000000000",
        avgCostUsd: "0.000003000000",
        openedAt: new Date(Date.now() - 5 * 3_600_000),
      });
      return t;
    };

    const reviewed = await holding();
    expect(await reviewed.review()).toMatchObject({ ok: true, count: 1 });
    expect(await reviewed.finish()).toMatchObject({ ok: false, nudged: true, notSwept: true });
    expect(await reviewed.finish()).toMatchObject({ ok: true });

    const sold = await holding();
    expect(
      await sold.trade({ chain: "solana", side: "sell", tokenAddress: BONK, amountUsd: 5, rationale: "Score fell from 74 to 41 on thinning liquidity; closing part." }),
    ).toMatchObject({ ok: true, status: "filled", side: "sell" });
    expect(await sold.finish()).toMatchObject({ ok: false, nudged: true, notSwept: true });
    expect(await sold.finish()).toMatchObject({ ok: true });
  });

  /** Research that can only end in a refusal is the owner's steps and the platform's data spent for nothing. */
  it("is let go when it cannot buy: no cash, no buy left today, or trading paused", async () => {
    const broke = await tick({}, { paperStartingUsd: "0" });
    expect(await broke.review()).toMatchObject({ ok: true });
    expect(await broke.finish()).toMatchObject({ ok: true });

    const spent = await tick({ risk: { maxDailyTrades: 1 } });
    await db.insert(schema.trades).values({
      id: nanoid(),
      agentId: spent.agentId,
      ownerId: spent.ownerId,
      chain: "solana",
      side: "buy",
      tokenId: BONK_ID,
      quoteTokenId: USDC_ID,
      amountToken: toNumeric(1_000_000, 12),
      amountUsd: toNumeric(2.7, 6),
      priceUsd: toNumeric(BONK_PRICE, 12),
      feeUsd: toNumeric(0, 6),
      status: "filled",
      filledAt: new Date(),
      isPaper: true,
    });
    expect(await spent.finish()).toMatchObject({ ok: true });

    const paused = await tick();
    await db.insert(schema.userSecurity).values({ userId: paused.ownerId, tradingPaused: true, tradingPausedAt: new Date() });
    expect(await paused.finish()).toMatchObject({ ok: true });
  });

  /**
   * A few cents of cash is a ticket the guard would pass, and one that leaves the book
   * the moment it fills: a position under a quarter of a dollar is dust, and no exit
   * rule watches it. That is not a buy worth a sweep and its paid signals.
   */
  it("is let go when all its cash would buy is dust, and sent back from the first ticket that is not", async () => {
    const roomy = { risk: { maxPositionPct: 100 } };
    const dust = await tick(roomy, { paperStartingUsd: "0.20" });
    expect(await dust.finish()).toMatchObject({ ok: true });

    const enough = await tick(roomy, { paperStartingUsd: "0.30" });
    expect(await enough.finish()).toMatchObject({ ok: false, nudged: true, notSwept: true });
  });
});
