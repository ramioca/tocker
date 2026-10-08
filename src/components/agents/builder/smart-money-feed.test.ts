/**
 * The smart money feed as the builder offers it.
 *
 * It is the second feed that costs money, and the first an owner has to switch on in two
 * places: the feed under "How it finds tokens", and the Nansen source it buys from under
 * "Data it buys". What is pinned: nothing turns it on for them (no default, no posture,
 * no strategy preset), its card says what it costs the way the launch radar's does, and
 * the estimate counts it only when a sweep would really buy it.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG, agentConfigSchema } from "@/lib/agent/config";
import { applyPresetTo } from "./strategy-presets";
import {
  DISCOVERY_FEEDS,
  SMART_MONEY_BOARD_SOURCE,
  SMART_MONEY_BOARD_USD_PER_CHAIN,
  STRATEGY_PRESETS,
  UNIVERSE_PRESETS,
  emptyDraft,
  missingFeedSource,
  smartMoneyBoardUsdPerRun,
  type UniverseConfig,
} from "./types";
import { compareToBalanced, universeSentence, universeSummary } from "./universe-copy";

const feed = (id: string) => DISCOVERY_FEEDS.find((entry) => entry.id === id);

describe("the smart money feed", () => {
  it("is offered, by a name that says what it finds", () => {
    expect(feed("smart_money")).toMatchObject({
      label: "What smart money is buying",
      needsSource: { id: "nansen-smart-money", name: "Nansen Smart Money" },
    });
    expect(DISCOVERY_FEEDS.map((entry) => entry.id)).toEqual([
      "new_launches",
      "trending",
      "top_organic",
      "momentum",
      "gecko_launches",
      "paid_launches",
      "smart_money",
    ]);
  });

  it("states its cost the way the launch radar states its own, and what else it needs", () => {
    expect(feed("paid_launches")?.caveat).toBe("Costs money: about $0.02 per chain, per tick, from the data budget.");
    expect(feed("smart_money")?.caveat).toBe(
      "Costs money: about $0.05 per chain, per tick, from the data budget. It needs Nansen Smart Money switched on under Data it buys.",
    );
    // Its candidates are still held to the owner's rules, and the card says so.
    expect(feed("smart_money")?.description).toContain("Each still has to clear your gates and your score.");
    // No other feed claims a price.
    for (const entry of DISCOVERY_FEEDS.filter((e) => e.id !== "paid_launches" && e.id !== "smart_money")) {
      expect(`${entry.description} ${entry.caveat}`, entry.id).not.toMatch(/\$\d/);
      expect(entry.needsSource, entry.id).toBeUndefined();
    }
  });

  it("is off in the default, in every posture and after every strategy preset", () => {
    expect(DEFAULT_AGENT_CONFIG.universe.discovery).not.toContain("smart_money");
    expect(emptyDraft().config.universe.discovery).not.toContain("smart_money");
    for (const posture of UNIVERSE_PRESETS) expect(posture.values.discovery, posture.id).not.toContain("smart_money");
    for (const preset of STRATEGY_PRESETS) {
      expect(preset.universe?.discovery ?? [], preset.id).not.toContain("smart_money");
      expect(applyPresetTo(emptyDraft().config, preset).universe.discovery, preset.id).not.toContain("smart_money");
    }
    // Nor does anything switch on the source behind an owner's back.
    expect(DEFAULT_AGENT_CONFIG.dataSources).not.toContain(SMART_MONEY_BOARD_SOURCE.id);
  });

  it("is a feed the server accepts, on a list that needs no migration to hold it", () => {
    const config = emptyDraft().config;
    const on = { ...config, universe: { ...config.universe, discovery: [...config.universe.discovery, "smart_money"] } };
    const parsed = agentConfigSchema.safeParse(on);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.universe.discovery).toContain("smart_money");
    // A config saved before the feed existed reads back as it was.
    const before = agentConfigSchema.parse(config);
    expect(before.universe.discovery).toEqual(config.universe.discovery);
    // And a feed nobody defined is still refused.
    expect(agentConfigSchema.safeParse({ ...config, universe: { ...config.universe, discovery: ["smart_wallets"] } }).success).toBe(false);
  });

  it("costs five cents a chain, and nothing unless the feed and the source are both on", () => {
    expect(SMART_MONEY_BOARD_USD_PER_CHAIN).toBe(0.05);
    const source = SMART_MONEY_BOARD_SOURCE.id;
    expect(smartMoneyBoardUsdPerRun(["trending", "smart_money"], ["solana"], [source])).toBeCloseTo(0.05);
    expect(smartMoneyBoardUsdPerRun(["smart_money"], ["solana", "base"], ["x-search", source])).toBeCloseTo(0.1);
    expect(smartMoneyBoardUsdPerRun(["trending"], ["solana"], [source])).toBe(0);
    expect(smartMoneyBoardUsdPerRun(["trending", "smart_money"], ["solana"], [])).toBe(0);
    expect(smartMoneyBoardUsdPerRun(["trending", "smart_money"], ["solana"], ["x-search"])).toBe(0);
    expect(smartMoneyBoardUsdPerRun(["smart_money"], [], [source])).toBe(0);
  });

  /**
   * The feed on and its source off is a feed that finds nothing. The builder's card and
   * the agent page's hunting ground both ask this one question, so neither can list it
   * as hunting.
   */
  it("names the source it is missing, wherever a switched-on feed is shown", () => {
    const smartMoney = feed("smart_money");
    if (!smartMoney) throw new Error("the feed is not offered");
    expect(missingFeedSource(smartMoney, [])).toBe("Nansen Smart Money");
    expect(missingFeedSource(smartMoney, ["x-search", "deepnets-token-safety"])).toBe("Nansen Smart Money");
    expect(missingFeedSource(smartMoney, ["x-search", SMART_MONEY_BOARD_SOURCE.id])).toBeNull();
    // No other feed buys from a source the owner switches on, so none is ever missing one.
    for (const entry of DISCOVERY_FEEDS.filter((e) => e.id !== "smart_money")) expect(missingFeedSource(entry, []), entry.id).toBeNull();
  });

  it("is read back in the sentences about where the agent hunts", () => {
    const universe: UniverseConfig = { ...DEFAULT_AGENT_CONFIG.universe, discovery: ["trending", "smart_money"] };
    expect(universeSentence(universe, ["solana"])).toContain("On Solana, from trending and what smart money is buying: it only buys tokens scoring 62+");
    expect(universeSummary(universe, ["solana"])).toBe("Solana · score 62+ · $15K+ liquidity · 2 feeds");
    const added: UniverseConfig = { ...DEFAULT_AGENT_CONFIG.universe, discovery: [...DEFAULT_AGENT_CONFIG.universe.discovery, "smart_money"] };
    expect(universeSummary(added, ["solana"])).toBe("Solana · score 62+ · $15K+ liquidity · 5 feeds");
    // The same bar as Balanced, and one more feed: said as different feeds, not a different bar.
    expect(compareToBalanced(added)).toEqual({ tighter: [], looser: [], feedsDiffer: true });
  });
});
