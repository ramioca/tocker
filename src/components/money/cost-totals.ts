import type { MoneyAgentRow } from "@/server/queries/money";

/**
 * The bills, summed over one set of agents. What the Costs note prints. Three for an
 * owner whose agents think on their own key; a fourth, `thinkingUsd`, when any of them
 * has paid for its own thinking.
 */
export interface CostTotals {
  feesUsd: number;
  dataSpendUsd: number;
  /** The part of `dataSpendUsd` that was mock-mode and moved no money. */
  dataSpendSimulatedUsd: number;
  /** Agents with a published model price only; `unpricedAgents` says how many had none. */
  modelSpendUsd: number;
  unpricedAgents: number;
  /** Paid per use for thinking, confirmed on the ledger. Zero without pay-per-use. */
  thinkingUsd: number;
}

/**
 * Sum the costs of a set of agents.
 *
 * `getMoney`'s own totals are live-only on purpose — the headline is built on them and
 * nothing may add a notional to it. A paper-only account still has real per-agent costs
 * in its paper table, though, and a Costs note reading $0.00 under that table is a
 * contradiction. This is that note's sum for the paper case, kept out of the headline.
 */
export function sumCosts(rows: readonly MoneyAgentRow[]): CostTotals {
  const totals: CostTotals = {
    feesUsd: 0,
    dataSpendUsd: 0,
    dataSpendSimulatedUsd: 0,
    modelSpendUsd: 0,
    unpricedAgents: 0,
    thinkingUsd: 0,
  };
  for (const row of rows) {
    totals.feesUsd += row.feesUsd;
    totals.thinkingUsd += row.thinkingUsd;
    totals.dataSpendUsd += row.dataSpendUsd;
    totals.dataSpendSimulatedUsd += row.dataSpendSimulatedUsd;
    if (row.modelSpendUsd === null) totals.unpricedAgents += 1;
    else totals.modelSpendUsd += row.modelSpendUsd;
  }
  return totals;
}
