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
import { DATA_SOURCES } from "@/lib/data-sources/registry";
import { redactDeep, redactSecrets } from "@/lib/security/redact";
import { publicExitText } from "@/lib/trading/exits";
import type { AgentDetail, Chain, ExitReason, RunStep, TradeScore } from "@/server/types";

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
  // The owner reads their own transcript, with credentials removed: steps are scrubbed
  // when they are written now, and this covers the ones stored before that.
  return isOwner ? steps.map((step) => ({ ...step, payload: redactDeep(step.payload) })) : [];
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
 *
 * The owner reads the sentence with any credential in it removed. Their own key, half
 * masked by the provider, is theirs to see; the operator's RPC key or database password
 * is not, and an owner is any account. Scrubbed here as well as where errors are written,
 * because not every writer goes through one door and old rows were stored as they came.
 */
export const REDACTED_ERROR = "This run failed. The details are visible to the owner." as const;

export function visibleError(error: string | null | undefined, isOwner: boolean): string | null {
  if (!error) return null;
  return isOwner ? redactSecrets(error) : REDACTED_ERROR;
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

/**
 * Vendor names as a model writes them in prose. The registry's display names are long
 * ("Nansen Smart Money") and its ids are slugs; a rationale says "Nansen" or "a clean
 * Deepnets read". Removed sources stay here because rows that name them still exist.
 */
const PROVIDER_BRANDS = [
  "SentimentAlpha",
  "x402Atlas",
  "Xquik",
  "CoinMarketCap",
  "Deepnets",
  "Nansen",
  "Plexa",
  "gate402",
  "SolEnrich",
  "DripMetrics",
  "Otto AI",
  "AgentData",
  "x402 Bazaar",
  // Retired source: its registry name and id no longer come from DATA_SOURCES.
  "x402 Bazaar resource",
  "Bazaar",
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every spelling of a paid source, longest first so "Nansen Smart Money" is replaced
 * whole rather than leaving "Smart Money" behind. An optional "(paid)" goes with it.
 */
const SOURCE_NAME = (() => {
  const terms = new Set<string>(PROVIDER_BRANDS);
  for (const source of DATA_SOURCES) {
    terms.add(source.name);
    terms.add(source.id);
  }
  const alternatives = [...terms].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return new RegExp(`(?<![\\w-])(?:${alternatives.join("|")})(?![\\w-])(?:\\s*\\(paid\\))?`, "gi");
})();

/** "…, past my 35% target" — a clause that reads an operator's setting back. */
const THRESHOLD_CLAUSE = /,?\s+\b(?:past|through|under|above|below) my\b[^,;()]*?(?=\s*(?:[,;()]|\.(?!\d)|$))/gi;

/** A determiner right before the name ("a clean Deepnets read") wants an adjective. */
const DETERMINER_BEFORE = /\b(?:a|an|the|my|its|their|this)\s+(?:\S+\s+)?$/i;

function redactSourceNames(text: string): string {
  return text.replace(SOURCE_NAME, (_match, offset: number, whole: string) => {
    const before = whole.slice(0, offset);
    if (DETERMINER_BEFORE.test(before)) return "paid-source";
    return /(?:^|[.!?]\s+)$/.test(before) ? "A paid source" : "a paid source";
  });
}

/**
 * A trade's rationale as a viewer may read it.
 *
 * The rationale is public on purpose (SPEC rule 1): it is what makes the feed worth
 * reading. Two things in it are not. An automatic exit's text names the rule that fired
 * ("past my 35% target"), which next to the public fill price is the owner's setting;
 * and a model's buy note can name the data source it paid for, which is exactly the list
 * `toPublicProfile` reduces to a count.
 *
 * So a non-owner gets an exit rebuilt from its reason and the move it ended on, and any
 * other text with its threshold clauses cut and its vendor names replaced. The owner gets
 * the text untouched. This runs on read, so rows written before the exit engine learned
 * to write a public line are covered too.
 */
export function visibleRationale(
  text: string | null | undefined,
  opts: { isOwner: boolean; exitReason?: ExitReason | null; symbol?: string | null },
): string | null {
  if (text === null || text === undefined) return null;
  // A model writes this, and it can quote anything its owner pasted into the strategy.
  // A credential is cut for everyone, the owner included: this text is the public record.
  if (opts.isOwner) return redactSecrets(text);
  if (opts.exitReason) {
    // Every exit template writes the trade's move with a sign ("+91.5%", "−18.2%") and
    // the rule values without one, so the first signed percentage is the move.
    const move = /[+−-]\d+(?:\.\d+)?%/.exec(text)?.[0] ?? null;
    const pnlPct = move === null ? null : Number(move.replace("−", "-").replace("%", ""));
    const out = /(\$[\d,]+(?:\.\d+)?) out\.\s*$/.exec(text)?.[1];
    const line = publicExitText(opts.exitReason, opts.symbol || "the position", pnlPct);
    return out ? `${line} ${out} out.` : line;
  }
  return redactSecrets(redactSourceNames(text.replace(THRESHOLD_CLAUSE, "")));
}
