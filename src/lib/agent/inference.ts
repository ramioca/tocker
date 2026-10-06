/**
 * Where an agent's thinking comes from, decided in one place.
 *
 * An agent thinks on its owner's own LLM key, or, when its config says `source: "usdc"`,
 * on a model it pays for itself per step (src/lib/x402/inference-types.ts). Every part
 * of the app that used to ask "does this agent have a key?" asks this file instead: the
 * mode is the config's own word, never a guess from a missing key.
 */
import type { AgentConfig } from "@/db/schema";
import { DEFAULT_PAY_PER_USE_MODEL, type ThinkSource } from "@/lib/x402/inference-types";

/** A config with no `source` was written before the field existed, and is a key agent. */
export function thinkSource(config: Pick<AgentConfig, "llm"> | null | undefined): ThinkSource {
  return config?.llm?.source === "usdc" ? "usdc" : "key";
}

/** The model id the agent thinks on: the pay-per-use model for a usdc agent, the key's model otherwise. */
export function thinkingModel(config: Pick<AgentConfig, "llm"> | null | undefined): string {
  if (!config) return "";
  return thinkSource(config) === "usdc" ? (config.llm.usdc?.model ?? DEFAULT_PAY_PER_USE_MODEL) : config.llm.model;
}
