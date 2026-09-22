import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import {
  GATE,
  ageAt,
  factsFromBlockers,
  passesPreviewGates,
  summarise,
  type PreviewRow,
  type Universe,
} from "./universe-preview";

const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NATIVE_SOL = "So11111111111111111111111111111111111111112";
const ADDRESS = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

/** A row that clears every default gate, so each case can move exactly one thing. */
function row(over: Partial<PreviewRow> = {}): PreviewRow {
  return {
    tokenId: `solana:${ADDRESS}`,
    chain: "solana",
    address: ADDRESS,
    symbol: "BONK",
    total: 74,
    liquidityUsd: 250_000,
    holderCount: 4_000,
    ageHours: 12,
    mintRevoked: null,
    freezeRevoked: null,
    top10HolderPct: null,
    taxPct: null,
    hardFail: false,
    ...over,
  };
}

/**
 * Every optional gate off, so a case turns on exactly the one it is about and the
 * `unknown` list it asserts is never polluted by a default someone changes later.
 */
function universe(over: Partial<Universe> = {}): Universe {
  return {
    ...DEFAULT_AGENT_CONFIG.universe,
    minScore: 0,
    minLiquidityUsd: 0,
    minHolderCount: 0,
    minAgeMinutes: 0,
    maxAgeHours: null,
    maxTop10HolderPct: 100,
    maxBuyTaxPct: 100,
    requireMintRevoked: false,
    requireFreezeRevoked: false,
    blocklist: [],
    ...over,
  };
}

describe("passesPreviewGates", () => {
  const cases: Array<{
    name: string;
    row: PreviewRow;
    universe: Universe;
    passed: boolean;
    unknown?: string[];
  }> = [
    // ---- the shipped defaults, end to end: everything knowable clears, and the four
    // gates history cannot answer are reported rather than assumed.
    {
      name: "clears every default floor, and says what it could not check",
      row: row(),
      universe: DEFAULT_AGENT_CONFIG.universe,
      passed: true,
      unknown: [GATE.mint, GATE.freeze, GATE.top10, GATE.tax],
    },

    // ---- score
    { name: "clears every floor", row: row(), universe: universe(), passed: true, unknown: [] },
    { name: "score under the floor", row: row({ total: 61 }), universe: universe({ minScore: 62 }), passed: false },
    { name: "score exactly on the floor", row: row({ total: 62 }), universe: universe({ minScore: 62 }), passed: true },

    // ---- liquidity: unknown fails, matching the live gate
    {
      name: "liquidity under the floor",
      row: row({ liquidityUsd: 9_000 }),
      universe: universe({ minLiquidityUsd: 15_000 }),
      passed: false,
    },
    {
      name: "liquidity unknown fails",
      row: row({ liquidityUsd: null }),
      universe: universe({ minLiquidityUsd: 15_000 }),
      passed: false,
    },
    {
      name: "liquidity unknown passes when there is no floor",
      row: row({ liquidityUsd: null }),
      universe: universe({ minLiquidityUsd: 0 }),
      passed: true,
    },

    // ---- holders: unknown fails, matching the live gate
    {
      name: "holders under the floor",
      row: row({ holderCount: 40 }),
      universe: universe({ minHolderCount: 150 }),
      passed: false,
    },
    {
      name: "holders unknown fails",
      row: row({ holderCount: null }),
      universe: universe({ minHolderCount: 150 }),
      passed: false,
    },
    {
      name: "holders unknown passes when there is no floor",
      row: row({ holderCount: null }),
      universe: universe({ minHolderCount: 0 }),
      passed: true,
    },

    // ---- age: the gate that emptied a sweep
    {
      name: "younger than the minimum",
      row: row({ ageHours: 0.2 }),
      universe: universe({ minAgeMinutes: 30 }),
      passed: false,
    },
    {
      name: "older than the maximum",
      row: row({ ageHours: 12 }),
      universe: universe({ minAgeMinutes: 0, maxAgeHours: 1 }),
      passed: false,
    },
    {
      name: "inside the age window",
      row: row({ ageHours: 0.75 }),
      universe: universe({ minAgeMinutes: 30, maxAgeHours: 1 }),
      passed: true,
    },
    {
      name: "age unknown is skipped, not failed",
      row: row({ ageHours: null }),
      universe: universe({ minAgeMinutes: 30, maxAgeHours: 1 }),
      passed: true,
      unknown: [GATE.age],
    },
    {
      name: "age unknown is not even asked when no age gate is set",
      row: row({ ageHours: null }),
      universe: universe({ minAgeMinutes: 0, maxAgeHours: null }),
      passed: true,
      unknown: [],
    },

    // ---- authorities: only a failure is knowable
    {
      name: "live mint authority blocks",
      row: row({ mintRevoked: false }),
      universe: universe({ requireMintRevoked: true }),
      passed: false,
    },
    {
      name: "unknown mint authority is skipped",
      row: row({ mintRevoked: null, freezeRevoked: true }),
      universe: universe({ requireMintRevoked: true, requireFreezeRevoked: true }),
      passed: true,
      unknown: [GATE.mint],
    },
    {
      name: "live freeze authority blocks",
      row: row({ mintRevoked: true, freezeRevoked: false }),
      universe: universe({ requireFreezeRevoked: true }),
      passed: false,
    },
    {
      name: "both authorities unknown are both reported",
      row: row(),
      universe: universe({ requireMintRevoked: true, requireFreezeRevoked: true }),
      passed: true,
      unknown: [GATE.mint, GATE.freeze],
    },
    {
      name: "unknown authorities are not asked when not required",
      row: row(),
      universe: universe({ requireMintRevoked: false, requireFreezeRevoked: false }),
      passed: true,
      unknown: [],
    },

    // ---- concentration and tax
    {
      name: "top-10 over the ceiling",
      row: row({ top10HolderPct: 75 }),
      universe: universe({ maxTop10HolderPct: 60 }),
      passed: false,
    },
    {
      name: "top-10 under the ceiling",
      row: row({ top10HolderPct: 41 }),
      universe: universe({ maxTop10HolderPct: 60 }),
      passed: true,
    },
    {
      name: "top-10 unknown is skipped",
      row: row(),
      universe: universe({ maxTop10HolderPct: 60 }),
      passed: true,
      unknown: [GATE.top10],
    },
    {
      name: "top-10 not asked at 100%",
      row: row(),
      universe: universe({ maxTop10HolderPct: 100 }),
      passed: true,
      unknown: [],
    },
    {
      name: "tax over the ceiling",
      row: row({ taxPct: 9 }),
      universe: universe({ maxBuyTaxPct: 5 }),
      passed: false,
    },
    { name: "tax unknown is skipped", row: row(), universe: universe({ maxBuyTaxPct: 5 }), passed: true, unknown: [GATE.tax] },

    // ---- gates no threshold can relax
    { name: "honeypot is out at any setting", row: row({ hardFail: true }), universe: universe({ minScore: 0 }), passed: false },

    // ---- blocklist, the only subtractive list
    {
      name: "blocklisted address",
      row: row(),
      universe: universe({ blocklist: [{ chain: "solana", address: ADDRESS, symbol: "BONK" }] }),
      passed: false,
    },
    {
      name: "blocklist matches case-insensitively",
      row: row({ chain: "base", address: "0xAbC0000000000000000000000000000000000001" }),
      universe: universe({
        blocklist: [{ chain: "base", address: "0xabc0000000000000000000000000000000000001", symbol: "X" }],
      }),
      passed: false,
    },
    {
      name: "blocklist is chain-scoped",
      row: row(),
      universe: universe({ blocklist: [{ chain: "base", address: ADDRESS, symbol: "BONK" }] }),
      passed: true,
    },

    // ---- native assets: only the blocklist and the score reach them
    {
      name: "native SOL ignores the issuer gates",
      row: row({ address: NATIVE_SOL, symbol: "SOL", liquidityUsd: null, holderCount: null, ageHours: null }),
      universe: universe({ minLiquidityUsd: 15_000, minHolderCount: 150, minAgeMinutes: 30 }),
      passed: true,
      unknown: [],
    },
    {
      name: "native SOL still answers to the blocklist",
      row: row({ address: NATIVE_SOL, symbol: "SOL" }),
      universe: universe({ blocklist: [{ chain: "solana", address: NATIVE_SOL, symbol: "SOL" }] }),
      passed: false,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = passesPreviewGates(testCase.row, testCase.universe);
      expect(result.passed).toBe(testCase.passed);
      if (testCase.unknown) expect(result.unknown).toEqual(testCase.unknown);
    });
  }

  it("is pure — the same row and universe always answer the same", () => {
    const r = row({ ageHours: null });
    const u = universe({ minAgeMinutes: 30 });
    expect(passesPreviewGates(r, u)).toEqual(passesPreviewGates(r, u));
  });
});

describe("factsFromBlockers", () => {
  it("reads only what a blocker proves", () => {
    expect(factsFromBlockers(["mint_authority_active", "top10_holders_75pct"])).toEqual({
      mintRevoked: false,
      freezeRevoked: null,
      top10HolderPct: 75,
      taxPct: null,
      hardFail: false,
    });
  });

  it("treats an absent blocker as unknown, never as a pass", () => {
    const facts = factsFromBlockers([]);
    expect(facts.mintRevoked).toBeNull();
    expect(facts.freezeRevoked).toBeNull();
    expect(facts.top10HolderPct).toBeNull();
    expect(facts.taxPct).toBeNull();
  });

  it("an `_unknown` blocker stays unknown rather than becoming a failure", () => {
    expect(factsFromBlockers(["mint_authority_unknown"]).mintRevoked).toBeNull();
  });

  it("keeps the worse of buy and sell tax", () => {
    expect(factsFromBlockers(["buy_tax_4pct", "sell_tax_11.5pct"]).taxPct).toBe(11.5);
  });

  it("flags honeypot and cannot_sell as unrelaxable", () => {
    expect(factsFromBlockers(["honeypot"]).hardFail).toBe(true);
    expect(factsFromBlockers(["cannot_sell"]).hardFail).toBe(true);
    expect(factsFromBlockers(["liquidity_below_floor"]).hardFail).toBe(false);
  });
});

describe("ageAt", () => {
  const at = new Date("2026-09-22T12:00:00Z");

  it("back-projects a cached age onto an earlier moment", () => {
    // Cached six hours later at age 10h → the token was 4h old at `at`.
    expect(ageAt(10, new Date("2026-09-22T18:00:00Z"), at)).toBeCloseTo(4, 6);
  });

  it("is the cached age when the cache is the same moment", () => {
    expect(ageAt(3, at, at)).toBe(3);
  });

  it("refuses a negative age rather than guessing", () => {
    expect(ageAt(1, new Date("2026-09-22T18:00:00Z"), at)).toBeNull();
  });

  it("is null without a cached age", () => {
    expect(ageAt(null, at, at)).toBeNull();
    expect(ageAt(5, null, at)).toBeNull();
  });
});

describe("summarise", () => {
  const rows = [
    row({ tokenId: "solana:a", address: "a", symbol: "AAA", total: 90 }),
    row({ tokenId: "solana:b", address: "b", symbol: "BBB", total: 70 }),
    row({ tokenId: "solana:c", address: "c", symbol: "CCC", total: 41 }),
  ];

  it("counts what each bar lets through", () => {
    expect(summarise(rows, universe({ minScore: 62 })).passing).toBe(2);
    expect(summarise(rows, universe({ minScore: 85 })).passing).toBe(1);
    expect(summarise(rows, universe({ minScore: 95 })).passing).toBe(0);
    expect(summarise(rows, universe({ minScore: 62 })).scanned).toBe(3);
  });

  it("orders examples by score and caps them", () => {
    const { examples } = summarise(rows, universe({ minScore: 0 }));
    expect(examples.map((e) => e.symbol)).toEqual(["AAA", "BBB", "CCC"]);
    expect(summarise(Array.from({ length: 20 }, (_, i) => row({ address: `x${i}` })), universe({ minScore: 0 }))
      .examples).toHaveLength(8);
  });

  it("names the gates it could not check, and counts every skip", () => {
    const result = summarise(rows, universe({ minScore: 0, requireMintRevoked: true, maxTop10HolderPct: 60 }));
    expect(result.gatesSkipped).toContain(GATE.mint);
    expect(result.gatesSkipped).toContain(GATE.top10);
    expect(result.unknownGates).toBe(6); // two unknown gates on each of three rows
  });

  it("reports the age gate as unapplied when nothing could be aged", () => {
    const ageless = rows.map((r) => ({ ...r, ageHours: null }));
    const gated = universe({ minScore: 0, minAgeMinutes: 30 });
    expect(summarise(ageless, gated).ageGateApplied).toBe(false);
    expect(summarise(ageless, gated).gatesSkipped).toContain(GATE.age);
    expect(summarise(rows, gated).ageGateApplied).toBe(true);
    expect(summarise(rows, gated).gatesApplied).toContain(GATE.age);
  });

  it("reports no age gate as unapplied even when ages are known", () => {
    expect(summarise(rows, universe({ minScore: 0, minAgeMinutes: 0, maxAgeHours: null })).ageGateApplied).toBe(false);
  });

  it("lists only the gates the universe actually turns on", () => {
    const wide = summarise(
      rows,
      universe({
        minScore: 0,
        minLiquidityUsd: 0,
        minHolderCount: 0,
        maxTop10HolderPct: 100,
        maxBuyTaxPct: 100,
        requireMintRevoked: false,
        requireFreezeRevoked: false,
        minAgeMinutes: 0,
        maxAgeHours: null,
        blocklist: [],
      }),
    );
    expect(wide.gatesApplied).toEqual([GATE.score]);
    expect(wide.gatesSkipped).toEqual([]);
    expect(wide.unknownGates).toBe(0);
  });

  it("says nothing was scanned on an empty window", () => {
    const empty = summarise([], universe());
    expect(empty).toMatchObject({ scanned: 0, passing: 0, examples: [], gatesApplied: [], unknownGates: 0 });
  });

  it("the blocklist is the only list — an unlisted token is never excluded for being unlisted", () => {
    const listed = summarise(rows, universe({ minScore: 0, blocklist: [{ chain: "solana", address: "b", symbol: "BBB" }] }));
    expect(listed.passing).toBe(2);
    expect(listed.gatesApplied).toContain(GATE.blocklist);
    expect(listed.examples.map((e) => e.symbol)).toEqual(["AAA", "CCC"]);
  });

  it("carries the quote asset through untouched when it is scored", () => {
    // USDC is not a native asset, so it answers to the gates like anything else.
    const usdc = row({ tokenId: `solana:${SOL_USDC}`, address: SOL_USDC, symbol: "USDC", total: 95 });
    expect(summarise([usdc], universe({ minScore: 62 })).passing).toBe(1);
  });
});
