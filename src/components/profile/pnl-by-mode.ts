import type { AgentCard } from "@/server/types";

export interface PnlByMode {
  /** Summed over live agents with a PnL on record; null when there is none to sum. */
  live: number | null;
  paper: number | null;
  liveAgents: number;
  paperAgents: number;
}

/**
 * A profile's PnL, split by whether the money was real. Summing the two is the bug this
 * exists to prevent: a paper agent's +$297 printed as a profile's "Total PnL" reads as
 * money somebody made.
 *
 * An agent with no snapshot yet (`pnlUsd === null`) counts as an agent but adds no
 * number, so a profile whose only live agent has never been marked prints "—", not $0.
 */
export function pnlByMode(agents: ReadonlyArray<Pick<AgentCard, "mode" | "pnlUsd">>): PnlByMode {
  const out: PnlByMode = { live: null, paper: null, liveAgents: 0, paperAgents: 0 };
  for (const agent of agents) {
    const key = agent.mode === "live" ? "live" : "paper";
    if (key === "live") out.liveAgents += 1;
    else out.paperAgents += 1;
    if (agent.pnlUsd !== null && Number.isFinite(agent.pnlUsd)) out[key] = (out[key] ?? 0) + agent.pnlUsd;
  }
  return out;
}
