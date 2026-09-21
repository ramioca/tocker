/**
 * What actually happened in a tick, derived from the run detail (W7 B6).
 *
 * Pure and server-safe on purpose — no `"use client"`, no hooks, no React — so the one
 * piece of logic that decides whether the operator is looking at a fill, a question, a
 * refusal or an empty tick can be unit-tested without a browser.
 *
 * It exists because the wizard used to get this wrong in the most expensive way
 * possible. In approval mode `place_trade` writes a `trades` row with
 * `status: "proposed"` and `amountToken: "0"` and routes nothing; the wizard took the
 * first trade on the run and rendered it as a completed buy. An operator watching their
 * first live trade was shown "Bought FARTCOIN" over a transaction that did not exist and
 * a decision nobody had made. The inverse was just as bad: a tick the risk guard refused
 * showed "The run finished without trading. That is a normal outcome" — when the actual
 * outcome was a rejection with a reason attached to it.
 *
 * So: a proposal is a proposal, a refusal is shown with its reason, and "nothing
 * happened" is claimed only when nothing was attempted.
 */
import type { RunDetail, TradeRow } from "@/server/types";

/** Something the agent tried to do and was not allowed to, with the reason given. */
export interface RunRefusal {
  /** The token it was about, when the step says. */
  symbol: string | null;
  /** The guard's or the venue's own words. */
  reason: string;
  /** True when the risk guard refused it, as opposed to the venue failing it. */
  byGuard: boolean;
}

export interface RunOutcome {
  /** Still in flight — say nothing about the result yet. */
  inFlight: boolean;
  /** The trade the receipt panel should frame, or null when there is none. */
  trade: TradeRow | null;
  /**
   * How to frame it. `proposed` is the one the old code could not express: a question
   * waiting on the operator, not a fill.
   */
  state: "none" | "pending" | "proposed" | "filled" | "failed";
  /** Guard rejections and `place_trade` failures, newest last. */
  refusals: RunRefusal[];
  /**
   * True only when the run is over, nothing was attempted and nothing was refused —
   * the one case where "it sat this tick out" is the truth.
   */
  finishedWithoutTrading: boolean;
}

/** Live money first, then the most decisive status. */
const STATE_RANK: Record<TradeRow["status"], number> = {
  filled: 5,
  proposed: 4,
  submitted: 3,
  pending: 3,
  failed: 2,
  rejected: 2,
  expired: 1,
};

function rank(trade: TradeRow): number {
  return STATE_RANK[trade.status] + (trade.isPaper ? 0 : 0.5);
}

const STATE_BY_STATUS: Record<TradeRow["status"], RunOutcome["state"]> = {
  filled: "filled",
  proposed: "proposed",
  submitted: "pending",
  pending: "pending",
  failed: "failed",
  rejected: "failed",
  // A proposal nobody answered before its TTL ran out. Nothing moved, and saying so is
  // the point: it is not a fill and it is not "nothing was attempted" either.
  expired: "failed",
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Pulls the `place_trade` refusals out of the transcript.
 *
 * The tool returns `{ ok: false, reason, rejected? }` rather than throwing, so a rejected
 * trade leaves no `trades` row at all — the reason lives only here. A thrown tool records
 * an `error` step instead, which is the same news in a different shape.
 */
export function refusalsFromSteps(steps: readonly RunDetail["steps"][number][]): RunRefusal[] {
  const out: RunRefusal[] = [];
  for (const step of steps) {
    if (step.toolName !== "place_trade") continue;

    if (step.kind === "tool_result") {
      const result = step.payload.result as Record<string, unknown> | undefined;
      if (!result || result.ok !== false) continue;
      const reason = asString(result.reason);
      if (reason === null) continue;
      // `alreadyProposed` is the model being told to stop repeating itself, not a refusal
      // the operator needs to see.
      if (result.alreadyProposed === true) continue;
      out.push({
        symbol: asString(result.symbol),
        reason,
        byGuard: result.rejected === true,
      });
      continue;
    }

    if (step.kind === "error") {
      const reason = asString(step.payload.error);
      if (reason !== null) out.push({ symbol: null, reason, byGuard: false });
    }
  }
  return out;
}

/** Everything the wizard needs to say the true thing about one tick. */
export function deriveRunOutcome(run: RunDetail | null): RunOutcome {
  if (run === null) {
    return { inFlight: false, trade: null, state: "none", refusals: [], finishedWithoutTrading: false };
  }

  const inFlight = run.status === "running" || run.status === "queued";
  const refusals = refusalsFromSteps(run.steps);

  // A proposal, a fill and a failure can all be on the same run in principle; show the
  // one that most demands the operator's attention, preferring real money over paper.
  const trade = run.trades.reduce<TradeRow | null>(
    (best, candidate) => (best === null || rank(candidate) > rank(best) ? candidate : best),
    null,
  );

  const state: RunOutcome["state"] = trade === null ? "none" : STATE_BY_STATUS[trade.status];

  return {
    inFlight,
    trade,
    state,
    refusals,
    finishedWithoutTrading:
      !inFlight && trade === null && refusals.length === 0 && (run.error === null || run.error === ""),
  };
}
