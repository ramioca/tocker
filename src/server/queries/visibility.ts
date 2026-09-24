/**
 * Strategy privacy — the one place that decides what a viewer is allowed to see.
 *
 * A user's strategy is their intellectual property: if anyone can read the prompt,
 * the universe rules and the transcript, the operator who wrote them has no edge and
 * no reason to publish a track record. The record stays public; the recipe does not.
 *
 * These are pure functions on purpose. The gate is enforced in the queries and in the
 * JSON route (two separate code paths), and both call into here so the rule is written
 * once and can be unit-tested without a database.
 */
import type { AgentConfig } from "@/db/schema";
import type { AgentDetail, Chain, RunStep, TradeScore } from "@/server/types";

export type PublicProfile = AgentDetail["publicProfile"];

/** Ownership is the only thing that unlocks the owner-only half of an agent. */
export function isAgentOwner(ownerId: string, viewerId?: string | null): boolean {
  return Boolean(viewerId) && viewerId === ownerId;
}

/**
 * The strategy prompt, the universe rules, the score thresholds and the list of data
 * sources it buys are all owner-only. Non-owners get `null` — never a redacted object,
 * because a redacted object is one careless spread away from leaking.
 */
export function visibleConfig(config: AgentConfig | null | undefined, isOwner: boolean): AgentConfig | null {
  if (!isOwner) return null;
  return config ?? null;
}

/**
 * What anyone may know about an agent: what it trades on and how often, never how it
 * decides. `dataSourceCount` is deliberately a count — which sources an operator pays
 * for is part of the system.
 */
export function toPublicProfile(config: AgentConfig | null | undefined): PublicProfile {
  const chains = (config?.chains ?? []) as Chain[];
  const interval = config?.schedule?.intervalMinutes;
  return {
    chains,
    model: config?.llm?.model ?? "",
    // 0 means "manual only" in the config; null reads better in the UI.
    intervalMinutes: typeof interval === "number" && interval > 0 ? interval : null,
    dataSourceCount: config?.dataSources?.length ?? 0,
  };
}

/**
 * The transcript shows which sources were queried, with what arguments, what came back
 * and in what order — that *is* the system, unlike a per-trade rationale, which is one
 * line written after the fact. Owner-only.
 */
export function visibleSteps(steps: RunStep[], isOwner: boolean): RunStep[] {
  return isOwner ? steps : [];
}

/**
 * What a non-owner may be told about a failure.
 *
 * `agent_runs.error` and `trades.error` are whatever the thing that broke said. That is
 * a provider string, verbatim: the AI SDK surfaces the vendor's `error.message`, so a
 * bad key produces `Incorrect API key provided: sk-proj-…`, an RPC produces a node URL
 * with its key in the query string, and a Privy policy denial names the policy and the
 * wallet. None of that is the track record, and some of it is a credential.
 *
 * The *fact* of the failure stays public — a run that failed shows as failed, a trade
 * that failed shows as failed, because a track record that quietly drops its losses is
 * worthless. Only the sentence explaining it is owner-only, and non-owners get a fixed
 * string rather than `null` so the row still reads as an explained failure instead of an
 * empty one.
 */
export const REDACTED_ERROR = "This run failed. The details are visible to the owner." as const;

export function visibleError(error: string | null | undefined, isOwner: boolean): string | null {
  if (!error) return null;
  return isOwner ? error : REDACTED_ERROR;
}

/**
 * Blockers that describe the token itself, whoever scored it. Every other hard gate is
 * the agent's universe answering back — `liquidity_below_floor` next to the snapshot's
 * public `liquidityUsd` bounds `minLiquidityUsd`, `blocklisted` reveals the blocklist,
 * `mint_authority_active` reveals `requireMintRevoked` — so those are owner-only.
 */
const INTRINSIC_BLOCKERS = new Set(["honeypot", "cannot_sell"]);

/**
 * A trade's score snapshot as a non-owner may see it. The total, the verdict and the free
 * components stay public: they are the verdict on a token at one moment. What goes:
 *  - `sentiment` and `smartMoney`, which are non-null only when the agent *paid* for
 *    those x402 sources — which sources an operator buys is owner-only (SPEC rule 1);
 *  - every universe-relative blocker (see `INTRINSIC_BLOCKERS`).
 */
export function visibleScore(score: TradeScore | null, isOwner: boolean): TradeScore | null {
  if (!score || isOwner) return score;
  return {
    ...score,
    components: { ...score.components, sentiment: null, smartMoney: null },
    blockers: score.blockers.filter((b) => INTRINSIC_BLOCKERS.has(b)),
  };
}

/**
 * How far a position is from its stop and its target. Both are computed from the agent's
 * `stopLossPct` / `takeProfitPct`, and the row also carries `unrealizedPnlPct`, so the
 * threshold is one subtraction away. Owner-only.
 */
export function visibleExitDistances<T extends { stopDistancePct: number | null; takeProfitDistancePct: number | null }>(
  position: T,
  isOwner: boolean,
): T {
  return isOwner ? position : { ...position, stopDistancePct: null, takeProfitDistancePct: null };
}
