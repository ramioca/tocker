/**
 * Agent configuration schema — the single source of truth for what an agent can be.
 * Used by the builder form (client), server actions (validation) and the run loop.
 */
import { z } from "zod";
import type { AgentConfig, AgentConfigWithSizing } from "@/db/schema";
import { DEFAULT_SIZING } from "@/lib/trading/sizing";
import { MAX_DATA_SPEND_PER_RUN_USD } from "@/lib/x402/types";
import { USDC_DAY_CAP, USDC_RUN_CAP } from "@/lib/x402/inference-types";
import { DEFAULT_MODEL_ID, MAX_MODEL_ID, MODEL_ID_PATTERN } from "./models";
import { PROVIDER_IDS } from "./providers";

export const chainSchema = z.enum(["solana", "base"]);

/** The shortest schedule an agent may run on, in minutes. */
export const MIN_SCHEDULE_MINUTES = 5;

/** The highest `risk.maxOpenPositions` can be set. Above this it is not a limit anyone means. */
export const MAX_OPEN_POSITIONS = 50;

/** The largest `risk.cashReserveUsd` the schema takes: the same ceiling as one trade. */
export const MAX_CASH_RESERVE_USD = 1_000_000;

/**
 * Source ids that used to be in the registry and are still in saved configs. They are
 * dropped on parse, and the live checklist ignores them, so an agent that names one is
 * not left with a pick it cannot see and cannot untick.
 */
export const RETIRED_DATA_SOURCE_IDS: readonly string[] = ["bazaar"];

/**
 * The longest name an agent can have. One constant for the builder, the settings form
 * and the server: the builder used to stop at 48 and settings not at all, so a name
 * could be typed in one place that the other would not take.
 */
export const MAX_AGENT_NAME = 60;

// The rule for a model id lives beside the model list (`models.ts`, a leaf module), so
// the picker can apply it to what somebody types before the schema ever sees it.
export { MAX_MODEL_ID };
const MODEL_ID = MODEL_ID_PATTERN;
const NOT_A_MODEL_ID = "That does not look like a model id";

/**
 * How big a ticket is. Optional, because every config written before sizing existed
 * has no such block and must keep behaving exactly as it did — `readSizing()` in
 * `src/lib/trading/sizing.ts` turns an absent block into plain `fixed_usd`.
 */
export const positionSizingSchema = z.object({
  mode: z.enum(["fixed_usd", "percent_equity", "volatility_scaled"]),
  percentOfEquity: z.number().min(0.1).max(100),
  referenceRangePct: z.number().min(1).max(500),
  minTradeUsd: z.number().min(0).max(1_000_000),
});
// The providers a key can be added for, read from the one list. A stored config that
// names any other fails to parse, which is what stops its run before a key is touched.
export const llmProviderSchema = z.enum(PROVIDER_IDS);

// The id → label list lives in a leaf module so display code can use it without zod.
export { DEFAULT_MODELS } from "./models";
export { DEFAULT_MODEL_ID };

export const agentConfigSchema = z.object({
  strategyPrompt: z.string().min(20, "Describe the strategy in at least a sentence.").max(8000),
  dataSources: z
    .array(z.string().max(64))
    .max(12)
    .transform((ids) => ids.filter((id) => !RETIRED_DATA_SOURCE_IDS.includes(id))),
  // A chain named twice is the same list. Everything downstream works per chain (a
  // wallet each, a discovery sweep each), so a repeat must not make any of it run twice.
  chains: z
    .array(chainSchema)
    .min(1, "Pick at least one chain")
    .transform((chains) => [...new Set(chains)]),
  universe: z.object({
    // Two feeds cost money. `paid_launches` runs a paid launch radar per chain per sweep
    // and is skipped when the run has no wallet or no budget. `smart_money` buys Nansen's
    // board once per chain per tick; it is in no default and no preset, and it buys
    // nothing unless `dataSources` also names `nansen-smart-money`.
    discovery: z
      .array(
        z.enum(["new_launches", "trending", "top_organic", "momentum", "gecko_launches", "paid_launches", "smart_money"]),
      )
      .min(1, "Pick at least one way to find tokens"),
    minScore: z.number().min(0).max(100),
    minLiquidityUsd: z.number().min(0).max(100_000_000),
    minHolderCount: z.number().int().min(0).max(10_000_000),
    minAgeMinutes: z.number().int().min(0).max(525_600),
    maxAgeHours: z.number().min(0).max(87_600).nullable(),
    maxTop10HolderPct: z.number().min(1).max(100),
    maxBuyTaxPct: z.number().min(0).max(100),
    requireMintRevoked: z.boolean(),
    requireFreezeRevoked: z.boolean(),
    blocklist: z
      .array(z.object({ chain: chainSchema, address: z.string().min(3).max(64), symbol: z.string().min(1).max(16) }))
      .max(200),
  }),
  risk: z.object({
    maxTradeUsd: z.number().positive().max(1_000_000),
    maxDailyTrades: z.number().int().min(1).max(500),
    maxPositionPct: z.number().min(1).max(100),
    // Clamped, not rejected: a config saved before the ceiling existed still parses,
    // and reads back as what a run will actually be allowed to spend.
    maxDataSpendUsdPerRun: z
      .number()
      .min(0)
      .max(100)
      .transform((usd) => Math.min(usd, MAX_DATA_SPEND_PER_RUN_USD)),
    stopLossPct: z.number().min(0.1).max(99).nullable(),
    takeProfitPct: z.number().min(0.1).max(10_000).nullable(),
    slippageBps: z.number().int().min(1).max(5000),
    trailingStopPct: z.number().min(0.5).max(99).nullable(),
    maxHoldHours: z.number().min(0.25).max(24 * 365).nullable(),
    exitScoreBelow: z.number().min(0).max(100).nullable(),
    exitOnLiquidityDropPct: z.number().min(1).max(99).nullable(),
    sizing: positionSizingSchema.optional(),
    // Both optional, with no default written: a config saved before they existed has
    // neither and must keep behaving exactly as it did. `readMaxOpenPositions` and
    // `readCashReserveUsd` (src/lib/trading/risk.ts) turn an absent one into "no limit"
    // and "no reserve", the way `readSizing` does for the block above.
    maxOpenPositions: z.number().int().min(1).max(MAX_OPEN_POSITIONS).nullable().optional(),
    cashReserveUsd: z.number().min(0).max(MAX_CASH_RESERVE_USD).optional(),
  }),
  execution: z.object({
    mode: z.enum(["auto", "approve"]),
    proposalTtlMinutes: z.number().int().min(5).max(24 * 60),
  }),
  schedule: z.object({
    // 0 is "only when I press Run". Otherwise never more often than the cron that wakes
    // agents (every five minutes): a shorter interval only meant one agent took a slot in
    // every pass, ahead of everyone else's. The builder's shortest choice is five.
    intervalMinutes: z
      .number()
      .int()
      .min(0)
      .max(10_080)
      .transform((minutes) => (minutes > 0 && minutes < MIN_SCHEDULE_MINUTES ? MIN_SCHEDULE_MINUTES : minutes)),
    // Optional for the same reason as the two limits above: absent is off.
    skipWhenFull: z.boolean().optional(),
  }),
  llm: z.object({
    provider: llmProviderSchema,
    model: z.string().min(1).max(MAX_MODEL_ID, NOT_A_MODEL_ID).regex(MODEL_ID, NOT_A_MODEL_ID),
    temperature: z.number().min(0).max(2),
    maxSteps: z.number().int().min(2).max(40),
    // Optional, with no default written: a key agent's stored config is unchanged by
    // this field existing, and a config without it is a key agent (`thinkSource`).
    source: z.enum(["key", "usdc"]).optional(),
    usdc: z
      .object({
        model: z.string().min(1).max(MAX_MODEL_ID, NOT_A_MODEL_ID).regex(MODEL_ID, NOT_A_MODEL_ID),
        maxUsdPerRun: z.number().min(USDC_RUN_CAP.min).max(USDC_RUN_CAP.max),
        maxUsdPerDay: z.number().min(USDC_DAY_CAP.min).max(USDC_DAY_CAP.max),
      })
      .optional(),
  }),
}) satisfies z.ZodType<AgentConfigWithSizing>;

export type AgentConfigInput = z.input<typeof agentConfigSchema>;

export const DEFAULT_AGENT_CONFIG: AgentConfigWithSizing = {
  strategyPrompt:
    "You hunt fresh Solana launches. Each tick, pull the new-launch and trending feeds, score every candidate, and buy the best one that clears your score floor and still has room to run. Prefer tokens under $2M market cap with real holder growth over tokens that already went vertical. Cut anything that loses its liquidity or stalls for two ticks.",
  // W7: only sources whose upstream answered a real 402 on 2026-09-21. token-intel-sol
  // (503, suspended) and sentimentalpha (malformed EIP-712 domain) are not defaults.
  dataSources: ["x-search", "cmc-quotes", "deepnets-token-safety"],
  chains: ["solana"],
  universe: {
    // Launch feeds lead: GeckoTerminal's rated launches (free) and the paid radar when
    // a source for it is configured; Jupiter's lists fill the table after them.
    discovery: ["gecko_launches", "paid_launches", "new_launches", "trending"],
    minScore: 62,
    minLiquidityUsd: 15_000,
    minHolderCount: 150,
    // 30 minutes is the cheapest rug filter there is: most snipe-and-dump rugs
    // are over before then, and nothing worth holding is gone in half an hour.
    minAgeMinutes: 30,
    maxAgeHours: null,
    maxTop10HolderPct: 60,
    maxBuyTaxPct: 5,
    requireMintRevoked: true,
    requireFreezeRevoked: true,
    blocklist: [],
  },
  risk: {
    maxTradeUsd: 100,
    maxDailyTrades: 10,
    maxPositionPct: 25,
    // $1: room for the launch radar and for safety, sentiment and smart money on every
    // token a tick scores (about three cents a token on Solana), with the smart money
    // board on top when its feed is on. $0.25 once covered three tokens and silently
    // starved the rest.
    maxDataSpendUsdPerRun: 1,
    stopLossPct: 15,
    takeProfitPct: 40,
    // 3%: Jupiter Ultra itself picks 300-500 bps on the launch-day tokens this product
    // trades; at 100 bps a fresh agent could not fill its first buy.
    slippageBps: 300,
    // Exit engine. Trailing stop off by default: a 30-40% retrace is normal for a
    // launch that is working; the fixed stop loss is the floor.
    trailingStopPct: null,
    maxHoldHours: null,
    exitScoreBelow: 40, // a held token that falls to "avoid" is sold
    exitOnLiquidityDropPct: 50, // half the pool gone = the exit door is closing
    // Fixed USD by default: it is the mode an operator can reason about on day one,
    // and the only one that behaves identically whether or not equity has been marked.
    sizing: { ...DEFAULT_SIZING },
    // Both off: an agent holds as many tokens as its other limits allow and may spend
    // its last dollar, as every agent did before these existed.
    maxOpenPositions: null,
    cashReserveUsd: 0,
  },
  // Ask-before-trading is the recommended first-agent posture (the builder says
  // so too). A new operator opts into "trade on its own"; they don't get it by default.
  execution: { mode: "approve", proposalTtlMinutes: 60 },
  schedule: { intervalMinutes: 15, skipWhenFull: false },
  // 20 steps: portfolio, positions review, discovery, five scores, up to three proposals,
  // a note and a finish fit with room to widen a thin sweep; 12 forced a single proposal.
  llm: { provider: "anthropic", model: DEFAULT_MODEL_ID.anthropic, temperature: 0.4, maxSteps: 20 },
};

/**
 * A stored config as every reader should see it: the two rewrites the schema makes on
 * write (retired source ids dropped, data budget inside the ceiling), applied on read so
 * a row saved before them does not have to be re-saved first.
 *
 * And the three settings a row may predate (the position limit, the cash reserve, the
 * skip switch) said out loud as off. The settings page compares its working copy with
 * this one, so a switch turned on and off again has to come back to the same words.
 */
export function readStoredConfig(config: AgentConfig): AgentConfig {
  return {
    ...config,
    dataSources: config.dataSources.filter((id) => !RETIRED_DATA_SOURCE_IDS.includes(id)),
    risk: {
      ...config.risk,
      maxDataSpendUsdPerRun: Math.min(config.risk.maxDataSpendUsdPerRun, MAX_DATA_SPEND_PER_RUN_USD),
      maxOpenPositions: config.risk.maxOpenPositions ?? null,
      cashReserveUsd: config.risk.cashReserveUsd ?? 0,
    },
    schedule: { ...config.schedule, skipWhenFull: config.schedule.skipWhenFull ?? false },
  };
}

export function parseAgentConfig(input: unknown): AgentConfigWithSizing {
  return agentConfigSchema.parse(input);
}
