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
  tokenAllowlist: z
    .array(z.object({ chain: chainSchema, address: z.string().min(3), symbol: z.string().min(1).max(16) }))
    .max(50),
  risk: z.object({
    maxTradeUsd: z.number().positive().max(1_000_000),
    maxDailyTrades: z.number().int().min(1).max(500),
    maxPositionPct: z.number().min(1).max(100),
    maxDataSpendUsdPerRun: z.number().min(0).max(100),
    stopLossPct: z.number().min(0.1).max(99).nullable(),
    takeProfitPct: z.number().min(0.1).max(10_000).nullable(),
    slippageBps: z.number().int().min(1).max(5000),
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
    "You are a momentum trader on Solana memecoins. Each tick, check X sentiment for the top trending tokens, buy when narrative velocity is rising and sentiment is positive, sell when velocity flips negative. Never hold more than 3 positions.",
  dataSources: ["sentimentalpha", "cmc-quotes", "token-intel-sol"],
  chains: ["solana"],
  tokenAllowlist: [],
  risk: {
    maxTradeUsd: 100,
    maxDailyTrades: 10,
    maxPositionPct: 25,
    maxDataSpendUsdPerRun: 0.25,
    stopLossPct: 15,
    takeProfitPct: 40,
    slippageBps: 100,
  },
  schedule: { intervalMinutes: 15 },
  llm: { provider: "anthropic", model: "claude-sonnet-5", temperature: 0.4, maxSteps: 12 },
};

export function parseAgentConfig(input: unknown): AgentConfig {
  return agentConfigSchema.parse(input);
}
