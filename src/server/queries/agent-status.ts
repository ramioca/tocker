import "server-only";
/**
 * "What is it waiting on?"
 *
 * Fourteen runs in a row proposed nothing and the operator had to read a transcript to
 * find out why; the answer was the daily buy limit, a number two clicks away in
 * Settings. Nothing on the agent page said so. This query is the answer to that
 * question, stated in one sentence per blocker, with the fix one click away.
 *
 * Three rules hold it together:
 *
 * 1. **Owner only.** Every line here quotes the agent's own thresholds — its daily
 *    limit, its clip, its age window — which is strategy (SPEC rule 1). A viewer who
 *    is not the owner gets `[]`, from the query, not from the component.
 * 2. **A failed read contributes nothing.** Each input is fetched in parallel and
 *    guarded: an unreachable Solana RPC or a Privy hiccup silently drops the line it
 *    would have produced rather than failing the page or, worse, asserting something
 *    false. The one case worth naming: a live wallet that could not be read makes
 *    `cashUsd` understate the book (`Portfolio.cashReadFailed`), so the cash warning is
 *    withheld — "you have no money" is the last thing to guess at.
 * 3. **Never a full banner for a healthy agent.** There is no "everything is fine" row
 *    and no next-tick line: when there is nothing to say this returns `[]` and the
 *    banner renders nothing. Four items is the ceiling — past that it is a log, not a
 *    banner.
 *
 * The decisions themselves live in {@link deriveStatus} and {@link classifyRunError},
 * which are pure: every phrasing below is tested against the sentences the providers
 * and the run loop actually produce, with no database in the way.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { agentRunSteps, agentRuns, agents, getDb, trades, users } from "@/db";
import type { AgentConfig } from "@/db/schema";
import { redactSecrets } from "@/lib/security/redact";
import { isWorkspaceScopeError } from "@/lib/agent/anthropic-workspace";
import { thinkSource, thinkingModel } from "@/lib/agent/inference";
import { isLlmMock } from "@/lib/agent/mock-model";
import { narrateRun, tradeRefusals, type NarratableStep } from "@/lib/agent/narrate";
import { getPortfolio } from "@/lib/agent/portfolio";
import { getPlatformWallet, platformUsdcBalances } from "@/lib/platform/wallets";
import { proposalExpiresAt } from "@/lib/trading/proposals";
import { MIN_PLATFORM_SOL } from "@/lib/wallets/gas";
import { getSolBalance } from "@/lib/wallets/solana-rpc";
import { payPerUseModelLabel, stopFix, stopWords } from "@/components/agents/thinking";
import type { Db } from "@/db";

// ------------------------------------------------------------------ the shape

export type AgentStatusKind =
  | "pending_proposals"
  | "run_failed"
  | "thinking_hold"
  | "no_llm_key"
  | "daily_limit"
  | "paused"
  | "low_cash"
  | "platform_gas"
  | "draft"
  | "buys_refused"
  | "quiet_window";

/**
 * `block` — the agent cannot trade until this changes.
 * `warn`  — it can, but something will bite soon.
 * `info`  — worth knowing, nothing to fix.
 */
export type AgentStatusSeverity = "block" | "warn" | "info";

export interface AgentStatusAction {
  label: string;
  /** Internal path, or an absolute URL for a provider's own console. */
  href: string;
}

export interface AgentStatusItem {
  kind: AgentStatusKind;
  severity: AgentStatusSeverity;
  /** What is true right now, in one line. Never an instruction — the action is the instruction. */
  title: string;
  /** The sentence under it: the consequence, the provider's own words, or the address. */
  detail: string;
  action?: AgentStatusAction;
  /**
   * A second way out, beside the fix. Only a pay-per-use hold has one: whatever stopped
   * the agent paying for its thinking, its owner's own key is always the other answer.
   */
  secondaryAction?: AgentStatusAction;
}

/** Past this a banner stops being read. */
const MAX_ITEMS = 4;

const SEVERITY_RANK: Record<AgentStatusSeverity, number> = { block: 0, warn: 1, info: 2 };

/** A live agent under this much cash cannot place its smallest allowed buy. */
const MIN_CLIP_USD = 1;

/** Below this the platform's Solana wallet cannot pay for a paid read. */
const MIN_PLATFORM_USDC = 0.5;

// ------------------------------------------------------------ pure formatting

/** `$2`, `$0.70`, `$1,240.50` — whole dollars stay whole, as in the proposal copy. */
function usd(amount: number): string {
  return Number.isInteger(amount)
    ? `$${amount.toLocaleString("en-US")}`
    : `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * How long until something happens, in the coarsest honest unit. Deliberately never
 * "in 0 minutes": a proposal with forty seconds on it says "under a minute", which is
 * the thing the operator needs to act on.
 */
export function humanDuration(ms: number): string {
  if (ms <= 0) return "now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return plural(minutes, "minute", "minutes");
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? plural(hours, "hour", "hours") : `${hours}h ${rest}m`;
  return plural(Math.round(hours / 24), "day", "days");
}

/**
 * The agent's age ceiling as an operator would say it: "15-minute", "6-hour", "7-day".
 * `null` when the config has no ceiling at all — there is no window to name then, and
 * inventing one would be a lie about the strategy.
 */
export function describeWindow(maxAgeHours: number | null): string | null {
  if (maxAgeHours === null || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) return null;
  if (maxAgeHours < 1) return `${Math.round(maxAgeHours * 60)}-minute`;
  if (maxAgeHours < 48) return `${Number(maxAgeHours.toFixed(1))}-hour`;
  return `${Math.round(maxAgeHours / 24)}-day`;
}

/**
 * The first sentence of a provider error or a run summary, trimmed to something a row
 * can hold. Provider errors arrive with a paragraph of billing advice behind them and
 * run summaries with three sentences; the first one carries the finding.
 */
export function firstSentence(text: string | null | undefined, maxLength = 180): string | null {
  const raw = (text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const match = raw.match(/^.*?[.!?](?=\s|$)/);
  const sentence = (match?.[0] ?? raw).trim();
  if (sentence.length <= maxLength) return sentence;
  return `${sentence.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Milliseconds until the daily buy counter rolls over — it counts fills since 00:00 UTC. */
function msUntilUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}

function sol(amount: number): string {
  return `${Number(amount.toFixed(4))} SOL`;
}

// --------------------------------------------------------- error classification

export type RunErrorKind = "anthropic_credits" | "anthropic_workspace" | "no_llm_key" | "unknown";

export interface RunErrorClass {
  kind: RunErrorKind;
  /** The diagnosis, in the operator's terms. */
  title: string;
  /** The provider's own first sentence — the evidence for the diagnosis. */
  detail: string;
}

/**
 * Pure: what a failed run's error text actually means.
 *
 * Only the three failures with a known one-click fix are named; everything else keeps
 * the provider's own first sentence and sends the operator to the run, which has the
 * transcript. Guessing at a fourth diagnosis is worse than showing the sentence: the
 * operator can read, and a confident wrong label sends them to the wrong screen.
 */
export function classifyRunError(text: string | null | undefined): RunErrorClass | null {
  // The stored error is whatever broke, in its own words; rows written before errors
  // were scrubbed on the way in can still carry the key a provider echoed.
  const raw = redactSecrets((text ?? "").trim());
  if (!raw) return null;
  const sentence = firstSentence(raw) ?? raw;

  // Anthropic's own words for an empty balance. Checked before the workspace test:
  // a topped-up organization key can hit either, and the balance is the cheaper fix.
  if (/credit balance/i.test(raw)) {
    return { kind: "anthropic_credits", title: "Anthropic credits are out", detail: sentence };
  }
  // The same predicate `run.ts` uses to decide whether to go looking for a workspace,
  // so the banner and the run loop can never disagree about what this error is.
  if (isWorkspaceScopeError(raw)) {
    return {
      kind: "anthropic_workspace",
      title: "This Anthropic key needs a workspace",
      detail: sentence,
    };
  }
  if (/no LLM API key|key attached to this agent no longer exists/i.test(raw)) {
    return { kind: "no_llm_key", title: "No LLM key on this agent", detail: sentence };
  }
  return { kind: "unknown", title: "The last run failed", detail: sentence };
}

// ------------------------------------------------------------- the derivation

export interface StatusRun {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error: string | null;
  summary: string | null;
  /** Why a pay-per-use run ended early (`agent_runs.stop_reason`). Absent or null on a key run. */
  stopReason?: string | null;
}

/** A pay-per-use agent's thinking, as the banner needs it. A key agent has none of this. */
export interface StatusThinking {
  /** The model it pays for, by its list name. */
  model: string;
  /** The owner's two limits, USD, for the sentences that quote them. */
  runCapUsd?: number;
  dayCapUsd?: number;
  /**
   * Why it is not being run (`agents.inference_hold`) and when it is looked at again.
   * Null while it runs normally. The reason is kept as stored: one this build does not
   * know still shows as a hold.
   */
  hold: { reason: string; until: Date | null } | null;
}

export interface StatusQuietRun {
  id: string;
  /**
   * `narrateRun` over the run's own steps: what it scored, paid for and decided. Never
   * the model's `summary`, which is its own words and can claim a buy the risk guard
   * refused.
   */
  digest: string | null;
  /** Trades *and* proposals this run wrote. Zero means the tick decided on nothing. */
  tradeCount: number;
  /** `place_trade` calls the risk guard or the venue turned down, by label. */
  refusals: Array<{ label: string; count: number }>;
}

export interface StatusInputs {
  now: Date;
  slug: string;
  status: "draft" | "active" | "paused" | "error";
  mode: "paper" | "live";
  hasLlmKey: boolean;
  /**
   * Set for an agent that pays for its own thinking (`config.llm.source` is `"usdc"`);
   * absent or null for a key agent, whose status is then exactly what it was.
   */
  thinking?: StatusThinking | null;
  maxDailyTrades: number;
  maxTradeUsd: number;
  /** `config.universe.maxAgeHours` — null means no ceiling. */
  maxAgeHours: number | null;
  /** Undecided proposals, expiry already resolved against the agent's TTL. */
  proposals: Array<{ expiresAt: Date }>;
  /** `null` when the book could not be read — nothing is then claimed about cash or the limit. */
  portfolio: { cashUsd: number; tradesToday: number; cashReadFailed: boolean } | null;
  /** The newest run of any status. */
  lastRun: StatusRun | null;
  /** The three newest succeeded runs, newest first. Fewer than three = no quiet verdict. */
  recentSucceeded: StatusQuietRun[];
  /** The platform's Solana wallet, when this agent trades Solana. Unread balances are `null`. */
  platformSolana: { address: string; sol: number | null; usdc: number | null } | null;
  /**
   * The viewer is in `ADMIN_EMAILS`. The platform-wallet row is Tocker's problem, not the
   * owner's, so it is shown to admins and to nobody else — however low the wallet is.
   */
  viewerIsAdmin: boolean;
}

/**
 * Pure: every blocker this agent has right now, most severe first, at most four.
 *
 * Push order inside a severity is priority order — the sort is stable — and it is
 * ordered by what has a clock on it. A proposal expires; a missing key does not.
 */
export function deriveStatus(input: StatusInputs): AgentStatusItem[] {
  const items: AgentStatusItem[] = [];
  const settings = (hash = "") => `/agents/${input.slug}/settings${hash}`;
  const push = (item: AgentStatusItem) => items.push(item);

  // ---- block: proposals waiting on a human, soonest expiry first.
  const pending = input.proposals
    .filter((p) => p.expiresAt.getTime() > input.now.getTime())
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  if (pending.length > 0) {
    const left = humanDuration(pending[0].expiresAt.getTime() - input.now.getTime());
    push({
      kind: "pending_proposals",
      severity: "block",
      title:
        pending.length === 1
          ? `Waiting on you: 1 proposal, it expires in ${left}`
          : `Waiting on you: ${pending.length} proposals, the oldest expires in ${left}`,
      detail: "This agent asks before it trades. Nothing routes until you approve or decline.",
      action: { label: "Review", href: "/notifications" },
    });
  }

  // ---- block: a pay-per-use agent that is not being run. One row says why, when Tocker
  // looks again, and the two ways out: the fix for that reason, and the owner's own key.
  const thinking = input.thinking ?? null;
  if (thinking?.hold) push(holdItem(thinking, thinking.hold, input.slug, input.now));

  // ---- block: the last run failed. A failure for want of a key is dropped when the
  // key is genuinely missing — the no-key row below says the same thing, with the fix.
  // A pay-per-use run that stopped for a named reason says so in that reason's own
  // words, and says nothing at all while the hold row above is already saying it.
  const failedRun = input.lastRun?.status === "failed" ? input.lastRun : null;
  const stopped = thinking && failedRun?.stopReason ? failedRun.stopReason : null;
  const failure = failedRun && !stopped ? classifyRunError(failedRun.error) : null;
  if (failedRun && stopped && thinking && !thinking.hold) {
    const words = stopWords(stopped, thinkingContext(thinking));
    push({
      kind: "run_failed",
      severity: "block",
      title: words.title,
      detail: words.detail,
      action: { label: "Open the run", href: `/agents/${input.slug}/runs/${failedRun.id}` },
    });
  }
  if (failure && !(failure.kind === "no_llm_key" && !input.hasLlmKey)) {
    push({
      kind: "run_failed",
      severity: "block",
      title: failure.title,
      detail: failure.detail,
      action: runErrorAction(failure.kind, input.slug, input.lastRun?.id ?? null),
    });
  }

  // ---- block: nothing to think with. Never for a pay-per-use agent: it has no key on
  // purpose, and telling its owner to attach one would be telling them it is broken.
  if (!input.hasLlmKey && !thinking) {
    push({
      kind: "no_llm_key",
      severity: "block",
      title: "No LLM key attached",
      detail: "The agent cannot think without one, so every tick fails before it starts.",
      action: { label: "Attach a key", href: settings("#brain") },
    });
  }

  // ---- block: the day's buys are spent. Buys only — an exit is never blocked by it.
  if (input.portfolio && input.maxDailyTrades > 0 && input.portfolio.tradesToday >= input.maxDailyTrades) {
    push({
      kind: "daily_limit",
      severity: "block",
      title: `Daily buy limit reached (${input.portfolio.tradesToday} of ${input.maxDailyTrades})`,
      detail: `Resets at 00:00 UTC, in ${humanDuration(msUntilUtcMidnight(input.now))}. Sells are never blocked by it.`,
      action: { label: "Raise the limit", href: settings("#risk") },
    });
  }

  // ---- warn: switched off.
  if (input.status === "paused") {
    push({
      kind: "paused",
      severity: "warn",
      title: "Paused — runs are off",
      detail: "The scheduler skips a paused agent, so nothing is discovered, scored or exited.",
      action: { label: "Resume", href: settings() },
    });
  }

  // ---- warn: a live book too thin to place its own smallest buy. Withheld when a
  // wallet read failed, because `cashUsd` is then known to be too low.
  if (input.mode === "live" && input.portfolio && !input.portfolio.cashReadFailed) {
    const clip = Math.max(input.maxTradeUsd, MIN_CLIP_USD);
    if (input.portfolio.cashUsd < clip) {
      push({
        kind: "low_cash",
        severity: "warn",
        title: `Cash ${usd(input.portfolio.cashUsd)} is under the ${usd(clip)} clip`,
        detail: "Every buy is refused for want of cash until the wallet is topped up. Exits still work.",
        action: { label: "Add funds", href: settings("#wallets") },
      });
    }
  }

  // ---- warn, admins only: the platform's own Solana wallet. It pays every Solana network
  // fee and paid read, and it refuels its SOL from its own USDC. That makes it Tocker's
  // problem and never the owner's: an owner is not shown a banner about Tocker's SOL, and
  // has nothing to do about it if they were.
  const platform = input.viewerIsAdmin ? input.platformSolana : null;
  if (platform) {
    const solLow = platform.sol !== null && platform.sol < MIN_PLATFORM_SOL;
    const usdcLow = platform.usdc !== null && platform.usdc < MIN_PLATFORM_USDC;
    if (solLow || usdcLow) {
      const holds = [
        platform.sol === null ? null : sol(platform.sol),
        platform.usdc === null ? null : `${usd(platform.usdc)} USDC`,
      ].filter((part): part is string => part !== null);
      push({
        kind: "platform_gas",
        severity: "warn",
        title: "Tocker's Solana fee wallet is running low",
        detail: `Admin only — owners never see this. It pays every Solana network fee and paid read, and holds ${holds.join(" and ")} at ${platform.address}.`,
        action: { label: "Platform wallets", href: "/settings/admin#platform" },
      });
    }
  }

  // ---- info: never started.
  if (input.status === "draft") {
    push({
      kind: "draft",
      severity: "info",
      title: "Still a draft — it has never been scheduled",
      detail: "Activate it and it starts ticking on its cadence.",
      action: { label: "Activate", href: settings() },
    });
  }

  // ---- three ticks in a row with nothing to show. Either it tried to buy and was
  // refused — a setting is in its way, and that is a warning with the fix — or nothing
  // cleared the bar, which is not a fault: a narrow age window on a slow hour
  // legitimately returns nothing, and the operator should be told that rather than left
  // wondering whether the agent is broken.
  const quiet = input.recentSucceeded.slice(0, 3);
  if (quiet.length === 3 && quiet.every((run) => run.tradeCount === 0)) {
    const refused = topRefusal(quiet);
    if (refused) {
      const copy = REFUSAL_COPY[refused.label];
      const orders = plural(refused.total, "order was", "orders were");
      push({
        kind: "buys_refused",
        severity: "warn",
        title: "Its buys were refused",
        detail: `${copy?.detail ?? `${capitalize(refused.label)}.`} ${orders} turned down in the last three ticks.`,
        action:
          copy?.hash !== undefined
            ? { label: "Settings", href: settings(copy.hash) }
            : { label: "Open the run", href: `/agents/${input.slug}/runs/${refused.runId}` },
      });
    } else {
      const window = describeWindow(input.maxAgeHours);
      push({
        kind: "quiet_window",
        severity: "info",
        title: window
          ? `No launch passed the ${window} window in the last three ticks`
          : "Nothing cleared the bar in the last three ticks",
        detail: firstSentence(quiet[0].digest) ?? "The agent finished each tick without proposing anything.",
        action: { label: "Open the run", href: `/agents/${input.slug}/runs/${quiet[0].id}` },
      });
    }
  }

  return items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).slice(0, MAX_ITEMS);
}

/** What the sentences about a stop may quote: the owner's own limits and the model's name. */
function thinkingContext(thinking: StatusThinking): { runCapUsd?: number; dayCapUsd?: number; model?: string } {
  return {
    ...(thinking.runCapUsd === undefined ? {} : { runCapUsd: thinking.runCapUsd }),
    ...(thinking.dayCapUsd === undefined ? {} : { dayCapUsd: thinking.dayCapUsd }),
    ...(thinking.model ? { model: thinking.model } : {}),
  };
}

/**
 * The reasons an owner can clear themselves, right now. For these the row adds that a
 * run started by hand checks again at once; for the rest (a day limit that only midnight
 * resets, a pause that is Tocker's) pressing Run now would only be told the same thing.
 */
const FIXABLE_NOW: ReadonlySet<string> = new Set([
  "needs_funds",
  "agent_day_cap",
  "no_wallet",
  "no_policy",
  "wallet_limit_low",
  "model_unavailable",
]);

/** The scheduler's hold check runs with the cron, every five minutes. */
const HOLD_CHECK_EVERY = "five minutes";

/**
 * Pure: the row for a pay-per-use agent that is on hold.
 *
 * The title and the first sentence are `describeInferenceStop`'s, the same words the
 * notification and the run row use. What this adds is the clock (when the agent is
 * looked at again) and the two actions.
 */
export function holdItem(
  thinking: StatusThinking,
  hold: NonNullable<StatusThinking["hold"]>,
  slug: string,
  now: Date,
): AgentStatusItem {
  const words = stopWords(hold.reason, thinkingContext(thinking));
  const settings = (hash: string) => `/agents/${slug}/settings${hash}`;
  const fix = words.reason ? stopFix(words.reason) : { label: "Open settings", hash: "#thinking" };

  const wait = hold.until ? hold.until.getTime() - now.getTime() : 0;
  const again =
    wait > 0
      ? `Tocker checks again in ${humanDuration(wait)}.`
      : `Tocker checks again on its next pass, within ${HOLD_CHECK_EVERY}.`;
  const byHand = words.reason && FIXABLE_NOW.has(words.reason) ? " Once it is fixed, Run now starts it straight away." : "";

  return {
    kind: "thinking_hold",
    severity: "block",
    title: words.title,
    detail: `${words.detail} ${again}${byHand}`,
    action: { label: fix.label, href: "hash" in fix ? settings(fix.hash) : fix.path },
    secondaryAction: { label: "Use my own key", href: settings("#brain") },
  };
}

/**
 * What each refusal label means to an owner, and the Settings section that changes it.
 * No `hash` means no setting fixes it (a bad quote, a provider outage): the run is the
 * better place to send them.
 */
const REFUSAL_COPY: Record<string, { detail: string; hash?: string }> = {
  "chain not enabled": { detail: "The token's chain is not enabled for this agent.", hash: "#universe" },
  "trade size cap": { detail: "Each order was over its per-trade cap.", hash: "#risk" },
  "position concentration": { detail: "Each order would have put too much of the book in one token.", hash: "#risk" },
  "not enough cash": { detail: "There was not enough cash to cover the order.", hash: "#wallets" },
  "daily buy limit": { detail: "The day's buys were already spent.", hash: "#risk" },
  "hard gates": { detail: "The token failed a hard gate.", hash: "#universe" },
  "below the score floor": { detail: "The token scored under this agent's floor.", hash: "#universe" },
  "avoid verdict": { detail: "The token's verdict was avoid.", hash: "#universe" },
  blocklist: { detail: "The token is on this agent's blocklist.", hash: "#universe" },
  "unscored token": { detail: "It tried to buy a token it had not scored first." },
  "bad quote": { detail: "The venue's quote was unusable." },
  "scoring outage": { detail: "Every data provider failed while it was scoring." },
};

/**
 * Refusals that are the approval flow working, or a sell with nothing to sell: none of
 * them is a buy being stopped by a setting.
 */
const NOT_A_BLOCKED_BUY = new Set(["already proposed", "tick proposal limit", "nothing to sell"]);

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The most frequent blocked-buy label across these runs, with the newest run that hit it. */
function topRefusal(runs: readonly StatusQuietRun[]): { label: string; total: number; runId: string } | null {
  const totals = new Map<string, { total: number; runId: string }>();
  for (const run of runs) {
    for (const { label, count } of run.refusals) {
      if (NOT_A_BLOCKED_BUY.has(label)) continue;
      const held = totals.get(label);
      if (held) held.total += count;
      else totals.set(label, { total: count, runId: run.id });
    }
  }
  let best: { label: string; total: number; runId: string } | null = null;
  for (const [label, entry] of totals) {
    if (!best || entry.total > best.total) best = { label, ...entry };
  }
  return best;
}

/** Where a failed run sends the operator: the provider's billing, the key, or the run. */
function runErrorAction(kind: RunErrorKind, slug: string, runId: string | null): AgentStatusAction | undefined {
  switch (kind) {
    case "anthropic_credits":
      return { label: "Top up Anthropic", href: "https://platform.claude.com/settings/billing" };
    case "anthropic_workspace":
      return { label: "Fix the key", href: `/agents/${slug}/settings#brain` };
    case "no_llm_key":
      return { label: "Attach a key", href: `/agents/${slug}/settings#brain` };
    case "unknown":
      return runId ? { label: "Open the run", href: `/agents/${slug}/runs/${runId}` } : undefined;
  }
}

// ----------------------------------------------------------------- the reads

/** Every read here is optional: a failure drops one line, never the banner or the page. */
async function guard<T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (err) {
    console.warn(`[agent-status] ${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}

/**
 * Undecided proposals with their expiry resolved.
 *
 * Deliberately does not sweep: this is a banner, and a read that writes is a read that
 * cannot be run twice on one page. Already-expired rows are dropped in
 * {@link deriveStatus}, and `listProposals` — rendered directly below — does the sweep.
 */
async function readProposals(db: Db, agentId: string, config: AgentConfig): Promise<Array<{ expiresAt: Date }>> {
  const rows = await db
    .select({ proposedAt: trades.proposedAt, createdAt: trades.createdAt })
    .from(trades)
    .where(and(eq(trades.agentId, agentId), eq(trades.status, "proposed")));
  return rows.map((row) => ({ expiresAt: proposalExpiresAt(row.proposedAt ?? row.createdAt, config) }));
}

/**
 * The newest run, and the three newest succeeded ones with how much each did.
 *
 * One window of recent runs answers both questions; the trade counts are only fetched
 * when there are three succeeded runs to judge, which is the only case the quiet rule
 * fires in. A succeeded run that wrote no `trades` row proposed nothing and traded
 * nothing — that is the definition of a quiet tick.
 */
async function readRuns(db: Db, agentId: string): Promise<{ last: StatusRun | null; quiet: StatusQuietRun[] }> {
  const recent = await db
    .select({
      id: agentRuns.id,
      status: agentRuns.status,
      error: agentRuns.error,
      summary: agentRuns.summary,
      stopReason: agentRuns.stopReason,
    })
    .from(agentRuns)
    .where(eq(agentRuns.agentId, agentId))
    .orderBy(desc(agentRuns.createdAt))
    .limit(12);

  const last = recent[0] ?? null;
  const succeeded = recent.filter((run) => run.status === "succeeded").slice(0, 3);
  if (succeeded.length < 3) {
    return {
      last,
      quiet: succeeded.map((run) => ({ id: run.id, digest: null, tradeCount: 0, refusals: [] })),
    };
  }

  const ids = succeeded.map((run) => run.id);
  const [rows, stepRows] = await Promise.all([
    db.select({ runId: trades.runId }).from(trades).where(inArray(trades.runId, ids)),
    // The steps, not the summary: the summary is the model's account of the tick, and
    // a model can write "bought a $50 starter position" after the risk guard said no.
    db
      .select({
        runId: agentRunSteps.runId,
        kind: agentRunSteps.kind,
        toolName: agentRunSteps.toolName,
        payload: agentRunSteps.payload,
      })
      .from(agentRunSteps)
      .where(inArray(agentRunSteps.runId, ids))
      .orderBy(asc(agentRunSteps.seq)),
  ]);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.runId) counts.set(row.runId, (counts.get(row.runId) ?? 0) + 1);
  }
  const stepsByRun = new Map<string, NarratableStep[]>();
  for (const row of stepRows) {
    const list = stepsByRun.get(row.runId) ?? [];
    list.push({ kind: row.kind, toolName: row.toolName, payload: row.payload });
    stepsByRun.set(row.runId, list);
  }
  return {
    last,
    quiet: succeeded.map((run) => {
      const steps = stepsByRun.get(run.id) ?? [];
      return {
        id: run.id,
        digest: steps.length > 0 ? narrateRun(steps) : null,
        tradeCount: counts.get(run.id) ?? 0,
        refusals: tradeRefusals(steps),
      };
    }),
  };
}

/**
 * The platform's Solana balances, cached for a minute.
 *
 * This number is the same for every agent page in the process and it moves in lamports,
 * so a fresh RPC round trip per page load buys nothing. `platformUsdcBalances` already
 * caches on the same TTL for exactly this reason.
 */
const SOL_CACHE_TTL_MS = 60_000;
let solCache: { at: number; address: string; sol: number | null } | null = null;

export function resetAgentStatusCache(): void {
  solCache = null;
}

async function readPlatformSol(address: string, now: number): Promise<number | null> {
  if (solCache && solCache.address === address && now - solCache.at < SOL_CACHE_TTL_MS) return solCache.sol;
  const sol = await guard("platform SOL balance", () => getSolBalance(address), null);
  solCache = { at: now, address, sol };
  return sol;
}

/** Only for an agent that trades Solana: the chain this wallet pays gas and 402s on. */
async function readPlatformSolana(
  config: AgentConfig,
  now: number,
): Promise<StatusInputs["platformSolana"]> {
  if (!config.chains.includes("solana")) return null;
  const wallet = await getPlatformWallet("solana");
  if (!wallet) return null;
  const [solBalance, usdcBalance] = await Promise.all([
    readPlatformSol(wallet.address, now),
    guard("platform USDC balances", async () => (await platformUsdcBalances(now)).get("solana") ?? null, null),
  ]);
  return { address: wallet.address, sol: solBalance, usdc: usdcBalance };
}

/** Is this viewer in `ADMIN_EMAILS`? The same matcher `/settings/admin` is gated on. */
async function viewerIsAdminUser(db: Db, viewerId: string): Promise<boolean> {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, viewerId)).limit(1);
  const { isAdminEmail } = await import("@/lib/admin");
  return isAdminEmail(row?.email);
}

/**
 * Everything the owner of this agent is waiting on. `[]` for anybody else, and `[]`
 * when there is nothing to say.
 */
export async function getAgentStatus(agentId: string, viewerId?: string | null): Promise<AgentStatusItem[]> {
  if (!viewerId) return [];
  try {
    const db = await getDb();
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    // THE GATE. A blocker names the agent's own thresholds, which are strategy.
    if (!agent || agent.ownerId !== viewerId) return [];

    const now = new Date();
    const config = agent.config;

    // The platform wallet is read only for an admin: nobody else is shown it, so nobody
    // else should pay for the round trip either.
    const viewerIsAdmin = await guard("viewer admin", () => viewerIsAdminUser(db, viewerId), false);

    const [proposals, portfolio, runs, platformSolana] = await Promise.all([
      guard("proposals", () => readProposals(db, agent.id, config), []),
      guard("portfolio", () => getPortfolio(agent.id), null),
      guard("runs", () => readRuns(db, agent.id), { last: null, quiet: [] }),
      viewerIsAdmin
        ? guard("platform solana wallet", () => readPlatformSolana(config, now.getTime()), null)
        : Promise.resolve(null),
    ]);

    // The mode is the config's own word (`thinkSource`), never a guess from a missing key.
    const payPerUse = thinkSource(config) === "usdc";

    return deriveStatus({
      now,
      slug: agent.slug,
      status: agent.status,
      mode: agent.mode,
      // Mock mode runs without a key, so the banner must not say one is missing.
      hasLlmKey: agent.llmKeyId !== null || isLlmMock(),
      thinking: payPerUse
        ? {
            model: payPerUseModelLabel(thinkingModel(config)),
            runCapUsd: config.llm.usdc?.maxUsdPerRun,
            dayCapUsd: config.llm.usdc?.maxUsdPerDay,
            hold: agent.inferenceHold ? { reason: agent.inferenceHold, until: agent.inferenceHoldUntil } : null,
          }
        : null,
      maxDailyTrades: config.risk.maxDailyTrades,
      maxTradeUsd: config.risk.maxTradeUsd,
      maxAgeHours: config.universe.maxAgeHours,
      proposals,
      portfolio: portfolio
        ? {
            cashUsd: portfolio.cashUsd,
            tradesToday: portfolio.tradesToday,
            cashReadFailed: portfolio.cashReadFailed,
          }
        : null,
      lastRun: runs.last,
      recentSucceeded: runs.quiet,
      platformSolana,
      viewerIsAdmin,
    });
  } catch (err) {
    // The banner is an aid, never the page. A database that cannot answer at all must
    // not take the record down with it.
    console.warn(`[agent-status] ${agentId}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
