import { DEFAULT_AGENT_CONFIG, DEFAULT_MODEL_ID } from "@/lib/agent/config";
import { DEFAULT_FUND_USD } from "@/lib/wallets/funding";
import { chooseSource, stripPayPerUse, usdcEstimate } from "@/components/agents/thinking";
import { thinkSource } from "@/lib/agent/inference";
import { isProvider, type LlmProvider } from "@/lib/agent/providers";
import type { AgentConfigInput } from "@/lib/agent/config";
import type { AgentConfig } from "@/db/schema";
import type { LlmKeyRow } from "@/server/types";

export type UniverseConfig = AgentConfig["universe"];
export type DiscoveryFeedId = UniverseConfig["discovery"][number];
export type BlocklistEntry = UniverseConfig["blocklist"][number];

/**
 * What the Funding step collects (W1). Real money, so it is opt-in: every agent
 * is created on paper, and `mode: "fund"` means the user also wants to move USDC
 * into its wallets right after it exists.
 */
export interface BuilderFunding {
  mode: "paper" | "fund";
  /** Total USDC the agent should end up with, in dollars. */
  amountUsd: number;
  /**
   * Always 0, and never shown. Network fees are Tocker's, so an agent is funded with
   * USDC and nothing else; the field survives only so a draft saved before that still
   * loads.
   */
  gasUsd: number;
  /** Explicit per-chain USDC amounts once the user drags the split; null = proportional. */
  split: Partial<Record<"solana" | "base", number>> | null;
}

export interface BuilderDraft {
  name: string;
  tagline: string;
  avatarSeed: string;
  isPublic: boolean;
  llmKeyId: string | null;
  paperStartingUsd: number;
  activate: boolean;
  /**
   * After a funded create, land on the live checklist instead of the agent page. The
   * checklist still gates the switch behind its server-side checks and a hold; this
   * only decides whether the operator is walked there or left on paper until they
   * find Settings. Ignored for paper-only creates.
   */
  goLive: boolean;
  funding: BuilderFunding;
  config: AgentConfigInput;
}

/** The longest name an agent can have; defined once, beside the config schema. */
export { MAX_AGENT_NAME } from "@/lib/agent/config";

export const AVATAR_SEEDS = [
  "aurora",
  "basilisk",
  "cinder",
  "delta",
  "ember",
  "fathom",
  "gale",
  "helix",
  "ion",
  "jetty",
  "kestrel",
  "lumen",
] as const;

/** Deterministic: a random seed here would differ between server and client render. */
export function emptyDraft(): BuilderDraft {
  return {
    name: "",
    tagline: "",
    avatarSeed: AVATAR_SEEDS[0],
    isPublic: true,
    llmKeyId: null,
    paperStartingUsd: 10_000,
    activate: true,
    goLive: true,
    funding: {
      mode: "paper",
      amountUsd: DEFAULT_FUND_USD,
      gasUsd: 0,
      split: null,
    },
    config: {
      ...DEFAULT_AGENT_CONFIG,
      risk: { ...DEFAULT_AGENT_CONFIG.risk },
      schedule: { ...DEFAULT_AGENT_CONFIG.schedule },
      llm: { ...DEFAULT_AGENT_CONFIG.llm },
      chains: [...DEFAULT_AGENT_CONFIG.chains],
      dataSources: [...DEFAULT_AGENT_CONFIG.dataSources],
      universe: {
        ...DEFAULT_AGENT_CONFIG.universe,
        discovery: [...DEFAULT_AGENT_CONFIG.universe.discovery],
        blocklist: DEFAULT_AGENT_CONFIG.universe.blocklist.map((entry) => ({ ...entry })),
      },
    },
  };
}

/**
 * An agent's model settings moved to another provider: that provider, on the model the
 * registry starts it on. The model that was chosen belongs to the provider being left
 * and would fail the first run on this one. Everything else (temperature, steps, how it
 * thinks) stays as it was. The builder and the settings form both change provider
 * through this, so they cannot come to disagree about what a switch does.
 */
export function onProvider<L extends { provider: LlmProvider; model: string }>(llm: L, provider: LlmProvider): L {
  return { ...llm, provider, model: DEFAULT_MODEL_ID[provider] };
}

/** The first of the account's keys that belongs to this provider, or null when it has none. */
export function firstKeyFor(
  keys: ReadonlyArray<Pick<LlmKeyRow, "id" | "provider">>,
  provider: LlmProvider,
): string | null {
  return keys.find((key) => key.provider === provider)?.id ?? null;
}

/**
 * Put a draft on a key the account already has.
 *
 * The builder opened on Anthropic with no key chosen, whatever the account held. Someone
 * who had just saved the OpenRouter key onboarding recommends read "No Anthropic key on
 * file yet" and took the key for lost; someone with an Anthropic key still got "Choose a
 * key" and a refused Create until they picked the only option by hand. So a selection
 * that is still usable is kept; otherwise the draft takes the first key for its own
 * provider; and when that provider has none but the account has keys, the draft moves to
 * the first key's provider and that provider's first model.
 *
 * For a fresh, restored or cleared draft only. A provider the user picks in the form is
 * left alone: switching to a provider is how its first key gets added.
 *
 * A draft set to pay per use is left exactly as it is: it has no key on purpose, and
 * moving it onto one would undo a choice somebody made. That holds only while the viewer
 * may use pay-per-use. A draft saved when they could, restored when they cannot, goes
 * back to being a key draft, because the form no longer shows the other mode at all.
 *
 * Neither the draft nor the keys are trusted to name a provider that is offered. A draft
 * is read back from localStorage and a key from its row, and either can name a provider
 * that has been switched off since, or nothing sensible at all. Such a draft starts
 * again on the default provider, and such a key is never chosen for it: the form could
 * show neither, and the server refuses both.
 */
export function withDefaultKey(
  draft: BuilderDraft,
  allKeys: ReadonlyArray<Pick<LlmKeyRow, "id" | "provider">>,
  options: { payPerUseAllowed?: boolean } = {},
): BuilderDraft {
  if (!isProvider(draft.config.llm.provider)) {
    draft = {
      ...draft,
      config: { ...draft.config, llm: onProvider(draft.config.llm, DEFAULT_AGENT_CONFIG.llm.provider) },
    };
  }
  const keys = allKeys.filter((key) => isProvider(key.provider));
  if (thinkSource(draft.config) === "usdc") {
    if (options.payPerUseAllowed === true) {
      // A saved draft that names the mode without its model and limits gets the defaults,
      // so the form never holds a pay-per-use draft it would refuse to create.
      return draft.config.llm.usdc ? draft : { ...draft, config: chooseSource(draft.config, "usdc").config };
    }
    draft = { ...draft, config: stripPayPerUse(draft.config) };
  }
  const provider = draft.config.llm.provider;
  if (keys.some((key) => key.id === draft.llmKeyId && key.provider === provider)) return draft;

  const own = keys.find((key) => key.provider === provider);
  if (own) return { ...draft, llmKeyId: own.id };

  const first = keys[0];
  // No key on the account at all: nothing to choose, and a stale id must not linger.
  if (!first) return draft.llmKeyId === null ? draft : { ...draft, llmKeyId: null };
  return {
    ...draft,
    llmKeyId: first.id,
    config: { ...draft.config, llm: onProvider(draft.config.llm, first.provider) },
  };
}

/**
 * Tocker's flat fee as a share of one ticket, in whole percent, or null when it is off
 * or under 1%. A $0.10 fee is nothing on a $100 ticket and 5% each way on a $2 one, and
 * the builder says so where the ticket size is set. The fee itself is the server's
 * (`platformFeeUsd()`), handed down as a prop: it is never a number written in here.
 */
export function feeSharePct(ticketUsd: number, feeUsd: number): number | null {
  if (!(feeUsd > 0) || !(ticketUsd > 0)) return null;
  const share = (feeUsd / ticketUsd) * 100;
  return share < 1 ? null : Math.round(share);
}

export interface StrategyPreset {
  id: string;
  label: string;
  blurb: string;
  prompt: string;
  chains: Array<"solana" | "base">;
  dataSources: string[];
  /**
   * Optional: a preset that is a whole way of trading, not just a prompt, also sets the
   * universe, risk, execution and cadence it needs. Each merges over the draft, so a
   * preset that says nothing about a field leaves the operator's value alone.
   */
  universe?: Partial<Omit<UniverseConfig, "blocklist">>;
  risk?: Partial<AgentConfig["risk"]>;
  execution?: AgentConfig["execution"];
  schedule?: AgentConfig["schedule"];
}

/** Three ways to start. Each one is a complete, defensible thesis, not filler. */
export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: "momentum",
    label: "Momentum",
    blurb: "Buys accelerating attention, exits the moment it decelerates.",
    chains: ["solana"],
    dataSources: ["x-search", "cmc-quotes"],
    prompt:
      "You trade momentum on Solana. Each tick, score the trending and momentum feeds and read the paid signals bought for you. Momentum and sentiment are centred scores: 50 is flat or neutral, above is positive. Enter when a token clears your bar with momentum at or above 55, sentiment at or above 50, and velocity rising — price and holders both higher than the last time you scored it (score_token's trend.velocity), or consecutiveRises of two or more. Sentiment under 45 is a veto; between 45 and 50 it only lowers your conviction. A token you have never scored before is judged on this tick's numbers alone; do not wait a tick to see it again. Exit the entire position the first time velocity turns falling or momentum drops under 45 — do not wait for confirmation. Hold at most three positions, never average down, propose each qualifying token in the same tick, and if nothing qualifies, post a one-line note naming which token failed which test with its numbers, and finish.",
  },
  {
    id: "sentiment-contrarian",
    label: "Sentiment contrarian",
    blurb: "Fades the crowd when the crowd is loudest.",
    chains: ["solana", "base"],
    dataSources: ["x-search", "cmc-quotes", "deepnets-token-safety"],
    prompt:
      "You fade consensus. When sentiment for a token is above 0.8 while narrative velocity is flat or falling, treat it as distribution and sell or refuse to enter. When sentiment is below -0.6 on a token that still scores above your bar — clean authorities, distribution component above 60, liquidity holding — accumulate in three equal tranches. Size down hard when every token you look at is pointing the same way; a one-directional market is where contrarians die.",
  },
  {
    id: "first-fifteen",
    label: "First fifteen minutes",
    blurb: "Solana launches under fifteen minutes old, proposed the same tick, $2 clips, you approve. Sets everything.",
    chains: ["solana"],
    dataSources: ["deepnets-token-safety", "solenrich-launches", "x-search"],
    prompt:
      "You hunt Solana launches in their first fifteen minutes and propose them to your owner in the same tick you find them. Your edge is filtering speed, not prediction: most launches die within the hour, and the survivors are sorted by unique buyers, not price.\n\nEach tick, take the launch tier of discovery first and score every candidate under fifteen minutes old. Do not wait for a GT Score or holder count; they do not exist yet. Only two setups qualify:\n\n1. Ignition (2–8 minutes old): at least 15 unique buyers in the last five minutes and rising, sells under 40% of trades, reserve above $3k and growing, price up less than 300% from the first candle.\n2. Second wave (8–15 minutes old): first spike done, price 20–40% below it for at least three minutes, buyers-per-minute still positive, reserve not shrinking.\n\nBoth require: mint and freeze authority revoked, a Deepnets read with no bundling and no critical risks, top-10 holders under 30%, dev under 5%. Hard no's: fewer than 10 unique buyers, sells above buys in the last five minutes, reserve shrinking two ticks running, a token proposed in the last hour, a name copying this week's pump.\n\nPropose up to three a tick, best first, each with a two-sentence rationale: which setup, what buyers-per-minute and reserve are doing, and what would prove you wrong. Never propose the same token twice in one tick. If nothing qualifies, say so in one line and finish — never fill the gap with older tokens.\n\nClips are fixed and small; conviction shows in the order you propose, not the size. Sell when buyers-per-minute turn down two ticks in a row, into the first parabolic move, or the moment liquidity starts leaving; the guardian owns the stop, take profit and time limit. Cash between launches is the plan.",
    universe: {
      discovery: ["gecko_launches", "paid_launches", "new_launches"],
      minScore: 45,
      minLiquidityUsd: 2_000,
      // A two-minute-old mint has one to three holders (measured live 2026-09-22); a
      // floor here blocks the whole window. Distribution is judged by Deepnets instead.
      minHolderCount: 0,
      minAgeMinutes: 0,
      maxAgeHours: 0.25,
      maxTop10HolderPct: 30,
      requireMintRevoked: true,
      requireFreezeRevoked: true,
    },
    risk: {
      maxTradeUsd: 2,
      maxDailyTrades: 40,
      maxPositionPct: 25,
      maxDataSpendUsdPerRun: 1,
      stopLossPct: 40,
      takeProfitPct: 100,
      trailingStopPct: 30,
      maxHoldHours: 0.5,
      exitOnLiquidityDropPct: 30,
      slippageBps: 1_000,
    },
    execution: { mode: "approve", proposalTtlMinutes: 5 },
    schedule: { intervalMinutes: 5 },
  },
  {
    id: "fresh-launch",
    label: "Fresh launch hunter",
    blurb: "Lives in the first day of a token's life and leaves before the crowd.",
    chains: ["solana"],
    dataSources: ["deepnets-token-safety", "solenrich-launches", "x-search"],
    prompt:
      "You hunt tokens in their first day. Each tick, pull the new-launch feed and score everything on it. Ignore anything with a live mint or freeze authority no matter how well it scores elsewhere, and ignore anything whose organic component is below 60 — manufactured volume is the whole scam. Everything else that clears your bar is a candidate, whatever its 24h move: propose each one, best first, sized small, and let your owner pick. Hold up to three positions at once; a token already held is not a reason to skip the next one, and a new candidate does not have to outscore what you hold. Sell into the first parabolic move or the moment liquidity starts leaving. If the feed is all rugs, buy nothing and say so.",
  },
];

// ------------------------------------------------------------------ universe

export interface DiscoveryFeedMeta {
  id: DiscoveryFeedId;
  label: string;
  /** One line, plain English: what lands in the agent's lap when this is on. */
  description: string;
  /** The honest caveat. Every feed has one. */
  caveat: string;
}

/**
 * What the paid launch radar costs per chain, per tick. It is a discovery feed, not a
 * data source, so it lives in the universe config — but it is paid from the same data
 * budget, and a cost estimate that only counts data sources promises less than a run spends.
 */
export const PAID_LAUNCH_RADAR_USD_PER_CHAIN = 0.02;

/** The radar's share of a run's data bill: nothing unless the feed is on. */
export function launchRadarUsdPerRun(discovery: readonly string[], chains: readonly string[]): number {
  return discovery.includes("paid_launches") ? PAID_LAUNCH_RADAR_USD_PER_CHAIN * chains.length : 0;
}

export const DISCOVERY_FEEDS: DiscoveryFeedMeta[] = [
  {
    id: "new_launches",
    label: "New launches",
    description: "Tokens minted in the last few hours, the moment they get a pool.",
    caveat: "Where the rugs live. Your gates do all the work here.",
  },
  {
    id: "trending",
    label: "Trending",
    description: "What is being traded most across the chain right now.",
    caveat: "Crowded. You are rarely early to anything on this list.",
  },
  {
    id: "top_organic",
    label: "Top organic",
    description: "Volume that comes from real buyers rather than wash bots.",
    caveat: "Solana only — Base falls back to trending.",
  },
  {
    id: "momentum",
    label: "Momentum",
    description: "Tokens whose price, volume and holders are all accelerating.",
    caveat: "Derived from the other feeds, so it inherits their blind spots.",
  },
  {
    id: "gecko_launches",
    label: "Gecko-rated launches",
    description:
      "New and trending pools on GeckoTerminal, kept only when GeckoTerminal's own GT Score rates the token 50 or better.",
    caveat:
      "Free but rate limited to ~30 calls a minute, so a sweep checks at most 15 pools; a token minutes old has no GT Score yet and is skipped.",
  },
  {
    id: "paid_launches",
    label: "Paid launch radar",
    description: "A pre-screened launch feed bought each sweep — SolEnrich on Solana, gate402 on Base.",
    caveat: `The only feed that costs money: about $${PAID_LAUNCH_RADAR_USD_PER_CHAIN.toFixed(2)} per chain, per tick, from the data budget.`,
  },
];

export interface UniversePreset {
  id: string;
  label: string;
  blurb: string;
  /** Everything but the blocklist, which is personal and never overwritten. */
  values: Omit<UniverseConfig, "blocklist">;
}

const DEFAULT_UNIVERSE = DEFAULT_AGENT_CONFIG.universe;

/**
 * The fastest path for most people: one click sets the whole group. Each one is
 * a real posture, not a difficulty slider — they disagree about what to hunt,
 * not just about how much.
 */
export const UNIVERSE_PRESETS: UniversePreset[] = [
  {
    id: "degen",
    label: "Degen",
    blurb: "Fresh launches and thin books, with no give at all on authorities.",
    values: {
      discovery: ["gecko_launches", "paid_launches", "new_launches", "momentum"],
      minScore: 55,
      minLiquidityUsd: 5_000,
      minHolderCount: 50,
      minAgeMinutes: 15,
      maxAgeHours: 72,
      maxTop10HolderPct: 70,
      maxBuyTaxPct: 5,
      requireMintRevoked: true,
      requireFreezeRevoked: true,
    },
  },
  {
    id: "balanced",
    label: "Balanced",
    blurb: "Young enough to matter, liquid enough to leave. The default.",
    // Read from the shipped default rather than restated: it said "The default" while
    // adding top_organic, so a fresh agent never matched the card that claims to be it.
    values: {
      discovery: [...DEFAULT_UNIVERSE.discovery],
      minScore: DEFAULT_UNIVERSE.minScore,
      minLiquidityUsd: DEFAULT_UNIVERSE.minLiquidityUsd,
      minHolderCount: DEFAULT_UNIVERSE.minHolderCount,
      minAgeMinutes: DEFAULT_UNIVERSE.minAgeMinutes,
      maxAgeHours: DEFAULT_UNIVERSE.maxAgeHours,
      maxTop10HolderPct: DEFAULT_UNIVERSE.maxTop10HolderPct,
      maxBuyTaxPct: DEFAULT_UNIVERSE.maxBuyTaxPct,
      requireMintRevoked: DEFAULT_UNIVERSE.requireMintRevoked,
      requireFreezeRevoked: DEFAULT_UNIVERSE.requireFreezeRevoked,
    },
  },
  {
    id: "blue-chips",
    label: "Blue chips only",
    blurb: "Established names with deep books. It will trade rarely.",
    values: {
      discovery: ["trending", "top_organic"],
      minScore: 78,
      minLiquidityUsd: 250_000,
      minHolderCount: 5_000,
      minAgeMinutes: 1_440,
      maxAgeHours: null,
      maxTop10HolderPct: 35,
      maxBuyTaxPct: 0,
      requireMintRevoked: true,
      requireFreezeRevoked: true,
    },
  },
];

/**
 * Each hint says how many runs a day the interval is, because every run bills model
 * tokens to the owner's own key whether or not it trades, and the only cost the builder
 * used to quote was the data Tocker pays for. `types.test.ts` checks the counts.
 */
export const INTERVAL_PRESETS = [
  { minutes: 0, label: "Manual", hint: "Only runs when you press Run now." },
  { minutes: 5, label: "5 min", hint: "288 runs a day on your key. Fast and the most expensive." },
  { minutes: 15, label: "15 min", hint: "The default. 96 runs a day on your key." },
  { minutes: 60, label: "1 hour", hint: "24 runs a day. Calm, and a quarter of the default's model bill." },
  { minutes: 240, label: "4 hours", hint: "6 runs a day. Swing pace." },
  { minutes: 1_440, label: "Daily", hint: "One run a day." },
] as const;

/**
 * The line under a schedule choice. On the owner's key it is the fixed hint above. On pay
 * per use the cost is a number, so the hint is that number: runs a day, and what they are
 * expected to cost on the chosen model (`usdcEstimate`, the same figures as the panel).
 */
export function intervalHint(preset: { minutes: number; hint: string }, payPerUseModel?: string | null): string {
  if (!payPerUseModel) return preset.hint;
  if (preset.minutes === 0) return "Only runs when you press Run now. Nothing is spent until then.";
  const estimate = usdcEstimate(payPerUseModel, preset.minutes);
  // A model that is no longer offered has no price to quote, and the key wording
  // ("on your key") would be untrue for it.
  if (!estimate.model) return "Every run pays for its own thinking.";
  const runs = `About ${estimate.runsPerDay} run${estimate.runsPerDay === 1 ? "" : "s"} a day`;
  return `${runs}, about $${estimate.dayUsd.toFixed(2)} of thinking.`;
}

export const PAPER_BALANCES = [1_000, 10_000, 100_000] as const;

/**
 * Slider bounds shared by the builder and the settings form. They used to disagree
 * (settings started Max per trade at $10 in $10 steps), so the live checklist's $2
 * first-trade preset sat below the settings slider's floor and any nudge silently
 * rewrote it to $10. One definition, so every surface can hold what any other wrote.
 */
export const RISK_BOUNDS = {
  maxTradeUsd: { min: 1, max: 5_000, step: 1 },
} as const;

/**
 * Max per trade spans $1 to $5,000, but every sensible ticket sits under $500 — on a
 * linear phone track that is the first 30px. The slider walks this ladder instead;
 * the typed readout still takes any exact amount inside RISK_BOUNDS.
 */
export const MAX_TRADE_LADDER = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000];

/**
 * The stops a ladder slider offers. A value that is not a rung (typed, seeded, a
 * preset) becomes a stop of its own, so the thumb sits where the number is instead
 * of snapping it to a neighbour on first touch.
 */
export function ladderStops(ladder: readonly number[], value: number): number[] {
  return ladder.includes(value) ? [...ladder] : [...ladder, value].sort((a, b) => a - b);
}

/** Index of the stop closest to `value`. */
export function nearestStopIndex(stops: readonly number[], value: number): number {
  let best = 0;
  stops.forEach((stop, index) => {
    if (Math.abs(stop - value) < Math.abs(stops[best] - value)) best = index;
  });
  return best;
}

export const LLM_BOUNDS = {
  maxSteps: { min: 2, max: 40, step: 1 },
} as const;

export const STEPS = [
  { id: "identity", label: "Identity" },
  { id: "brain", label: "Brain" },
  { id: "data", label: "Data" },
  { id: "universe", label: "Universe" },
  { id: "risk", label: "Risk" },
  { id: "schedule", label: "Schedule" },
  { id: "review", label: "Review" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];
