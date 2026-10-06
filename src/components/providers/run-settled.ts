/**
 * The client caches a finished run can have changed, for the agent it ran on. Pure, so
 * the list can be checked against the components that own those queries.
 *
 * A run writes its own row, any fills, and through them the agent's cash and positions.
 * The page is re-rendered separately (`router.refresh()`); these are the reads a server
 * refresh does not reach, because a query keeps its own data once it has mounted.
 */
import { walletBalancesKey } from "@/components/agents/settings/wallet-query-keys";
import { ME_WALLETS_QUERY_KEY } from "@/components/wallets/use-cash";

export function queryKeysStaleAfterRun(agentId: string): ReadonlyArray<readonly unknown[]> {
  return [
    // The Runs tab (runs-timeline.tsx) and the Trades tab (trades-table.tsx).
    ["agent-runs", agentId],
    ["agent-trades", agentId],
    // The agent's wallet balance, wherever it is shown.
    walletBalancesKey(agentId),
    // The top bar's cash counts what a live agent holds, at its marks.
    ME_WALLETS_QUERY_KEY,
  ];
}
