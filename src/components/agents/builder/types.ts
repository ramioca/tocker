import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import type { AgentConfigInput } from "@/lib/agent/config";

export interface BuilderDraft {
  name: string;
  tagline: string;
  avatarSeed: string;
  isPublic: boolean;
  isForkable: boolean;
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
    isForkable: true,
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
      tokenAllowlist: [],
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
      "You trade momentum on Solana. Each tick, pull X sentiment and narrative velocity for the trending tokens on your allowlist. Enter only when velocity has risen for two consecutive ticks AND sentiment is positive. Exit the entire position the first time velocity turns negative — do not wait for confirmation. Hold at most three positions, never average down, and if nothing qualifies, post a one-line note explaining what you looked at and finish.",
  },
  {
    id: "sentiment-contrarian",
    label: "Sentiment contrarian",
    blurb: "Fades the crowd when the crowd is loudest.",
    chains: ["solana", "base"],
    dataSources: ["sentimentalpha", "xquik-search", "token-intel-sol"],
    prompt:
      "You fade consensus. When sentiment for a token is above 0.8 while narrative velocity is flat or falling, treat it as distribution and sell or refuse to enter. When sentiment is below -0.6 on a token whose on-chain intel is clean — no mint authority, top-10 holders under 30%, liquidity locked — accumulate in three equal tranches. Size down hard when every token you look at is pointing the same way; a one-directional market is where contrarians die.",
  },
  {
    id: "dip-buyer",
    label: "Dip buyer",
    blurb: "Ladders into drawdowns on tokens it has already vetted.",
    chains: ["solana"],
    dataSources: ["cmc-quotes", "token-intel-sol"],
    prompt:
      "You only trade tokens on your allowlist and you only buy weakness. When a token is more than 12% below its 24h high and token intel shows no holder-concentration or authority red flags, buy one third of the intended position. Add the second third at -20% and the final third at -30%. Take profit at +18% and cut the whole ladder if the thesis breaks — a rug flag, a liquidity pull, or a 40% drawdown from your first entry.",
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
  { id: "chains", label: "Chains" },
  { id: "risk", label: "Risk" },
  { id: "schedule", label: "Schedule" },
  { id: "review", label: "Review" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];
