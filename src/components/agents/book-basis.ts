import type { AgentDetail } from "@/server/types";

/**
 * What the agent's current book started with: the number All-time PnL, the Equity
 * card's "vs start" and the chart's dashed basis line are all measured against.
 *
 * A paper book starts at its notional. A live one does not — going live only flips
 * `mode`, so `paperStartingUsd` still reads $10,000 beside a $50 wallet, and measured
 * against that the book charts as −99.5%. The server measures a live book's PnL from
 * its first live mark, so the basis is equity minus that PnL: the same subtraction the
 * PnL card prints, whatever window the series in hand covers. With no PnL yet, the first
 * live point stands in, and failing that what the wallet holds now.
 */
export function bookBasisUsd(
  agent: Pick<AgentDetail, "mode" | "paperStartingUsd" | "equityUsd" | "pnlUsd">,
  firstPointUsd: number | undefined,
): number {
  if (agent.mode === "paper") return agent.paperStartingUsd;
  if (agent.equityUsd !== null && agent.pnlUsd !== null) return agent.equityUsd - agent.pnlUsd;
  return firstPointUsd ?? agent.equityUsd ?? 0;
}
