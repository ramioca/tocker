/**
 * What a strategy preset does to a draft, decided without a browser.
 *
 * A preset is the one control that rewrites several cards at once, and those cards are
 * closed when it is tapped. So the merge, the list of what it changed and the line of
 * facts a preset card shows all live here, where a test can hold them still.
 */
import { formatUsd } from "@/components/common/format";
import type { Chain } from "@/server/types";
import type { SummaryLabels } from "./contract";
import { STRATEGY_PRESETS, emptyDraft, type BuilderDraft, type StrategyPreset } from "./types";

type Config = BuilderDraft["config"];

const CHAIN_NAMES: Record<Chain, string> = { solana: "Solana", base: "Base" };

/** The config a preset leaves behind. The input is not changed. */
export function applyPresetTo(config: Config, preset: StrategyPreset): Config {
  return {
    ...config,
    strategyPrompt: preset.prompt,
    chains: preset.chains,
    dataSources: preset.dataSources,
    // A preset that is a whole way of trading also sets what it needs;
    // one that only carries a prompt leaves the other steps as they are.
    ...(preset.universe ? { universe: { ...config.universe, ...preset.universe } } : {}),
    ...(preset.risk ? { risk: { ...config.risk, ...preset.risk } } : {}),
    ...(preset.execution ? { execution: preset.execution } : {}),
    ...(preset.schedule ? { schedule: preset.schedule } : {}),
  };
}

/**
 * What a strategy preset changed besides the prompt, in the words of the rule steps.
 * A preset rewrites whatever its way of trading needs in one tap — chains, sources, even
 * the schedule — and those steps are not on screen, so the toast is where that gets said.
 */
export function presetChanges(before: Config, next: Config, labels: SummaryLabels): string[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const changes: string[] = [];
  if (!same([...before.chains].sort(), [...next.chains].sort())) {
    changes.push(
      next.chains.length === 1
        ? `${CHAIN_NAMES[next.chains[0]]} only`
        : next.chains.map((chain) => CHAIN_NAMES[chain]).join(" and "),
    );
  }
  if (!same([...before.dataSources].sort(), [...next.dataSources].sort())) {
    changes.push(`${next.dataSources.length} data source${next.dataSources.length === 1 ? "" : "s"}`);
  }
  if (!same(before.universe, next.universe)) changes.push("its universe");
  if (!same(before.risk, next.risk)) changes.push("its risk limits");
  if (!same(before.schedule, next.schedule)) {
    changes.push(labels.interval(next.schedule.intervalMinutes).toLowerCase());
  }
  if (!same(before.execution, next.execution)) {
    changes.push(
      next.execution.mode === "approve"
        ? `ask first, ${labels.ttl(next.execution.proposalTtlMinutes)} window`
        : "trades on its own",
    );
  }
  return changes;
}

/**
 * One line about the agent a config describes, for the foot of a preset card:
 * "Solana · every 5 min · up to $2.00 a trade · asks first". Given the config a preset
 * would leave behind, it says what tapping that card gets you before you tap it.
 */
export function presetFacts(config: Config, labels: SummaryLabels): string {
  return [
    config.chains.map((chain) => CHAIN_NAMES[chain]).join(" and "),
    labels.interval(config.schedule.intervalMinutes).toLowerCase(),
    `up to ${formatUsd(config.risk.maxTradeUsd)} a trade`,
    config.execution.mode === "approve" ? "asks first" : "trades on its own",
  ].join(" · ");
}

/**
 * The fifth card: no preset at all. It is written out here rather than added to
 * STRATEGY_PRESETS because it is not one: it carries no prompt, no chains and no sources.
 */
export const CUSTOM_STRATEGY = {
  id: "custom",
  label: "Custom",
  blurb: "Write your own from scratch.",
  facts: "Keeps every rule as it is",
} as const;

/**
 * The config Custom leaves behind: an empty prompt and every other value as it was.
 * The input is not changed.
 */
export function applyCustomTo(config: Config): Config {
  return { ...config, strategyPrompt: "" };
}

/**
 * Whether the Custom card reads as pressed: the prompt is empty, or it is the owner's own
 * words. A preset's prompt presses that preset's card instead, and the prompt a fresh
 * draft starts with presses nothing, because nobody has chosen anything yet.
 */
export function isCustomPressed(
  prompt: string,
  presets: readonly StrategyPreset[] = STRATEGY_PRESETS,
  defaultPrompt: string = emptyDraft().config.strategyPrompt,
): boolean {
  if (prompt.trim() === "") return true;
  return prompt !== defaultPrompt && !presets.some((preset) => preset.prompt === prompt);
}
