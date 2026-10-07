/**
 * The sentences that describe where an agent hunts. Pure: no React, and nothing from
 * the tokens barrel, which re-exports client components.
 *
 * Every number is printed with the formatters that read back as the same number, so a
 * typed $12,345 liquidity gate is never said as "$12K" and a 36-hour ceiling is never
 * said as "2 days".
 */
import { VERDICT_META, verdictForScore } from "@/components/tokens/verdict";
import type { Chain } from "@/server/types";
import { sayCount, sayHours, sayMinutes, sayUsd } from "./typed-value";
import { DISCOVERY_FEEDS, UNIVERSE_PRESETS, type DiscoveryFeedId, type UniverseConfig } from "./types";

function feedLabel(id: DiscoveryFeedId): string {
  return DISCOVERY_FEEDS.find((feed) => feed.id === id)?.label.toLowerCase() ?? id;
}

function listSentence(items: string[]): string {
  if (items.length === 0) return "nothing";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The whole universe as one sentence. Nothing here is estimated or invented. */
export function universeSentence(universe: UniverseConfig, chains: Chain[]): string {
  const where = listSentence(chains.map((chain) => (chain === "solana" ? "Solana" : "Base")));
  const feeds = listSentence(universe.discovery.map(feedLabel));
  const verdict = VERDICT_META[verdictForScore(universe.minScore)].label.toLowerCase();

  const gates = [
    `at least ${sayUsd(universe.minLiquidityUsd)} of liquidity`,
    universe.minHolderCount > 0 ? `${sayCount(universe.minHolderCount)} holders or more` : null,
    universe.minAgeMinutes > 0 ? `at least ${sayMinutes(universe.minAgeMinutes)} old` : null,
    universe.maxAgeHours !== null ? `no older than ${sayHours(universe.maxAgeHours)}` : null,
    `top-10 wallets under ${Math.round(universe.maxTop10HolderPct)}%`,
    `buy tax under ${Math.round(universe.maxBuyTaxPct)}%`,
  ].filter((entry): entry is string => entry !== null);

  const authorities =
    universe.requireMintRevoked && universe.requireFreezeRevoked
      ? " Mint and freeze authorities must both be revoked."
      : universe.requireMintRevoked
        ? " The mint authority must be revoked; a live freeze authority is allowed."
        : universe.requireFreezeRevoked
          ? " The freeze authority must be revoked; a live mint authority is allowed."
          : " Live mint and freeze authorities are both allowed — the deployer can print supply or freeze your wallet.";

  const blocked =
    universe.blocklist.length > 0
      ? ` ${universe.blocklist.length} token${universe.blocklist.length === 1 ? " is" : "s are"} blocked outright.`
      : "";

  // Said as what it buys, not what it refuses: "buy nothing scoring under 62 … with at
  // least $15K of liquidity" read as a ban on exactly the tokens the gates let through.
  return `On ${where}, from ${feeds}: it only buys tokens scoring ${Math.round(universe.minScore)}+ (${verdict} and up) with ${listSentence(gates)}.${authorities}${blocked}`;
}

/**
 * The universe in a glance, for a collapsed card. The full sentence runs to four lines
 * and a two-line clamp cut it off mid-rule, so the summary carries only the numbers that
 * decide the most and leaves the rest to the open card.
 */
export function universeSummary(universe: UniverseConfig, chains: Chain[]): string {
  const where = chains.map((chain) => (chain === "solana" ? "Solana" : "Base")).join(" + ") || "No chain";
  const feeds = universe.discovery.length;
  return [
    where,
    `score ${Math.round(universe.minScore)}+`,
    `${sayUsd(universe.minLiquidityUsd)}+ liquidity`,
    `${feeds} feed${feeds === 1 ? "" : "s"}`,
    universe.blocklist.length > 0 ? `${universe.blocklist.length} blocked` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

const BALANCED = UNIVERSE_PRESETS.find((preset) => preset.id === "balanced")!.values;

/**
 * How this bar compares with the shipped default. This is the honest version of
 * "40 tokens a day clear this" — we cannot know the count until the agent has
 * actually swept, and inventing one would be worse than saying nothing.
 */
export function compareToBalanced(universe: UniverseConfig): {
  tighter: string[];
  looser: string[];
  /** The bar may match while the feeds it sweeps do not; that is not "exactly" Balanced. */
  feedsDiffer: boolean;
} {
  const tighter: string[] = [];
  const looser: string[] = [];

  const note = (label: string, delta: number) => {
    if (delta > 0) tighter.push(label);
    else if (delta < 0) looser.push(label);
  };

  note("score", Math.sign(universe.minScore - BALANCED.minScore));
  note("liquidity", Math.sign(universe.minLiquidityUsd - BALANCED.minLiquidityUsd));
  note("holders", Math.sign(universe.minHolderCount - BALANCED.minHolderCount));
  note("minimum age", Math.sign(universe.minAgeMinutes - BALANCED.minAgeMinutes));
  note("top-10 share", Math.sign(BALANCED.maxTop10HolderPct - universe.maxTop10HolderPct));
  note("buy tax", Math.sign(BALANCED.maxBuyTaxPct - universe.maxBuyTaxPct));
  if (universe.maxAgeHours !== null && BALANCED.maxAgeHours === null) tighter.push("maximum age");
  if (universe.maxAgeHours === null && BALANCED.maxAgeHours !== null) looser.push("maximum age");
  note("mint authority", Number(universe.requireMintRevoked) - Number(BALANCED.requireMintRevoked));
  note("freeze authority", Number(universe.requireFreezeRevoked) - Number(BALANCED.requireFreezeRevoked));

  return { tighter, looser, feedsDiffer: !sameSet(universe.discovery, BALANCED.discovery) };
}

/** Feeds are a set: the order they were switched on in changes nothing. */
function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((entry) => b.includes(entry));
}
