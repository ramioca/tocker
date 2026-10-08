/**
 * How long a proposal waits for its owner. A leaf with nothing but the config type, so
 * the book (`src/lib/agent/portfolio.ts`) can tell a proposal that is still waiting from
 * one whose time is up without importing the approval flow, which imports the book.
 */
import type { AgentConfig } from "@/db/schema";

/** Used when a config predates approval mode or carries a nonsense TTL. */
const DEFAULT_TTL_MINUTES = 60;

export function proposalTtlMinutes(config: AgentConfig): number {
  const raw = config.execution?.proposalTtlMinutes;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MINUTES;
}

export function proposalExpiresAt(proposedAt: Date, config: AgentConfig): Date {
  return new Date(proposedAt.getTime() + proposalTtlMinutes(config) * 60_000);
}
