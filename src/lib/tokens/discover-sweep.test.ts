/**
 * One sweep's filters, and the paid launch radar across two sweeps.
 *
 * The free feeds are the providers' fixtures (`TOKENS_MOCK`), with `now` pinned so a
 * fixture's age does not drift. The radar is a stand-in that counts how often it is
 * asked: every ask is a payment, so the count is the thing under test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chain, TokenCandidate } from "@/server/types";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { newBudget, type X402Context } from "@/lib/x402/types";
import solEnrichLaunches from "@/lib/data-sources/fixtures/solenrich-launches.json";
import gate402Launches from "@/lib/data-sources/fixtures/gate402-launches.json";

const radar = vi.hoisted(() => ({ asked: [] as Array<{ id: string; minLiquidityUsd: unknown }>, fails: false }));

vi.mock("@/lib/data-sources/registry", () => ({
  getDataSource: (id: string) => ({
    id,
    query: async (_ctx: unknown, input: { minLiquidityUsd?: unknown }) => {
      radar.asked.push({ id, minLiquidityUsd: input.minLiquidityUsd });
      if (radar.fails) throw new Error("the radar answered 500 after payment");
      return { summary: "", data: id === "solenrich-launches" ? solEnrichLaunches : gate402Launches };
    },
  }),
}));

const { discoverCandidates, isSuperFresh, sweepFilters } = await import("./discover");

/** The Jupiter fixture's newest mints are about eight days old at this moment, and its top-traded names months or years. */
const NOW = Date.parse("2026-09-20T00:00:00.000Z");
const OWNER = DEFAULT_AGENT_CONFIG.universe;
const universe = (over: Partial<typeof OWNER> = {}) => ({ ...OWNER, ...over });
const ids = (candidates: readonly TokenCandidate[]) => candidates.map((c) => c.token.id).sort();
const symbols = (candidates: readonly TokenCandidate[]) => candidates.map((c) => c.token.symbol).sort();

beforeEach(() => {
  radar.asked.length = 0;
  radar.fails = false;
});

describe("sweepFilters", () => {
  it("is the owner's own floor and ceiling when nothing is asked", () => {
    expect(sweepFilters(universe(), {})).toEqual({ minLiquidityUsd: 15_000, maxAgeHours: null });
    expect(sweepFilters(universe({ maxAgeHours: 24 }), { maxAgeHours: null })).toEqual({ minLiquidityUsd: 15_000, maxAgeHours: 24 });
  });

  it("raises a floor below the owner's to it, and keeps a higher one", () => {
    expect(sweepFilters(universe(), { minLiquidityUsd: 0 }).minLiquidityUsd).toBe(15_000);
    expect(sweepFilters(universe(), { minLiquidityUsd: 14_999 }).minLiquidityUsd).toBe(15_000);
    expect(sweepFilters(universe(), { minLiquidityUsd: 15_000 }).minLiquidityUsd).toBe(15_000);
    expect(sweepFilters(universe(), { minLiquidityUsd: 250_000 }).minLiquidityUsd).toBe(250_000);
  });

  it("lowers a ceiling past the owner's to it, and keeps a tighter one", () => {
    expect(sweepFilters(universe({ maxAgeHours: 24 }), { maxAgeHours: 500 }).maxAgeHours).toBe(24);
    expect(sweepFilters(universe({ maxAgeHours: 24 }), { maxAgeHours: 6 }).maxAgeHours).toBe(6);
    // No maximum age set by the owner: any ceiling is a narrowing, so it stands.
    expect(sweepFilters(universe(), { maxAgeHours: 1 }).maxAgeHours).toBe(1);
  });

  it("reads a value that is not a number as nothing asked", () => {
    expect(sweepFilters(universe({ maxAgeHours: 24 }), { minLiquidityUsd: Number.NaN, maxAgeHours: Number.NaN })).toEqual({
      minLiquidityUsd: 15_000,
      maxAgeHours: 24,
    });
  });

  it("still reaches the super-fresh window, with or without an owner's ceiling", () => {
    expect(isSuperFresh(sweepFilters(universe(), { maxAgeHours: 0.25 }).maxAgeHours)).toBe(true);
    expect(isSuperFresh(sweepFilters(universe({ maxAgeHours: 24 }), { maxAgeHours: 0.2 }).maxAgeHours)).toBe(true);
    expect(isSuperFresh(sweepFilters(universe({ maxAgeHours: 24 }), { maxAgeHours: 500 }).maxAgeHours)).toBe(false);
  });
});

describe("discoverCandidates: a sweep's own filters", () => {
  const free = { chains: ["solana"] as Chain[], feeds: ["new_launches", "trending"] as const, limit: 100, now: NOW };

  it("never lists a token under the owner's liquidity floor, whatever floor is asked for", async () => {
    // No holder or age gate, so liquidity is the only thing that can keep a new mint out.
    const owner = universe({ minHolderCount: 0, minAgeMinutes: 0 });
    const own = await discoverCandidates({ ...free, universe: owner });
    const asked = await discoverCandidates({ ...free, universe: owner, minLiquidityUsd: 0 });

    expect(own.length).toBeGreaterThan(0);
    expect(ids(asked)).toEqual(ids(own));
    for (const c of asked) if (c.liquidityUsd !== null) expect(c.liquidityUsd, c.token.symbol).toBeGreaterThanOrEqual(15_000);

    // The fixtures do hold thinner tokens: an owner who sets no floor is shown them.
    const noFloor = await discoverCandidates({ ...free, universe: { ...owner, minLiquidityUsd: 0 } });
    expect(noFloor.some((c) => c.liquidityUsd !== null && c.liquidityUsd < 15_000)).toBe(true);
  });

  it("never lists a token past the owner's maximum age, whatever ceiling is asked for", async () => {
    const owner = universe({ minHolderCount: 0, maxAgeHours: 480 });
    const own = await discoverCandidates({ ...free, universe: owner });
    const asked = await discoverCandidates({ ...free, universe: owner, maxAgeHours: 87_600 });

    expect(own.length).toBeGreaterThan(0);
    expect(ids(asked)).toEqual(ids(own));
    for (const c of asked) if (c.ageHours !== null) expect(c.ageHours, c.token.symbol).toBeLessThanOrEqual(480);

    // And the fixtures do hold older ones: with no maximum age BONK is listed.
    expect(symbols(await discoverCandidates({ ...free, universe: universe({ minHolderCount: 0 }) }))).toContain("BONK");
    expect(symbols(asked)).not.toContain("BONK");
  });

  it("still narrows when the value asked for is tighter than the owner's", async () => {
    const own = await discoverCandidates({ ...free, universe: universe() });
    const deep = await discoverCandidates({ ...free, universe: universe(), minLiquidityUsd: 5_000_000 });
    const young = await discoverCandidates({ ...free, universe: universe(), maxAgeHours: 1 });

    expect(deep.length).toBeGreaterThan(0);
    expect(deep.length).toBeLessThan(own.length);
    for (const c of deep) if (c.liquidityUsd !== null) expect(c.liquidityUsd, c.token.symbol).toBeGreaterThanOrEqual(5_000_000);
    expect(young).toEqual([]);
  });
});

describe("discoverCandidates: the paid launch radar across two sweeps", () => {
  const x402: X402Context = { agentId: "agent", runId: null, mode: "paper", wallets: [], budget: newBudget(1) };
  const paid = { universe: universe(), feeds: ["paid_launches"] as const, x402, alwaysPaidLaunches: true, now: NOW };

  it("is bought once when both sweeps are handed the same record, and read again under the second sweep's filters", async () => {
    const bought = new Map<Chain, TokenCandidate[]>();
    const narrow = await discoverCandidates({ ...paid, chains: ["solana"], maxAgeHours: 1, paidLaunches: bought });
    const own = await discoverCandidates({ ...paid, chains: ["solana"], paidLaunches: bought });

    expect(radar.asked.map((ask) => ask.id)).toEqual(["solenrich-launches"]);
    // 41 minutes old, then the two the "under 1h" sweep refused (96 and 184 minutes).
    expect(symbols(narrow)).toEqual(["GLMP"]);
    expect(symbols(own)).toEqual(["GLMP", "PLNK", "TDPL"]);
  });

  it("is not asked for again after it failed: the first ask may already have been charged", async () => {
    radar.fails = true;
    const bought = new Map<Chain, TokenCandidate[]>();
    expect(await discoverCandidates({ ...paid, chains: ["solana"], maxAgeHours: 1, paidLaunches: bought })).toEqual([]);
    expect(await discoverCandidates({ ...paid, chains: ["solana"], paidLaunches: bought })).toEqual([]);
    expect(radar.asked).toHaveLength(1);
  });

  it("buys a chain the first sweep left out, and that chain only", async () => {
    const bought = new Map<Chain, TokenCandidate[]>();
    await discoverCandidates({ ...paid, chains: ["solana"], paidLaunches: bought });
    const both = await discoverCandidates({ ...paid, chains: ["solana", "base"], paidLaunches: bought });

    expect(radar.asked.map((ask) => ask.id)).toEqual(["solenrich-launches", "gate402-base-radar"]);
    expect(both.some((c) => c.token.chain === "base")).toBe(true);
  });

  it("is asked for the sweep's own floor, never one below the owner's", async () => {
    await discoverCandidates({ ...paid, chains: ["solana"], minLiquidityUsd: 0 });
    await discoverCandidates({ ...paid, chains: ["solana"], minLiquidityUsd: 80_000 });
    expect(radar.asked.map((ask) => ask.minLiquidityUsd)).toEqual([15_000, 80_000]);
  });

  /** Unchanged: a caller that keeps no record pays on every sweep, as it always did. */
  it("is bought on every sweep by a caller that hands over no record", async () => {
    await discoverCandidates({ ...paid, chains: ["solana"] });
    await discoverCandidates({ ...paid, chains: ["solana"] });
    expect(radar.asked).toHaveLength(2);
  });
});
