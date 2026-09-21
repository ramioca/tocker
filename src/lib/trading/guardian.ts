/**
 * The guardian — the half of the agent that never sleeps.
 *
 * An LLM tick happens every 15 minutes at best, and only decides what it decides. The
 * guardian runs the deterministic exit rules (`./exits.ts`) on a schedule the model does
 * not control: once before every tick, so the model sees the book *after* exits, and
 * every five minutes in between via `/api/cron/marks`. A stop loss is now a rule, not a
 * suggestion.
 *
 * What one pass does:
 *   1. load the agent, its config and its book (`getPortfolio` → fresh marks);
 *   2. ratchet `positions.peakPriceUsd` up to the new marks (`updatePeaks`);
 *   3. rescore held tokens **only** when a rule needs it (`exitScoreBelow` /
 *      `exitOnLiquidityDropPct`) — free providers only, never `deep`, never x402. A
 *      guardian pass must cost nothing, because it runs twelve times an hour;
 *   4. `evaluateExits`;
 *   5. execute each exit through the normal executor, recorded exactly like a
 *      `place_trade` sell: a `trades` row (`origin: "guardian"`, `exitReason`,
 *      `rationale`, `scoreSnapshot`), a `trade_receipts` row (quoted vs filled, venue,
 *      fees, explorer link), `applyFill`, a `posts` row, a notification to the owner
 *      (kind `exit`, with the receipt line on it) and to followers (kind `trade`);
 *   6. snapshot equity, so the curve is real between runs instead of a step function.
 *
 * Safety properties, all deliberate:
 *  - **Never throws.** Anything unexpected comes back as `error` on the result. A cron
 *    route must not 500 because one agent's provider blinked.
 *  - **One bad position cannot stop the others.** Every exit is executed and recorded
 *    independently; a failure becomes a `failed` trade row with the error on it.
 *  - **Never sells more than is held.** The position row is re-read immediately before
 *    each sell and the notional clamped to it, and a second guardian pass that lands
 *    within a minute of a filled exit on the same token stands down.
 *  - **Entry rules never block an exit.** `riskGuard` is still called, but only its
 *    sell-side checks can fire (position exists, priceable, not oversold) — see the
 *    header of `./risk.ts`.
 *  - **Live agents with placeholder wallets are skipped, loudly, not crashed.**
 *  - **Money owed is collected last.** On every non-tick pass, *after* the exits, the
 *    agent's accrued platform fees are swept in batches (`platform/settlement.ts`).
 *    It cannot throw and it cannot delay an exit; a failure retries in five minutes.
 */
import { nanoid } from "nanoid";
import { and, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { agentRuns, agents, equitySnapshots, follows, getDb, notifications, positions as positionsTable, posts, tokens as tokensTable, trades } from "@/db";
import type { AgentConfig } from "@/db/schema";
import { parseAgentConfig } from "@/lib/agent/config";
import { getAgentWallets, getPortfolio, snapshotEquity, toRiskPortfolio, type Portfolio } from "@/lib/agent/portfolio";
import { toNumeric } from "@/lib/money";
import { chargePlatformFee } from "@/lib/platform/fees";
import { settlePlatformFees, type SettlementResult } from "@/lib/platform/settlement";
import { getTokenScore, toTradeScore } from "@/lib/tokens";
import { hasDigest, sendDailyDigest, utcDay } from "@/lib/notifications";
import type { Chain, ExitReason, TokenScore } from "@/server/types";
import { getExecutor, LiveWalletError, type ExecutorAgent, type TradeRequest } from "./executor";
import {
  describeExits,
  evaluateExits,
  hasAnyExitRule,
  needsRescore,
  toExitRules,
  type ExitDecision,
  type ExitPosition, priceText } from "./exits";
import { applyFill, heldAmountToken, updatePeaks } from "./positions";
import { buildReceipt, receiptSummary, saveReceipt } from "./receipt";
import { riskGuard, type OrderIntent } from "./risk";
import { executeTrade } from "./settle";
import { ensureQuoteToken } from "./tokens";

export type GuardianTrigger = "tick" | "marks" | "manual";

export interface RunGuardianInput {
  agentId: string;
  trigger: GuardianTrigger;
  /** Set when the guardian runs inside a run, so its trades join that transcript. */
  runId?: string | null;
  /** Injectable clock; the exit rules take it as an input. */
  now?: Date;
  /**
   * Write an `equity_snapshots` row at the end. Defaults to true for `marks` and
   * `manual`; false for `tick`, because `run.ts` snapshots at the end of the run.
   */
  snapshot?: boolean;
}

export interface GuardianExitRecord {
  tokenId: string;
  chain: Chain;
  symbol: string;
  reason: ExitReason;
  rationale: string;
  amountUsd: number;
  amountToken: number;
  priceUsd: number | null;
  tradeId: string | null;
  status: "filled" | "failed" | "rejected";
  error: string | null;
}

export interface GuardianSkip {
  tokenId: string;
  symbol: string;
  reason: string;
}

export interface GuardianResult {
  agentId: string;
  trigger: GuardianTrigger;
  /** False when the pass stopped before evaluating anything (no agent, no wallets, …). */
  ran: boolean;
  /** Human-readable note about the pass; always set when `ran` is false. */
  note: string | null;
  /** Open positions considered. */
  positions: number;
  /** Held tokens rescored this pass (0 unless a collapse rule is armed). */
  rescored: number;
  exits: GuardianExitRecord[];
  /** Positions an exit was wanted for but could not be taken. */
  skipped: GuardianSkip[];
  equityUsd: number | null;
  /**
   * What the platform-fee sweep did this pass, or null when it was not reached (a
   * `tick` pass never sweeps — the run owns that time). Always after the exits.
   */
  settlement: SettlementResult | null;
  error: string | null;
}

function emptyResult(input: RunGuardianInput, note: string | null): GuardianResult {
  return {
    agentId: input.agentId,
    trigger: input.trigger,
    ran: false,
    note,
    positions: 0,
    rescored: 0,
    exits: [],
    skipped: [],
    equityUsd: null,
    settlement: null,
    error: null,
  };
}

/** The owner-facing notification title for each rule. */
const EXIT_TITLES: Record<ExitReason, string> = {
  stop_loss: "Stop loss hit",
  take_profit: "Take profit hit",
  trailing_stop: "Trailing stop hit",
  max_hold: "Max hold reached",
  score_collapse: "Score collapsed",
  liquidity_collapse: "Liquidity collapsed",
};

/** One-line summary for the run transcript and the tick prompt. */
export function describeGuardian(result: GuardianResult): string {
  if (!result.ran) return result.note ?? "Guardian did not run.";
  const head = describeExits(
    result.exits
      .filter((e) => e.status === "filled")
      .map((e) => ({
        tokenId: e.tokenId,
        chain: e.chain,
        address: "",
        symbol: e.symbol,
        reason: e.reason,
        priority: 0,
        amountUsd: e.amountUsd,
        amountToken: e.amountToken,
        markPriceUsd: e.priceUsd ?? 0,
        unrealizedPnlPct: null,
        rationale: e.rationale,
      })),
  );
  const tail = [
    result.exits.some((e) => e.status !== "filled")
      ? `${result.exits.filter((e) => e.status !== "filled").length} exit(s) could not be executed`
      : null,
    result.skipped.length > 0 ? `${result.skipped.length} position(s) skipped` : null,
  ].filter((s): s is string => s !== null);
  return tail.length === 0 ? head : `${head} (${tail.join("; ")})`;
}

function log(agentId: string, message: string): void {
  console.warn(`[guardian] ${agentId}: ${message}`);
}

async function notify(
  rows: Array<{ userId: string; kind: string; title: string; body: string; href: string }>,
): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  await db.insert(notifications).values(rows.map((r) => ({ id: nanoid(), ...r })));
}

async function followerIds(agentId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(and(eq(follows.targetType, "agent"), eq(follows.targetId, agentId)));
  return rows.map((r) => r.followerId);
}

/**
 * How close together two guardian attempts on the same token may land. Short on purpose:
 * a stop loss that backs off exponentially is worse than one that is noisy, so this only
 * has to stop the tick pass and the marks pass from double-firing in the same breath —
 * the real cadence is the five-minute marks loop, which is unaffected.
 */
const EXIT_ATTEMPT_WINDOW_MS = 60_000;

/** At most one `exit_failed` push per token per hour, however often the exit retries. */
const EXIT_FAILED_NOTIFY_MS = 60 * 60_000;

/**
 * How long one failing exit counts as the same episode. Inside it, the retries update a
 * single `trades` row instead of inserting a new one every five minutes — which is 288
 * rows a day per stuck token, enough to bury the real trade history.
 */
const EXIT_EPISODE_MS = 24 * 60 * 60_000;

/**
 * True when a guardian sell for this token was *attempted* in the last minute — filled
 * or failed. Failures count (W7 H10): before this, a token the venue kept refusing was
 * re-attempted by every overlapping pass, each one writing its own row.
 */
async function attemptedRecently(agentId: string, tokenId: string, now: Date): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .select({ id: trades.id })
    .from(trades)
    .where(
      and(
        eq(trades.agentId, agentId),
        eq(trades.tokenId, tokenId),
        eq(trades.side, "sell"),
        eq(trades.origin, "guardian"),
        inArray(trades.status, ["filled", "failed", "submitted"]),
        gte(trades.createdAt, new Date(now.getTime() - EXIT_ATTEMPT_WINDOW_MS)),
      ),
    )
    .orderBy(desc(trades.createdAt))
    .limit(1);
  return rows.length > 0;
}

/**
 * The `trades` row this exit episode is already using, if there is one.
 *
 * A stop loss that cannot fill retries twelve times an hour. Each retry used to be a new
 * `failed` row, so one stuck token produced 288 rows a day and the owner's trade history
 * became unreadable. Instead the episode keeps one row and rewrites it — the timeline
 * shows "this exit has been failing since 09:14", which is the true and useful statement.
 *
 * A fill on the same token ends the episode: after it, the next failure starts fresh.
 */
const FAILING_SINCE = " — this exit has been failing since ";

/**
 * When this episode's first attempt was, from the row's own error text.
 *
 * The row's `createdAt` is bumped on every retry — it is what `attemptedRecently` reads
 * to stop the back-to-back marks and tick passes from both firing — so the origin has to
 * survive somewhere else. It survives in the sentence the operator reads.
 */
function episodeStart(error: string | null, fallback: Date): Date {
  const at = error?.split(FAILING_SINCE)[1];
  const parsed = at === undefined ? NaN : Date.parse(at);
  return Number.isNaN(parsed) ? fallback : new Date(parsed);
}

async function reusableExitRow(
  agentId: string,
  tokenId: string,
  now: Date,
): Promise<{ id: string; createdAt: Date; error: string | null } | null> {
  const db = await getDb();
  const [candidate] = await db
    .select({ id: trades.id, createdAt: trades.createdAt, error: trades.error })
    .from(trades)
    .where(
      and(
        eq(trades.agentId, agentId),
        eq(trades.tokenId, tokenId),
        eq(trades.side, "sell"),
        eq(trades.origin, "guardian"),
        eq(trades.status, "failed"),
        gte(trades.createdAt, new Date(now.getTime() - EXIT_EPISODE_MS)),
      ),
    )
    .orderBy(desc(trades.createdAt))
    .limit(1);
  if (!candidate) return null;

  const [filledSince] = await db
    .select({ id: trades.id })
    .from(trades)
    .where(
      and(
        eq(trades.agentId, agentId),
        eq(trades.tokenId, tokenId),
        eq(trades.status, "filled"),
        gte(trades.createdAt, candidate.createdAt),
      ),
    )
    .limit(1);
  return filledSince ? null : candidate;
}

/**
 * One `exit_failed` notification per token per hour.
 *
 * An exit that cannot fill is the single most important thing an operator can be told,
 * and it was told to nobody: the failure went to `console.warn` and a `failed` trade row.
 * It is also the thing most likely to repeat every five minutes until it is fixed, so the
 * hourly ceiling is what keeps it from becoming the notification people mute.
 */
async function notifyExitFailed(ctx: ExitContext, decision: ExitDecision, message: string): Promise<void> {
  try {
    const db = await getDb();
    const href = `/agents/${ctx.agent.slug}?exit=${encodeURIComponent(decision.tokenId)}`;
    const [recent] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.agent.ownerId),
          eq(notifications.kind, "exit_failed"),
          eq(notifications.href, href),
          gte(notifications.createdAt, new Date(ctx.now.getTime() - EXIT_FAILED_NOTIFY_MS)),
        ),
      )
      .limit(1);
    if (recent) return;

    await notify([
      {
        userId: ctx.agent.ownerId,
        kind: "exit_failed",
        title: `${ctx.agent.name} could not sell ${decision.symbol}`,
        body: `${EXIT_TITLES[decision.reason]} fired but the order did not go through: ${message.slice(0, 400)}`,
        href,
      },
    ]);
  } catch (err) {
    // A warning that cannot be delivered must not also cost the next retry.
    log(ctx.agent.id, `exit_failed notification failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

interface AgentRecord {
  id: string;
  ownerId: string;
  slug: string;
  name: string;
  mode: "paper" | "live";
  config: AgentConfig;
}

interface ExitContext {
  agent: AgentRecord;
  executorAgent: ExecutorAgent;
  portfolio: Portfolio;
  runId: string | null;
  now: Date;
  followers: string[];
  /** Fresh scores by tokenId, when this pass rescored. */
  scores: Map<string, TokenScore>;
  decimals: Map<string, number>;
}


/**
 * Yesterday's digest, sent at most once per agent per day.
 *
 * The guardian is the right place for this and the cron route is not: the guardian
 * already runs every five minutes for every agent with a book, it already knows the
 * agent's equity, and `/api/cron/marks` belongs to another workstream. The first pass
 * after midnight UTC sends the previous day; `sendDailyDigest` dedupes on the day, so
 * the other 287 passes do nothing.
 *
 * Never throws — a digest is a courtesy, and losing one must not cost an exit.
 */
async function maybeSendDigest(agent: AgentRecord, now: Date): Promise<void> {
  try {
    const day = utcDay(new Date(now.getTime() - 86_400_000));
    // 287 of the day's 288 passes stop here; only the first after midnight goes on.
    if (await hasDigest(agent.ownerId, agent.slug, day)) return;
    const from = new Date(`${day}T00:00:00.000Z`);
    const to = new Date(from.getTime() + 86_400_000);
    const db = await getDb();

    const [opening] = await db
      .select({ equityUsd: equitySnapshots.equityUsd })
      .from(equitySnapshots)
      .where(and(eq(equitySnapshots.agentId, agent.id), lte(equitySnapshots.at, from)))
      .orderBy(desc(equitySnapshots.at))
      .limit(1);
    const [closing] = await db
      .select({ equityUsd: equitySnapshots.equityUsd })
      .from(equitySnapshots)
      .where(and(eq(equitySnapshots.agentId, agent.id), lt(equitySnapshots.at, to)))
      .orderBy(desc(equitySnapshots.at))
      .limit(1);
    const failedRuns = await db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.agentId, agent.id),
          eq(agentRuns.status, "failed"),
          gte(agentRuns.createdAt, from),
          lt(agentRuns.createdAt, to),
        ),
      );

    await sendDailyDigest({
      agentId: agent.id,
      ownerId: agent.ownerId,
      agentName: agent.name,
      agentSlug: agent.slug,
      day,
      equityUsd: closing ? Number(closing.equityUsd) : null,
      openingEquityUsd: opening ? Number(opening.equityUsd) : null,
      failedRuns: failedRuns.length,
    });
  } catch (err) {
    log(agent.id, `digest failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Executes one exit end to end. Returns a record either way — a throw here would take
 * the rest of the book down with it.
 */
/** Exits whose trigger is the mark itself, so a bad mark means a bad trigger. */
const PRICE_DRIVEN_EXITS: ReadonlySet<string> = new Set(["stop_loss", "take_profit", "trailing_stop"]);

async function executeExit(ctx: ExitContext, decision: ExitDecision): Promise<GuardianExitRecord | GuardianSkip> {
  const db = await getDb();
  const { agent } = ctx;
  const base = {
    tokenId: decision.tokenId,
    chain: decision.chain,
    symbol: decision.symbol,
    reason: decision.reason,
    rationale: decision.rationale,
    amountToken: decision.amountToken,
    priceUsd: decision.markPriceUsd,
  };

  // Re-read the row: another pass, or the model itself, may have sold it already.
  const held = await db
    .select()
    .from(positionsTable)
    .where(and(eq(positionsTable.agentId, agent.id), eq(positionsTable.tokenId, decision.tokenId)))
    .limit(1);
  const amountToken = held[0] ? Number(held[0].amountToken) : 0;
  if (!(amountToken > 0)) {
    return { tokenId: decision.tokenId, symbol: decision.symbol, reason: "position already closed" };
  }
  if (await attemptedRecently(agent.id, decision.tokenId, ctx.now)) {
    return {
      tokenId: decision.tokenId,
      symbol: decision.symbol,
      reason: "a guardian exit for this token was attempted moments ago",
    };
  }

  // Clamp to what is actually held at the mark we decided on.
  const amountUsd = Math.min(decision.amountUsd, amountToken * decision.markPriceUsd);
  if (!(amountUsd > 0)) {
    return { tokenId: decision.tokenId, symbol: decision.symbol, reason: "position is worth nothing at the mark" };
  }

  const order: OrderIntent = {
    chain: decision.chain,
    side: "sell",
    tokenId: decision.tokenId,
    tokenAddress: decision.address,
    symbol: decision.symbol,
    amountUsd,
  };
  // Sells only ever hit the sell-side checks (exists, priceable, not oversold): the
  // entry gates in `risk.ts` deliberately do not apply to exits.
  const verdict = riskGuard(
    { id: agent.id, mode: agent.mode, config: agent.config },
    toRiskPortfolio(ctx.portfolio),
    order,
    null,
  );
  if (!verdict.ok) {
    log(agent.id, `${decision.symbol} ${decision.reason} not taken: ${verdict.reason}`);
    return { tokenId: decision.tokenId, symbol: decision.symbol, reason: verdict.reason };
  }

  let executor;
  try {
    executor = await getExecutor(ctx.executorAgent, decision.chain);
  } catch (err) {
    const reason = err instanceof LiveWalletError ? err.message : err instanceof Error ? err.message : String(err);
    log(agent.id, `no executor for ${decision.chain}: ${reason}`);
    return { tokenId: decision.tokenId, symbol: decision.symbol, reason };
  }

  const score = ctx.scores.get(decision.tokenId) ?? null;
  const quoteTokenId = await ensureQuoteToken(decision.chain);

  // W7 H10: reuse this episode's row rather than minting a new one every five minutes.
  const episode = await reusableExitRow(agent.id, decision.tokenId, ctx.now);
  const tradeId = episode?.id ?? nanoid();
  const failingSince = episode === null ? null : episodeStart(episode.error, episode.createdAt);
  const rowValues = {
    // Bumped on every attempt so `attemptedRecently` can still see that this token was
    // tried moments ago — the marks cron and the tick cron fire back to back, and
    // without this both of them would re-attempt the same refused exit. The episode's
    // true start is carried in the error text instead (see `episodeStart`).
    createdAt: ctx.now,
    runId: ctx.runId,
    chain: decision.chain,
    side: "sell" as const,
    tokenId: decision.tokenId,
    quoteTokenId,
    amountToken: "0",
    amountUsd: toNumeric(amountUsd, 6),
    priceUsd: "0",
    feeUsd: "0",
    status: "pending" as const,
    isPaper: executor.isPaper,
    rationale: decision.rationale,
    scoreSnapshot: score === null ? null : toTradeScore(score),
    origin: "guardian" as const,
    exitReason: decision.reason,
    error: null,
    // `requestedUsd`/`proposedAt` stay null on purpose: those belong to approval mode, and
    // an exit is never proposed. A stop loss that waits for a human is not a stop loss.
  };
  if (episode) {
    await db.update(trades).set(rowValues).where(eq(trades.id, tradeId));
  } else {
    await db.insert(trades).values({ id: tradeId, agentId: agent.id, ownerId: agent.ownerId, ...rowValues });
  }

  /**
   * The failure text, carrying how long this exit has been stuck when it has. It is also
   * where the episode's start time lives between attempts — `episodeStart` reads it back.
   */
  const withHistory = (message: string): string =>
    failingSince === null ? message : `${message}${FAILING_SINCE}${failingSince.toISOString()}`;

  const decimals = ctx.decimals.get(decision.tokenId) ?? 9;
  const request: TradeRequest = {
    chain: decision.chain,
    side: "sell",
    tokenId: decision.tokenId,
    tokenAddress: decision.address,
    symbol: decision.symbol,
    decimals,
    amountUsd,
    // W7 H1. The exact balance, from the row we just re-read — not `amountUsd ÷ a
    // fresh buy-side quote`. A stop loss fires precisely when the mark and the route
    // price disagree, and that is the conversion that then asks for tokens the wallet
    // does not have. `decision.amountToken` is a full exit; the clamp handles a pass
    // that raced a manual sell.
    amountToken: Math.min(decision.amountToken, amountToken),
    slippageBps: agent.config.risk.slippageBps,
  };

  const failed = async (raw: string): Promise<GuardianExitRecord> => {
    const message = withHistory(raw);
    await db.update(trades).set({ status: "failed", error: message }).where(eq(trades.id, tradeId));
    log(agent.id, `${decision.symbol} ${decision.reason} failed: ${message}`);
    await notifyExitFailed(ctx, decision, raw);
    return { ...base, amountUsd, tradeId, status: "failed", error: message };
  };

  const quotedAt = new Date();
  let quote;
  try {
    quote = await executor.quote(request);
  } catch (err) {
    return failed(err instanceof Error ? err.message : "quote failed");
  }

  // The mark that fired a price rule was a feed read; the venue's quote is the price the
  // sale would actually clear at. When the two disagree by more than 2× the mark was
  // wrong, not the position — CLIP's dead pump.fun curve marked a live position at −89%
  // while Jupiter had it 25× higher (2026-09-21) — and selling would dump a healthy
  // token at the real price on the strength of a bad number. Correct the mark instead
  // and let the rule re-check against it on the next pass.
  if (PRICE_DRIVEN_EXITS.has(decision.reason) && quote.priceUsd > 0 && decision.markPriceUsd > 0) {
    const ratio = quote.priceUsd / decision.markPriceUsd;
    if (ratio > 2 || ratio < 0.5) {
      const reason = `${decision.symbol} ${decision.reason} not taken: the mark said ${priceText(decision.markPriceUsd)} but Jupiter would fill at ${priceText(quote.priceUsd)} — a ${ratio.toFixed(1)}× disagreement means the mark was bad, not the position. Mark corrected; the rule is re-checked on the next pass.`;
      await db.update(trades).set({ status: "rejected", error: reason }).where(eq(trades.id, tradeId));
      await db
        .update(tokensTable)
        .set({ lastPriceUsd: quote.priceUsd.toFixed(12), priceUpdatedAt: ctx.now })
        .where(eq(tokensTable.id, decision.tokenId));
      log(agent.id, reason);
      return { tokenId: decision.tokenId, symbol: decision.symbol, reason };
    }
  }

  // `executeTrade` owns everything between the quote and a terminal row: the signature
  // is persisted before `/execute`, a throw becomes `failed` instead of escaping, an
  // unknown outcome is checked against the chain, and an over-ask is retried once
  // against the balance as it really is.
  const settled = await executeTrade({
    tradeId,
    executor,
    request,
    quote,
    refreshSellAmount: () => heldAmountToken(agent.id, decision.tokenId),
  });
  if (settled.status !== "filled") return failed(settled.error);
  const fill = settled.fill;
  quote = settled.quote;

  const filledAt = new Date();
  await db
    .update(trades)
    .set({
      status: "filled",
      amountToken: toNumeric(fill.amountToken, 12),
      amountUsd: toNumeric(fill.amountUsd, 6),
      priceUsd: toNumeric(fill.priceUsd, 12),
      feeUsd: toNumeric(fill.feeUsd, 6),
      txHash: fill.txHash,
      filledAt,
    })
    .where(eq(trades.id, tradeId));

  // An exit is a fill, so it pays the fee like any other. Charged here, settled later:
  // a stop loss must never wait on a USDC transfer.
  const platformFeeUsd = await chargePlatformFee({
    agentId: agent.id,
    tradeId,
    chain: decision.chain,
    isPaper: executor.isPaper,
    now: filledAt,
  });

  await applyFill(
    agent.id,
    decision.tokenId,
    {
      side: "sell",
      amountToken: fill.amountToken,
      amountUsd: fill.amountUsd,
      feeUsd: fill.feeUsd + platformFeeUsd,
      // So a residual below one atomic unit closes the position instead of leaving a
      // dust row the exit engine keeps firing on and no venue will route.
      decimals,
    },
    { priceUsd: fill.priceUsd, now: filledAt },
  );

  // An exit gets the same receipt as any other fill. A stop loss that filled 300 bps
  // below its quote is the single most useful fact a live operator can be handed, and
  // it is invisible without one.
  const receipt = buildReceipt({
    chain: decision.chain,
    side: "sell",
    symbol: decision.symbol,
    tokenAddress: decision.address,
    quote,
    fill,
    slippageToleranceBps: agent.config.risk.slippageBps,
    score,
    platformFeeUsd,
    quotedAt,
    filledAt,
  });
  await saveReceipt(tradeId, agent.id, receipt);

  // The feed post carries the rationale verbatim — it is the whole message on the card.
  await db.insert(posts).values({
    id: nanoid(),
    authorId: agent.ownerId,
    agentId: agent.id,
    tradeId,
    kind: "trade",
    body: decision.rationale,
  });

  const href = `/agents/${agent.slug}`;
  // One owner notification, not two. An exit already tells the owner which rule fired
  // and why; the receipt line is appended to it rather than sent separately, because a
  // second push for the same event is noise, and noise is what makes people mute the
  // channel that carries their stop losses.
  await notify([
    {
      userId: agent.ownerId,
      kind: "exit",
      title: `${EXIT_TITLES[decision.reason]}: sold ${decision.symbol}`,
      body: `${decision.rationale} · ${receiptSummary(receipt)}`,
      href,
    },
    ...ctx.followers
      .filter((id) => id !== agent.ownerId)
      .map((userId) => ({
        userId,
        kind: "trade",
        title: `${agent.name} sold ${decision.symbol}`,
        body: decision.rationale,
        href,
      })),
  ]);

  return { ...base, amountUsd: fill.amountUsd, priceUsd: fill.priceUsd, tradeId, status: "filled", error: null };
}

function isSkip(value: GuardianExitRecord | GuardianSkip): value is GuardianSkip {
  return !("status" in value);
}

/**
 * One guardian pass for one agent. Never throws.
 *
 * @see the module doc for the ordering and the safety properties.
 */
export async function runGuardian(input: RunGuardianInput): Promise<GuardianResult> {
  const now = input.now ?? new Date();
  const wantSnapshot = input.snapshot ?? input.trigger !== "tick";

  try {
    const db = await getDb();
    const rows = await db.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
    const row = rows[0];
    if (!row) return emptyResult(input, "agent not found");

    let config: AgentConfig;
    try {
      config = parseAgentConfig(row.config);
    } catch {
      config = row.config;
    }

    const agent: AgentRecord = {
      id: row.id,
      ownerId: row.ownerId,
      slug: row.slug,
      name: row.name,
      mode: row.mode,
      config,
    };
    const rules = toExitRules(config.risk);

    const portfolio = await getPortfolio(agent.id);
    const marks = new Map<string, number | null>(portfolio.positions.map((p) => [p.token.id, p.markPriceUsd]));
    const peaks = await updatePeaks(agent.id, marks);

    const result: GuardianResult = {
      agentId: agent.id,
      trigger: input.trigger,
      ran: true,
      note: null,
      positions: portfolio.positions.length,
      rescored: 0,
      exits: [],
      skipped: [],
      equityUsd: portfolio.equityUsd,
      settlement: null,
      error: null,
    };

    const finish = async (): Promise<GuardianResult> => {
      // Once a day, on whichever pass happens to be the first after midnight UTC.
      // Not on `tick`: a run already writes its own summary, and two of these for the
      // same day would be one too many if the dedupe ever regressed.
      if (input.trigger !== "tick") await maybeSendDigest(agent, now);

      // The fee sweep, in the same non-tick pass and for the same reasons: it already
      // runs every five minutes for every agent, and it is the one place in the system
      // that is allowed to be slow. Critically, it is *here* — after every exit has been
      // executed — and it cannot throw. Selling first and collecting second is the only
      // order in which a settlement problem can never cost somebody a stop loss.
      if (input.trigger !== "tick") {
        // `settlePlatformFees` contains its own failures, and this catch is the second
        // fence: a bug in the fee code must not be able to turn a pass that sold three
        // positions into a pass that reports nothing.
        try {
          result.settlement = await settlePlatformFees({
            agentId: agent.id,
            ownerId: agent.ownerId,
            agentName: agent.name,
            mode: agent.mode,
            now,
          });
          if (result.settlement.attempted) log(agent.id, `fees: ${result.settlement.note}`);
        } catch (err) {
          log(agent.id, `fee settlement threw: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (wantSnapshot) {
        try {
          // Re-read after exits so the snapshot reflects them.
          const after = result.exits.some((e) => e.status === "filled") ? await getPortfolio(agent.id) : portfolio;
          // Null when the snapshot was skipped because a live balance read failed
          // (W7 H8) — the pass still ran and still took its exits; it just has no
          // trustworthy equity figure to report or to draw.
          result.equityUsd = (await snapshotEquity(after)) ? after.equityUsd : null;
        } catch (err) {
          log(agent.id, `equity snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return result;
    };

    if (portfolio.positions.length === 0) {
      result.note = "flat — nothing to guard";
      return finish();
    }
    if (!hasAnyExitRule(rules)) {
      result.note = "no exit rules configured";
      return finish();
    }

    // Live agents need real Privy wallets. A placeholder is a configuration problem, not
    // a reason to throw twelve times an hour.
    const wallets = await getAgentWallets(agent.id);
    const usableChains = new Set(
      wallets.filter((w) => !w.walletId.startsWith("paper_") && w.address).map((w) => w.chain),
    );
    const tradableChains = (chain: Chain): boolean => agent.mode === "paper" || usableChains.has(chain);
    if (agent.mode === "live" && usableChains.size === 0) {
      result.note =
        "live agent has only placeholder (paper_) wallets — exits cannot be executed until it has real Privy server wallets";
      log(agent.id, result.note);
      return finish();
    }

    // Rescore only when a rule reads a score, and only from the free providers.
    // In parallel (W7 M4): these are independent read-only provider calls, and a book of
    // ten holdings was serialising ten round trips inside a cron pass that has a hard
    // duration cap — the positions at the end of the list were the ones whose stop losses
    // did not get evaluated. The exits themselves stay sequential; they share state.
    const scores = new Map<string, TokenScore>();
    if (needsRescore(rules)) {
      const rescored = await Promise.allSettled(
        portfolio.positions.map(async (p) => {
          const score = await getTokenScore({
            chain: p.token.chain,
            address: p.token.address,
            universe: config.universe,
            maxTradeUsd: config.risk.maxTradeUsd,
            symbolHint: p.token.symbol,
            // No `deep`, no x402 context: a guardian pass never spends money.
          });
          return [p.token.id, score] as const;
        }),
      );
      for (const outcome of rescored) {
        // A rejection means the collapse rules simply have no opinion on that holding.
        if (outcome.status === "fulfilled") scores.set(outcome.value[0], outcome.value[1]);
      }
      result.rescored = scores.size;
    }

    const exitPositions: ExitPosition[] = portfolio.positions.map((p) => {
      const score = scores.get(p.token.id) ?? null;
      return {
        tokenId: p.token.id,
        chain: p.token.chain,
        address: p.token.address,
        symbol: p.token.symbol,
        amountToken: p.amountToken,
        avgCostUsd: p.avgCostUsd,
        markPriceUsd: p.markPriceUsd,
        peakPriceUsd: peaks.get(p.token.id) ?? p.peakPriceUsd,
        openedAt: p.openedAt === null ? null : new Date(p.openedAt),
        entryScore: p.entryScore,
        entryLiquidityUsd: p.entryLiquidityUsd,
        score:
          score === null
            ? null
            : {
                total: score.total,
                verdict: score.verdict,
                blockers: score.blockers,
                liquidityUsd: score.liquidityUsd,
                warnings: score.warnings,
              },
      };
    });

    const decisions = evaluateExits({ rules, positions: exitPositions, now });
    if (decisions.length === 0) {
      result.note = "no exit rules fired";
      return finish();
    }

    const ctx: ExitContext = {
      agent,
      executorAgent: { id: agent.id, mode: agent.mode, wallets },
      portfolio,
      runId: input.runId ?? null,
      now,
      followers: await followerIds(agent.id),
      scores,
      decimals: new Map(portfolio.positions.map((p) => [p.token.id, p.token.decimals])),
    };

    // Sequential on purpose: paper cash, the position rows and the daily trade count are
    // all shared state, and an exit is rare enough that latency does not matter.
    for (const decision of decisions) {
      if (!tradableChains(decision.chain)) {
        result.skipped.push({
          tokenId: decision.tokenId,
          symbol: decision.symbol,
          reason: `live mode has no usable wallet on ${decision.chain}`,
        });
        continue;
      }
      try {
        const outcome = await executeExit(ctx, decision);
        if (isSkip(outcome)) result.skipped.push(outcome);
        else result.exits.push(outcome);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(agent.id, `${decision.symbol} ${decision.reason} threw: ${message}`);
        result.skipped.push({ tokenId: decision.tokenId, symbol: decision.symbol, reason: message });
      }
    }

    result.note = describeExits(decisions);
    return finish();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(input.agentId, `pass failed: ${message}`);
    return { ...emptyResult(input, "guardian pass failed"), error: message };
  }
}
