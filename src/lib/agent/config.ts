/**
 * Agent configuration schema — the single source of truth for what an agent can be.
 * Used by the builder form (client), server actions (validation) and the run loop.
 */
import { z } from "zod";
import type { AgentConfig } from "@/db/schema";

export const chainSchema = z.enum(["solana", "base"]);
export const llmProviderSchema = z.enum(["anthropic", "openai", "openrouter"]);

export const DEFAULT_MODELS: Record<z.infer<typeof llmProviderSchema>, { id: string; label: string }[]> = {
  anthropic: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
  openai: [
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-5-mini", label: "GPT-5 mini" },
  ],
  openrouter: [
    { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5 (OpenRouter)" },
    { id: "nousresearch/hermes-4-405b", label: "Hermes 4 405B" },
    { id: "deepseek/deepseek-v4", label: "DeepSeek V4" },
  ],
};

export const agentConfigSchema = z.object({
  strategyPrompt: z.string().min(20, "Describe the strategy in at least a sentence").max(8000),
  dataSources: z.array(z.string()).max(12),
  chains: z.array(chainSchema).min(1, "Pick at least one chain"),
  universe: z.object({
    discovery: z.array(z.enum(["new_launches", "trending", "top_organic", "momentum"])).min(1, "Pick at least one way to find tokens"),
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
}) satisfies z.ZodType<AgentConfig>;

export type AgentConfigInput = z.input<typeof agentConfigSchema>;

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  strategyPrompt:
    "You hunt fresh Solana launches. Each tick, pull the new-launch and trending feeds, score every candidate, and buy the best one that clears your score floor and still has room to run. Prefer tokens under $2M market cap with real holder growth over tokens that already went vertical. Cut anything that loses its liquidity or stalls for two ticks.",
  dataSources: ["sentimentalpha", "cmc-quotes", "token-intel-sol"],
  chains: ["solana"],
  universe: {
    discovery: ["new_launches", "trending", "top_organic"],
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
    maxDataSpendUsdPerRun: 0.25,
    stopLossPct: 15,
    takeProfitPct: 40,
    slippageBps: 100,
    // Exit engine. Trailing stop off by default: a 30-40% retrace is normal for a
    // launch that is working; the fixed stop loss is the floor.
    trailingStopPct: null,
    maxHoldHours: null,
    exitScoreBelow: 40, // a held token that falls to "avoid" is sold
    exitOnLiquidityDropPct: 50, // half the pool gone = the exit door is closing
  },
  execution: { mode: "auto", proposalTtlMinutes: 60 },
  schedule: { intervalMinutes: 15 },
  llm: { provider: "anthropic", model: "claude-sonnet-5", temperature: 0.4, maxSteps: 12 },
};

export function parseAgentConfig(input: unknown): AgentConfig {
  return agentConfigSchema.parse(input);
}
