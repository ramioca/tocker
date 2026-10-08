/**
 * The paid smart money read as the scorer and the model get it.
 *
 * Pure: a read goes in, a number or a sentence comes out. What is pinned is the rule for
 * "no reading" (nobody tracked traded the token is not a flow of zero), the sentence in
 * each case, and that a sentence never carries a number the source did not return.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { parseFlowIntelligence } from "@/lib/data-sources/nansen";
import flowFixture from "@/lib/data-sources/fixtures/nansen-flow-intelligence.json";
import type { TokenScore } from "@/server/types";
import { renderScore, scoreToken } from "./score";
import {
  smartMoneyLine,
  smartMoneyLineFromScore,
  smartMoneyNotReadLine,
  smartMoneyReading,
  type SmartMoneyRead,
  type WalletFlow,
} from "./smart-money";

const NONE: WalletFlow = { netFlowUsd: null, wallets: null };

function read(over: Partial<SmartMoneyRead> = {}): SmartMoneyRead {
  return { smartTraders: NONE, topPnl: NONE, whales: NONE, freshWallets: NONE, publicFigures: NONE, exchanges: NONE, ...over };
}

function fixtureRead(): SmartMoneyRead {
  const parsed = parseFlowIntelligence(flowFixture);
  if (!parsed) throw new Error("the fixture is not a readable answer");
  return parsed;
}

/** Every "$…" amount a line prints, as the text printed it. */
function amounts(line: string): string[] {
  return line.match(/\$\d[\d,]*(?:\.\d+)?[kMB]?/g) ?? [];
}

describe("smartMoneyReading", () => {
  it("adds smart traders and top-PnL wallets: their flows, and their counts", () => {
    expect(smartMoneyReading(fixtureRead())).toEqual({ netflowUsd: 9260.1 + 3150.4, wallets: 4 });
    // Whales, fresh wallets, public figures and exchanges are context, never scored.
    const loud = read({
      smartTraders: { netFlowUsd: 100, wallets: 1 },
      whales: { netFlowUsd: 5_000_000, wallets: 40 },
      freshWallets: { netFlowUsd: 900_000, wallets: 0 },
      publicFigures: { netFlowUsd: -70_000, wallets: 3 },
      exchanges: { netFlowUsd: -2_000_000, wallets: 0 },
    });
    expect(smartMoneyReading(loud)).toEqual({ netflowUsd: 100, wallets: 1 });
  });

  it("nets a buyer against a seller", () => {
    const mixed = read({ smartTraders: { netFlowUsd: 20_000, wallets: 5 }, topPnl: { netFlowUsd: -7_600, wallets: 2 } });
    expect(smartMoneyReading(mixed)).toEqual({ netflowUsd: 12_400, wallets: 7 });
  });

  it("has no reading when no wallet was counted and no dollar moved", () => {
    expect(smartMoneyReading(read())).toBeNull();
    expect(smartMoneyReading(read({ smartTraders: { netFlowUsd: 0, wallets: 0 }, topPnl: { netFlowUsd: 0, wallets: 0 } }))).toBeNull();
    expect(smartMoneyReading(read({ smartTraders: { netFlowUsd: 0, wallets: null }, topPnl: NONE }))).toBeNull();
    // Whales alone are not smart money.
    expect(smartMoneyReading(read({ whales: { netFlowUsd: 80_000, wallets: 6 } }))).toBeNull();
  });

  it("reads wallets that traded and came out even as a flow of zero", () => {
    const even = read({ smartTraders: { netFlowUsd: 4_000, wallets: 2 }, topPnl: { netFlowUsd: -4_000, wallets: 1 } });
    expect(smartMoneyReading(even)).toEqual({ netflowUsd: 0, wallets: 3 });
  });
});

describe("smartMoneyLine", () => {
  it("says who traded, what they net bought, and what the other groups did", () => {
    expect(smartMoneyLine(fixtureRead())).toBe(
      "Smart money, last 24h: 3 smart traders and 1 top-PnL wallet net bought $12.4k. Whales net sold $2.1k; fresh wallets net bought $40.2k; exchange net flow -$18.4k.",
    );
  });

  it("says a sale as a sale, and one wallet as one wallet", () => {
    const selling = read({ smartTraders: { netFlowUsd: -1_284_310.22, wallets: 1 }, topPnl: { netFlowUsd: 0, wallets: 0 } });
    expect(smartMoneyLine(selling)).toBe("Smart money, last 24h: 1 smart trader net sold $1.28M.");
    const topOnly = read({ topPnl: { netFlowUsd: 640, wallets: 2 } });
    expect(smartMoneyLine(topOnly)).toBe("Smart money, last 24h: 2 top-PnL wallets net bought $640.");
  });

  it("says that no tracked wallet traded it, which is information and not silence", () => {
    expect(smartMoneyLine(read())).toBe("Smart money, last 24h: no smart trader or top-PnL wallet tracked by Nansen traded it.");
    // The other groups are still worth a sentence when smart money was absent.
    const whalesOnly = read({
      smartTraders: { netFlowUsd: 0, wallets: 0 },
      topPnl: { netFlowUsd: 0, wallets: 0 },
      whales: { netFlowUsd: -2_104.75, wallets: 2 },
      freshWallets: { netFlowUsd: 40_000, wallets: 0 },
    });
    expect(smartMoneyLine(whalesOnly)).toBe(
      "Smart money, last 24h: no smart trader or top-PnL wallet tracked by Nansen traded it. Whales net sold $2.1k; fresh wallets net bought $40k.",
    );
  });

  it("does not count wallets the source did not count", () => {
    const uncounted = read({ smartTraders: { netFlowUsd: 9_000, wallets: null }, topPnl: { netFlowUsd: 500, wallets: 0 } });
    expect(smartMoneyLine(uncounted)).toBe("Smart money, last 24h: smart traders and top-PnL wallets net bought $9.5k.");
  });

  it("says an even book as traded with no net flow", () => {
    const even = read({ smartTraders: { netFlowUsd: 4_000, wallets: 2 }, topPnl: { netFlowUsd: -4_000, wallets: 1 } });
    expect(smartMoneyLine(even)).toBe("Smart money, last 24h: 2 smart traders and 1 top-PnL wallet traded it with no net flow.");
  });

  it("names the window it was read over", () => {
    expect(smartMoneyLine(read(), "7d")).toBe("Smart money, last 7d: no smart trader or top-PnL wallet tracked by Nansen traded it.");
  });

  it("never prints a number that was not returned", () => {
    const cases: SmartMoneyRead[] = [
      fixtureRead(),
      read(),
      read({ smartTraders: { netFlowUsd: 0, wallets: 0 }, topPnl: { netFlowUsd: 0, wallets: 0 } }),
      read({ smartTraders: { netFlowUsd: 9_000, wallets: null } }),
      read({ whales: { netFlowUsd: 0.2, wallets: 1 }, exchanges: { netFlowUsd: 0, wallets: 0 } }),
      read({ smartTraders: { netFlowUsd: 950.4, wallets: 12 }, publicFigures: { netFlowUsd: 2_500_000, wallets: 1 } }),
    ];
    const short = (n: number) => {
      const abs = Math.abs(n);
      const trim = (fixed: string) => fixed.replace(/\.?0+$/, "");
      return abs >= 999_950 ? `$${trim((abs / 1e6).toFixed(2))}M` : abs >= 999.5 ? `$${trim((abs / 1e3).toFixed(1))}k` : `$${Math.round(abs)}`;
    };
    for (const one of cases) {
      const line = smartMoneyLine(one);
      const reading = smartMoneyReading(one);
      // The only amounts a line may print: the smart money sum, and each other group's own flow.
      const allowed = new Set(
        [reading?.netflowUsd, one.whales.netFlowUsd, one.freshWallets.netFlowUsd, one.publicFigures.netFlowUsd, one.exchanges.netFlowUsd]
          .filter((n): n is number => n !== null && n !== undefined)
          .map(short),
      );
      for (const amount of amounts(line)) expect(allowed.has(amount), `${amount} in "${line}"`).toBe(true);
      // And the only counts: the two wallet counts the source gave.
      const counts = (line.match(/\b\d+ (?:smart trader|top-PnL wallet)/g) ?? []).map((m) => Number.parseInt(m, 10));
      const given = [one.smartTraders.wallets, one.topPnl.wallets].filter((n): n is number => n !== null && n > 0);
      expect(counts, line).toEqual(given);
      expect(line.length, line).toBeLessThan(260);
    }
    // Nothing returned at all: no amount and no count is printed.
    expect(smartMoneyLine(read())).not.toMatch(/\$|\b\d+ (smart|top)/);
  });
});

describe("a score rendered for the model", () => {
  const NOW = Date.parse("2026-09-12T09:30:00.000Z");
  const score = (over: Partial<TokenScore> = {}): TokenScore => ({
    ...scoreToken({ chain: "solana", address: "Mint11111111111111111111111111111111111111", symbol: "DOVE", now: NOW }, DEFAULT_AGENT_CONFIG.universe),
    ...over,
  });
  const components = (smartMoney: number | null) => ({
    safety: 80,
    liquidity: 70,
    organic: 65,
    distribution: 60,
    momentum: 55,
    gecko: null,
    sentiment: null,
    smartMoney,
  });

  it("carries the smart money line on a line of its own, after the components", () => {
    const line = smartMoneyLine(fixtureRead());
    const rendered = renderScore(score({ components: components(52.8), sources: ["jupiter", "nansen-smart-money"] }), line).split("\n");
    expect(rendered[1]).toContain("smart money 52.8");
    expect(rendered[2]).toBe(line);
  });

  it("renders as it always did when it is handed no line", () => {
    const plain = score({ components: components(73), sources: ["jupiter", "nansen-smart-money"] });
    expect(renderScore(plain)).toBe(renderScore(plain, null));
    expect(renderScore(plain)).not.toContain("Smart money");
    expect(renderScore(plain)).toContain("smart money 73");
  });

  /**
   * A row cached under the old read: the source is listed, the component is a number,
   * and nothing else of the read was kept. It still renders, and what is said about it is
   * only what the row holds: the direction, and no amount.
   */
  it("says of an old cached score only what the score still holds", () => {
    const bought = score({ components: components(73), sources: ["jupiter", "rugcheck", "nansen-smart-money"] });
    const line = smartMoneyLineFromScore(bought);
    expect(line).toBe("Smart money, last 24h: tracked wallets net bought it. The amounts were not kept with this cached score.");
    expect(amounts(line ?? "")).toEqual([]);
    expect(renderScore(bought, line)).toContain("smart money 73\nSmart money, last 24h: tracked wallets net bought it.");

    expect(smartMoneyLineFromScore({ ...bought, components: components(31.5) })).toContain("tracked wallets net sold it.");
    expect(smartMoneyLineFromScore({ ...bought, components: components(50) })).toContain("traded it with little or no net flow.");
    // Bought, and no reading: the per-token read's "nobody".
    expect(smartMoneyLineFromScore({ ...bought, components: components(null) })).toBe(
      "Smart money, last 24h: no smart trader or top-PnL wallet tracked by Nansen traded it.",
    );
  });

  it("says nothing about a score no smart money read was bought for", () => {
    expect(smartMoneyLineFromScore(score({ components: components(null), sources: ["jupiter", "rugcheck"] }))).toBeNull();
    expect(smartMoneyLineFromScore(score({ components: components(null), sources: [] }))).toBeNull();
  });

  it("says why a read that was wanted is missing", () => {
    expect(smartMoneyNotReadLine(" $0.01 exceeds the $0.00 left in this run's data budget")).toBe(
      "Smart money: not read ($0.01 exceeds the $0.00 left in this run's data budget).",
    );
    expect(smartMoneyNotReadLine("the source did not answer: nansen-smart-money responded 503.")).toBe(
      "Smart money: not read (the source did not answer: nansen-smart-money responded 503).",
    );
  });
});
