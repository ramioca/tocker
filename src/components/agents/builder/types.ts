import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import type { AgentConfigInput } from "@/lib/agent/config";
import type { AgentConfig } from "@/db/schema";

export type UniverseConfig = AgentConfig["universe"];
export type DiscoveryFeedId = UniverseConfig["discovery"][number];
export type BlocklistEntry = UniverseConfig["blocklist"][number];

export interface BuilderDraft {
  name: string;
  tagline: string;
  avatarSeed: string;
  isPublic: boolean;
  llmKeyId: string | null;
  paperStartingUsd: number;
  activate: boolean;
  config: AgentConfigInput;
}

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

export interface StrategyPreset {
  id: string;
  label: string;
  blurb: string;
  prompt: string;
  chains: Array<"solana" | "base">;
  dataSources: string[];
}

/** Three ways to start. Each one is a complete, defensible thesis, not filler. */
export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: "momentum",
    label: "Momentum",
    blurb: "Buys accelerating attention, exits the moment it decelerates.",
    chains: ["solana"],
    dataSources: ["sentimentalpha", "cmc-quotes"],
    prompt:
      "You trade momentum on Solana. Each tick, score the trending and momentum feeds, then pull X sentiment and narrative velocity for the three highest scorers that clear your bar. Enter only when velocity has risen for two consecutive ticks AND sentiment is positive. Exit the entire position the first time velocity turns negative — do not wait for confirmation. Hold at most three positions, never average down, and if nothing qualifies, post a one-line note explaining what you looked at and finish.",
  },
  {
    id: "sentiment-contrarian",
    label: "Sentiment contrarian",
    blurb: "Fades the crowd when the crowd is loudest.",
    chains: ["solana", "base"],
    dataSources: ["sentimentalpha", "xquik-search", "token-intel-sol"],
    prompt:
      "You fade consensus. When sentiment for a token is above 0.8 while narrative velocity is flat or falling, treat it as distribution and sell or refuse to enter. When sentiment is below -0.6 on a token that still scores above your bar — clean authorities, distribution component above 60, liquidity holding — accumulate in three equal tranches. Size down hard when every token you look at is pointing the same way; a one-directional market is where contrarians die.",
  },
  {
    id: "fresh-launch",
    label: "Fresh launch hunter",
    blurb: "Lives in the first day of a token's life and leaves before the crowd.",
    chains: ["solana"],
    dataSources: ["token-intel-sol", "sentimentalpha"],
    prompt:
      "You hunt tokens in their first day. Each tick, pull the new-launch feed and score everything on it. Ignore anything with a live mint or freeze authority no matter how well it scores elsewhere, and ignore anything whose organic component is below 60 — manufactured volume is the whole scam. Take one position at a time in the highest scorer that clears your bar, size it small, and sell into the first parabolic move or the moment liquidity starts leaving. If the feed is all rugs, buy nothing and say so.",
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
    id: "paid_launches",
    label: "Paid launch radar",
    description: "A pre-screened launch feed bought each sweep — SolEnrich on Solana, gate402 on Base.",
    caveat: "The only feed that costs money: about $0.02 per chain, per tick, from the data budget.",
  },
];

export interface UniversePreset {
  id: string;
  label: string;
  blurb: string;
  /** Everything but the blocklist, which is personal and never overwritten. */
  values: Omit<UniverseConfig, "blocklist">;
}

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
      discovery: ["new_launches", "momentum"],
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
    values: {
      discovery: ["new_launches", "trending", "top_organic"],
      minScore: 62,
      minLiquidityUsd: 15_000,
      minHolderCount: 150,
      minAgeMinutes: 30,
      maxAgeHours: null,
      maxTop10HolderPct: 60,
      maxBuyTaxPct: 5,
      requireMintRevoked: true,
      requireFreezeRevoked: true,
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

export const INTERVAL_PRESETS = [
  { minutes: 0, label: "Manual", hint: "Only runs when you press Run now." },
  { minutes: 5, label: "5 min", hint: "Fast. Expect real LLM and data costs." },
  { minutes: 15, label: "15 min", hint: "The default. Reacts within a candle." },
  { minutes: 60, label: "1 hour", hint: "Calm. Good for slower theses." },
  { minutes: 240, label: "4 hours", hint: "Swing pace." },
  { minutes: 1_440, label: "Daily", hint: "One decision a day." },
] as const;

export const PAPER_BALANCES = [1_000, 10_000, 100_000] as const;

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
