/**
 * Agent configuration schema — the single source of truth for what an agent can be.
 * Used by the builder form (client), server actions (validation) and the run loop.
 */
import { z } from "zod";
import type { AgentConfigWithSizing } from "@/db/schema";
import { DEFAULT_SIZING } from "@/lib/trading/sizing";

export const chainSchema = z.enum(["solana", "base"]);

/**
 * The longest name an agent can have. One constant for the builder, the settings form
 * and the server: the builder used to stop at 48 and settings not at all, so a name
 * could be typed in one place that the other would not take.
 */
export const MAX_AGENT_NAME = 60;

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
export const llmProviderSchema = z.enum(["anthropic", "openai", "openrouter"]);

// The id → label list lives in a leaf module so display code can use it without zod.
export { DEFAULT_MODELS } from "./models";

export const agentConfigSchema = z.object({
  strategyPrompt: z.string().min(20, "Describe the strategy in at least a sentence").max(8000),
  dataSources: z.array(z.string()).max(12),
  chains: z.array(chainSchema).min(1, "Pick at least one chain"),
  universe: z.object({
    // `paid_launches` is the only feed that costs money; it runs a paid launch radar
    // per chain per sweep and is skipped when the run has no wallet or no budget.
    discovery: z
      .array(z.enum(["new_launches", "trending", "top_organic", "momentum", "gecko_launches", "paid_launches"]))
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
      .array(z.object({ chain: chainSchema, address: z.string().min(3), symbol: z.string().min(1).max(16) }))
      .max(200),
  }),
  risk: z.object({
    maxTradeUsd: z.number().positive().max(1_000_000),
    maxDailyTrades: z.number().int().min(1).max(500),
    maxPositionPct: z.number().min(1).max(100),
    maxDataSpendUsdPerRun: z.number().min(0).max(100),
    stopLossPct: z.number().min(0.1).max(99).nullable(),
    takeProfitPct: z.number().min(0.1).max(10_000).nullable(),
    slippageBps: z.number().int().min(1).max(5000),
    trailingStopPct: z.number().min(0.5).max(99).nullable(),
    maxHoldHours: z.number().min(0.25).max(24 * 365).nullable(),
    exitScoreBelow: z.number().min(0).max(100).nullable(),
    exitOnLiquidityDropPct: z.number().min(1).max(99).nullable(),
    sizing: positionSizingSchema.optional(),
  }),
  execution: z.object({
    mode: z.enum(["auto", "approve"]),
    proposalTtlMinutes: z.number().int().min(5).max(24 * 60),
  }),
  schedule: z.object({ intervalMinutes: z.number().int().min(0).max(10_080) }),
  llm: z.object({
    provider: llmProviderSchema,
    model: z.string().min(1),
    temperature: z.number().min(0).max(2),
    maxSteps: z.number().int().min(2).max(40),
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
    // $1: five scored tokens with safety, sentiment and smart money bought for each is
    // about $0.35 on Solana; $0.25 covered three and silently starved the rest.
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
  },
  // Ask-before-trading is the recommended first-agent posture (the builder says
  // so too). A new operator opts into "trade on its own"; they don't get it by default.
  execution: { mode: "approve", proposalTtlMinutes: 60 },
  schedule: { intervalMinutes: 15 },
  // 20 steps: portfolio, positions review, discovery, five scores, up to three proposals,
  // a note and a finish fit with room to widen a thin sweep; 12 forced a single proposal.
  llm: { provider: "anthropic", model: "claude-sonnet-5", temperature: 0.4, maxSteps: 20 },
};

export function parseAgentConfig(input: unknown): AgentConfigWithSizing {
  return agentConfigSchema.parse(input);
}
