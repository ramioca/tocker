import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  agentFundingIntents,
  agents,
  agentRuns,
  auditEvents,
  equitySnapshots,
  follows,
  getDb,
  inferencePayments,
  platformFees,
  tokens,
  trades,
  users,
  type Db,
} from "@/db";
import type { TradeScoreSnapshot } from "@/db/schema";
import { thinkingModel } from "@/lib/agent/inference";
import { closedSells, type AnalyticsFill } from "@/lib/analytics";
import { toNum, toNumOrNull } from "@/lib/money";
import { flowsBetween, pnlNetOfFlows, type MoneyFlow } from "@/lib/pnl";
import type {
  AgentCard,
  Chain,
  EquityPoint,
  ScoreComponents,
  TokenRef,
  TradeRow,
  TradeScore,
  UserCard,
} from "@/server/types";
import { visibleError, visibleRationale, visibleScore } from "./visibility";

// ---------- ids & slugs ----------

export function newId(prefix?: string): string {
  const id = nanoid(16);
  return prefix ? `${prefix}_${id}` : id;
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base || "agent";
}

/**
 * Slugs that are routes. `/agents/new` is the builder, and a static segment wins over
 * `/agents/[slug]`: an agent called "New" got the slug `new`, so its page could never
 * be opened and every link to it opened the empty builder instead. Anything added
 * beside `[slug]` under `app/.../agents/` belongs in this set.
 */
const RESERVED_AGENT_SLUGS: ReadonlySet<string> = new Set(["new"]);

/** Globally unique agent slug (`agents.slug` is unique) — appends -2, -3, … */
export async function uniqueSlug(name: string, db?: Db): Promise<string> {
  const database = db ?? (await getDb());
  const base = slugify(name);
  const root = RESERVED_AGENT_SLUGS.has(base) ? `${base}-agent` : base;
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const [taken] = await database.select({ id: agents.id }).from(agents).where(eq(agents.slug, candidate)).limit(1);
    if (!taken) return candidate;
  }
  return `${root}-${nanoid(6).toLowerCase()}`;
}

// ---------- cursors ----------

/** Cursor = base64("<ISO createdAt>|<id>"). Stable for keyset pagination. */
export function encodeCursor(createdAt: Date | string, id: string): string {
  const iso = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  return Buffer.from(`${iso}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = raw.lastIndexOf("|");
    if (sep < 0) return null;
    const at = new Date(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (Number.isNaN(at.getTime()) || !id) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export const DEFAULT_PAGE = 20;
export const MAX_PAGE = 50;

export function pageSize(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_PAGE;
  return Math.min(MAX_PAGE, Math.max(1, Math.floor(limit)));
}

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// ---------- row mappers ----------

export function toUserCard(row: {
  id: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
}): UserCard {
  return { id: row.id, handle: row.handle, displayName: row.displayName, avatarUrl: row.avatarUrl };
}

export type TokenRow = typeof tokens.$inferSelect;

export function toTokenRef(row: TokenRow): TokenRef {
  return {
    id: row.id,
    chain: row.chain as Chain,
    address: row.address,
    symbol: row.symbol,
    name: row.name,
    logoUrl: row.logoUrl,
    decimals: row.decimals,
    lastPriceUsd: toNumOrNull(row.lastPriceUsd),
  };
}

function numberOrUndefined(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * `trades.scoreSnapshot` → `TradeRow.score`. The score is public on purpose: it is the
 * verdict on a token at one moment, not the rules that produced it.
 */
export function toTradeScore(snapshot: TradeScoreSnapshot | null | undefined): TradeScore | null {
  if (!snapshot || typeof snapshot.total !== "number") return null;
  // A reading no provider answered, frozen onto a fill before trades stopped storing
  // those (`toTradeScore` in `@/lib/tokens`): zero, no pool, and the scorer's own
  // `low_confidence`. It says the token was not read, so it is shown as not scored
  // rather than as "0 · Avoid".
  const unread = snapshot.total === 0 && (snapshot.liquidityUsd ?? null) === null;
  if (unread && (snapshot.warnings ?? []).includes("low_confidence")) return null;
  const raw = snapshot.components ?? {};
  const components: Partial<ScoreComponents> = {
    safety: numberOrUndefined(raw.safety),
    liquidity: numberOrUndefined(raw.liquidity),
    momentum: numberOrUndefined(raw.momentum),
    organic: numberOrUndefined(raw.organic),
    distribution: numberOrUndefined(raw.distribution),
    // gecko, sentiment and smartMoney are explicitly nullable: null means "nobody
    // rated it" or "the agent did not pay for it", which is a different fact from a
    // sub-score of zero.
    gecko: typeof raw.gecko === "number" ? raw.gecko : null,
    sentiment: typeof raw.sentiment === "number" ? raw.sentiment : null,
    smartMoney: typeof raw.smartMoney === "number" ? raw.smartMoney : null,
  };
  return {
    total: snapshot.total,
    verdict: snapshot.verdict,
    components,
    blockers: snapshot.blockers ?? [],
    warnings: snapshot.warnings ?? [],
    liquidityUsd: snapshot.liquidityUsd ?? null,
    ageHours: snapshot.ageHours ?? null,
    scoredAt: snapshot.scoredAt,
  };
}

/**
 * A trade as `viewer` may see it. Redacted unless the viewer is the agent's owner: the
 * provider error (`visibleError`), the parts of the score snapshot that describe the
 * agent's own rules and paid sources (`visibleScore`), and the thresholds and vendor
 * names a rationale can carry (`visibleRationale`). Defaulting to the non-owner view
 * means a new caller that forgets the argument under-shares instead of leaking.
 */
export function toTradeRow(
  row: typeof trades.$inferSelect,
  token: TokenRef,
  viewer: { isOwner: boolean } = { isOwner: false },
): TradeRow {
  return {
    id: row.id,
    agentId: row.agentId,
    runId: row.runId ?? null,
    chain: row.chain as Chain,
    side: row.side,
    token,
    amountToken: toNum(row.amountToken),
    amountUsd: toNum(row.amountUsd),
    priceUsd: toNum(row.priceUsd),
    feeUsd: toNum(row.feeUsd),
    status: row.status,
    origin: row.origin,
    exitReason: (row.exitReason as TradeRow["exitReason"]) ?? null,
    requestedUsd: row.requestedUsd === null ? null : toNum(row.requestedUsd),
    proposedAt: iso(row.proposedAt),
    decidedAt: iso(row.decidedAt),
    decidedBy: row.decidedBy,
    entryScore: toTradeScore(row.scoreSnapshot)?.total ?? null,
    isPaper: row.isPaper,
    txHash: row.txHash,
    rationale: visibleRationale(row.rationale, {
      isOwner: viewer.isOwner,
      exitReason: row.exitReason as TradeRow["exitReason"],
      symbol: token.symbol,
    }),
    score: visibleScore(toTradeScore(row.scoreSnapshot), viewer.isOwner),
    error: visibleError(row.error, viewer.isOwner),
    createdAt: row.createdAt.toISOString(),
    filledAt: iso(row.filledAt),
    realizedPnlUsd: null,
    realizedPnlPct: null,
  };
}

/**
 * What a fill cost in fees, as the position ledger booked it: the venue's fee on the
 * trade row plus the Tocker fee charged on that fill (`platform_fees`, one row per
 * trade). Every replay of fills into realised P&L or a win rate uses this, so a sale
 * reads the same after fees on the feed, on Home, on the Performance tab and in the
 * Sold dialog.
 */
export function fillFeeUsd(venueFeeUsd: string | number | null, tockerFeeUsd: string | number | null): number {
  return toNum(venueFeeUsd) + toNum(tockerFeeUsd);
}

/**
 * Fill in what each filled sell booked, on the same average-cost replay (`closedSells`)
 * that /money and the agent's stat cards read, so a feed card cannot disagree with
 * them. After fees, the Tocker fee included ({@link fillFeeUsd}). Paper and live fills
 * are separate books. Everything else keeps its nulls.
 */
export async function attachRealizedPnl<T extends TradeRow>(db: Db, rows: T[]): Promise<T[]> {
  const agentIds = [
    ...new Set(rows.filter((r) => r.side === "sell" && r.status === "filled").map((r) => r.agentId)),
  ];
  if (agentIds.length === 0) return rows;

  const fills = await db
    .select({ trade: trades, tockerFeeUsd: platformFees.amountUsd })
    .from(trades)
    // `platform_fees.trade_id` is unique, so this never repeats a fill.
    .leftJoin(platformFees, eq(platformFees.tradeId, trades.id))
    .where(and(inArray(trades.agentId, agentIds), eq(trades.status, "filled")));

  const books = new Map<string, AnalyticsFill[]>();
  for (const { trade: row, tockerFeeUsd } of fills) {
    const key = `${row.agentId}:${row.isPaper ? "paper" : "live"}`;
    const list = books.get(key) ?? [];
    list.push({
      id: row.id,
      tokenId: row.tokenId,
      chain: row.chain as Chain,
      side: row.side,
      amountToken: toNum(row.amountToken),
      amountUsd: toNum(row.amountUsd),
      priceUsd: toNum(row.priceUsd),
      feeUsd: fillFeeUsd(row.feeUsd, tockerFeeUsd),
      status: row.status,
      origin: row.origin,
      exitReason: (row.exitReason as TradeRow["exitReason"]) ?? null,
      entryScore: null,
      createdAt: row.createdAt,
    });
    books.set(key, list);
  }

  const bySell = new Map<string, { usd: number; pct: number | null }>();
  for (const book of books.values()) {
    for (const sell of closedSells(book)) {
      bySell.set(sell.sellId, {
        usd: sell.realizedPnlUsd,
        pct: sell.costBasisUsd > 0 ? (sell.realizedPnlUsd / sell.costBasisUsd) * 100 : null,
      });
    }
  }

  for (const row of rows) {
    const hit = row.side === "sell" && row.status === "filled" ? bySell.get(row.id) : undefined;
    row.realizedPnlUsd = hit?.usd ?? null;
    row.realizedPnlPct = hit?.pct ?? null;
  }
  return rows;
}

/** Load the tokens referenced by a set of trades, keyed by token id. */
export async function loadTokens(db: Db, ids: string[]): Promise<Map<string, TokenRef>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const rows = await db.select().from(tokens).where(inArray(tokens.id, unique));
  return new Map(rows.map((r) => [r.id, toTokenRef(r)]));
}

// ---------- agent cards ----------

export type AgentRow = typeof agents.$inferSelect;

export interface AgentAggregates {
  equityUsd: number | null;
  /**
   * What the current book is measured against: a paper agent's notional, or a live
   * agent's first live mark plus what has been deposited since, less what has been
   * withdrawn. All-time PnL is equity less this, here and on the agent page.
   */
  startEquityUsd: number | null;
  /** What all-time PnL is a percent of: the same, without the withdrawals. */
  capitalUsd: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  /** See {@link BookMarks}: what moved after the latest mark, for a reader with a fresher equity. */
  flowSinceMarkUsd: number;
  depositsSinceMarkUsd: number;
  /** True when the book has two marks to measure between. */
  hasWindow: boolean;
  /** The latest mark's row and time; null when the book has never been marked. */
  markId: string | null;
  markedAt: Date | null;
  sparkline: number[];
  tradeCount: number;
  followerCount: number;
  cashUsd: number | null;
}

const EMPTY_AGG: AgentAggregates = {
  equityUsd: null,
  startEquityUsd: null,
  capitalUsd: null,
  pnlUsd: null,
  pnlPct: null,
  flowSinceMarkUsd: 0,
  depositsSinceMarkUsd: 0,
  hasWindow: false,
  markId: null,
  markedAt: null,
  sparkline: [],
  tradeCount: 0,
  followerCount: 0,
  cashUsd: null,
};

/**
 * The equity series belongs to the book the agent is running **now**.
 *
 * An agent is born in paper mode with a $10,000 notional and gets snapshotted every
 * marks pass. Going live swaps that book for a real wallet holding, say, $10. Reading
 * both halves as one series makes the flip look like a −99.9% day — on the agent card,
 * on the public leaderboard and on the home overview — which is not a loss, it is a
 * change of units.
 *
 * So every read of `equity_snapshots` filters to the agent's current mode.
 * `mode` is nullable because rows written before the column existed have none; those
 * are treated as the current mode, which is right for the overwhelmingly common case
 * (an agent that has never flipped) and no worse than today's behaviour otherwise.
 *
 * The predicate compares against `agents.mode`, so the query has to have `agents`
 * joined. That is deliberate: it keeps one rule in one place instead of passing a mode
 * down through four call sites that would each have to remember to.
 */
export function snapshotInCurrentMode() {
  return or(isNull(equitySnapshots.mode), eq(equitySnapshots.mode, agents.mode));
}

/** Epoch seconds from a raw `extract(epoch …)` column, which arrives as a number or a string. */
function epochMs(value: number | string | null): number {
  const seconds = typeof value === "number" ? value : Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : Number.NaN;
}

/**
 * Each agent's close per UTC day since `since` — the last snapshot of the day — oldest
 * first, in the agent's current mode.
 *
 * Snapshots land every five minutes, so a month is ~8,600 rows per agent. Every reader
 * that draws a month (a card sparkline, the agent page's stat cards) wants one point a
 * day, and fetching the rest to throw it away made payloads grow without bound and
 * turned "the last 30 points" into the last two and a half hours.
 */
export async function loadDailyCloses(db: Db, agentIds: string[], since: Date): Promise<Map<string, EquityPoint[]>> {
  const out = new Map<string, EquityPoint[]>();
  const ids = [...new Set(agentIds)].filter(Boolean);
  if (ids.length === 0) return out;
  const lastAt = sql`max(${equitySnapshots.at})`;
  const rows = await db
    .select({
      agentId: equitySnapshots.agentId,
      // Epoch, not the timestamp: a raw aggregate is not column-mapped, and Postgres
      // prints a timestamptz as "… +00", which `Date` cannot parse.
      at: sql<number | string>`extract(epoch from ${lastAt})::float8`,
      equityUsd: sql<string>`(array_agg(${equitySnapshots.equityUsd}::text order by ${equitySnapshots.at} desc, ${equitySnapshots.id} desc))[1]`,
      cashUsd: sql<string>`(array_agg(${equitySnapshots.cashUsd}::text order by ${equitySnapshots.at} desc, ${equitySnapshots.id} desc))[1]`,
    })
    .from(equitySnapshots)
    .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
    .where(and(inArray(equitySnapshots.agentId, ids), snapshotInCurrentMode(), gte(equitySnapshots.at, since)))
    .groupBy(equitySnapshots.agentId, sql`date_trunc('day', ${equitySnapshots.at} at time zone 'UTC')`)
    .orderBy(equitySnapshots.agentId, lastAt);
  for (const row of rows) {
    const ms = epochMs(row.at);
    if (!Number.isFinite(ms)) continue;
    const list = out.get(row.agentId) ?? [];
    list.push({ at: new Date(ms).toISOString(), equityUsd: toNum(row.equityUsd), cashUsd: toNum(row.cashUsd) });
    out.set(row.agentId, list);
  }
  return out;
}

// ---------- money moved in and out of a live book ----------

/**
 * USDC an audited `withdraw` row took out of an agent, or 0 when it is not an owner's
 * USDC withdrawal. The kind is shared: fee settlement and rent recycling also write it
 * (with a `reason`), and those are costs or moved no USDC, not the owner taking money
 * out. A Solana withdrawal records what was `delivered` (0 when it failed on chain); a
 * Base one records the `amount` sent.
 */
export function withdrawnUsdc(metadata: Record<string, unknown> | null | undefined): number {
  if (!metadata || metadata.reason !== undefined || metadata.asset !== "usdc") return 0;
  if (metadata.status === "failed") return 0;
  const raw = metadata.delivered ?? metadata.amount;
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * A pay-per-use payment PROVEN to have left the wallet, as a condition on
 * `inference_payments`:
 *
 *  - `paid_no_answer`: no usable answer came, and the payment has its proof. The pay path
 *    writes this status only with the same proof a transaction id needs (below), and the
 *    reconciler only on finding the transfer on chain; without proof the row is
 *    `unconfirmed`;
 *  - `settled` WITH a transaction id: answered, and the row names the payment's own
 *    transaction. The id is written in one of two ways and no other: by the pay path,
 *    when the gateway's receipt names an id that is this payment's own (checked against
 *    the bytes that were signed) and says it settled; or by the reconciler, when it finds
 *    the transfer on chain. The first rests on the gateway's word that its own
 *    transaction landed, which `scripts/inference-audit.ts` is there to check.
 *
 * The Money page's "Thinking" figure and the flow taken out of P&L are both made from
 * exactly this condition, so the two cannot disagree, and the page's Net (P&L less costs)
 * is right whichever side of it a row is on.
 *
 * Left out on purpose, because a public P&L is not adjusted on an assumption:
 *
 *  - `settled` with NO transaction id: the step was answered, and whether its payment
 *    landed is still being checked. The ledger counts it as charged against every limit
 *    (the safe side for a cap). It is the unsafe side for a P&L: netted and never landed,
 *    it would read as a gain nobody made, for good. It joins when the reconciler writes
 *    the transaction id, and never joins if the reconciler proves it was not charged
 *    (the row is then `not_charged`, and the answer was free).
 *  - `signed` and `unconfirmed`: signed, and whether the money moved is not yet known.
 *  - `reserved`, `released` and `not_charged`: nothing left the wallet.
 *  - `simulated`: mock mode, no money.
 *
 * Until a row is proven its amount is in no Thinking total and stays in the P&L as it
 * fell out of the wallet: a few cents of loss, never a gain.
 */
export function thinkingProvenSql() {
  return sql<boolean>`(${inferencePayments.status} = 'paid_no_answer' or (${inferencePayments.status} = 'settled' and ${inferencePayments.txHash} is not null))`;
}

/**
 * Answered, and not yet proven on chain: a `settled` row the gateway gave no transaction
 * id for. Counted as charged, shown as being checked, and netted from nothing (see
 * {@link thinkingProvenSql}).
 */
export function thinkingAnsweredUnprovenSql() {
  return sql<boolean>`(${inferencePayments.status} = 'settled' and ${inferencePayments.txHash} is null)`;
}

/** What one ledger row took from the wallet: the settled amount, or the quote when the gateway named none. */
export function thinkingPaidUsdSql() {
  return sql<string>`coalesce(${inferencePayments.settledUsd}, ${inferencePayments.quotedUsd})`;
}

/** When a ledger row's payment was made: its signature, or the row's own time before there was one. */
export function thinkingPaidAtSql() {
  return sql<Date>`coalesce(${inferencePayments.signedAt}, ${inferencePayments.createdAt})`;
}

/**
 * What each live agent paid for its own thinking, as flows: one row per run and per
 * stretch between two marks of the book, dated at the last payment in it.
 *
 * Per run and not per step because a run pays for up to twenty-one steps inside a few
 * minutes, so its total nets the same and is a tenth of the rows. But never across a
 * mark. Every reader of these flows measures between two marks of the agent's current
 * book and asks which side of each a flow falls on (`flowsBetween`), and a mark taken
 * while a run is paying already lacks the steps before it and still holds the ones
 * after. A run's whole total at its last payment's time puts the earlier steps on the
 * wrong side of that mark: measured from it (a 7 or 30 day window's baseline, or the
 * book's first mark), the P&L read high by what was paid before it. So the cut is made
 * here, step by step: each payment is keyed by the latest mark strictly before it, and
 * only payments between the same two marks are added up. A flow dated exactly at a mark
 * is inside that mark, as `flowsBetween` reads it, hence "strictly".
 *
 * A payment with no mark before it (made at or before the book's first mark, or by an
 * agent never marked) is no flow at all: every reader measures from a mark at or after
 * the first, so that money is already inside it.
 *
 * Only payments proven to have left the wallet ({@link thinkingProvenSql}).
 *
 * The ledger has no foreign keys, so the join to `agents` is also what drops the rows of
 * agents that no longer exist. An agent with no proven ledger row costs this nothing: it
 * is not among the agents the query starts from.
 *
 * How the query is shaped matters as much as what it returns, because it runs for every
 * card, the leaderboard and /money. Two things in it are dear, and each is done as
 * seldom as it can be:
 *
 *  - The book's first mark is worked out once per paying agent, in a list of those
 *    agents that the rest of the query reads from (the list carries a LIMIT it can never
 *    reach, which keeps the database from folding it into the join, where the first
 *    mark would be worked out again per payment).
 *  - The mark before a payment is looked up only for payments after that first mark.
 *    The others are no flow whatever the lookup would find, and they are the dear ones:
 *    an agent that paid for its thinking through weeks on paper and then went live has
 *    thousands of them, and for each the lookup walks back through every paper snapshot
 *    before it (none is a mark of the live book) to find nothing. So they are dropped by
 *    one comparison first, and nothing later filters on the lookup's own result: a
 *    filter on it would have the database look every payment up before it had dropped
 *    any. Measured on an agent with 2,000 payments from 4,000 paper marks and 100 since
 *    going live: 430 ms looked up per payment, 40 ms this way.
 */
async function loadThinkingFlows(db: Db, ids: string[]): Promise<Array<{ agentId: string; atMs: number | string | bigint; usd: string }>> {
  const paidAt = thinkingPaidAtSql();
  // The live agents among `ids` that have a proven payment, each with the first snapshot
  // of the book it is running now: the same row `loadBookMarks` measures all-time P&L
  // from. Null for an agent never marked.
  const payers = db.$with("thinking_payers").as(
    db
      .select({
        id: sql<string>`${agents.id}`.as("thinking_payer_id"),
        mode: sql<string>`${agents.mode}`.as("thinking_payer_mode"),
        // The agent's columns are named in full here. In a query that reads one table
        // the builder writes a column bare, and inside this inner query a bare `id` or
        // `mode` would be the snapshot's own.
        firstAt: sql<Date | null>`(
          select min(${equitySnapshots.at}) from ${equitySnapshots}
          where ${equitySnapshots.agentId} = ${agents}.${sql.identifier(agents.id.name)}
            and (${equitySnapshots.mode} is null or ${equitySnapshots.mode} = ${agents}.${sql.identifier(agents.mode.name)})
        )`.as("thinking_first_at"),
      })
      .from(agents)
      .where(
        and(
          inArray(
            agents.id,
            db
              .select({ agentId: inferencePayments.agentId })
              .from(inferencePayments)
              .where(and(inArray(inferencePayments.agentId, ids), thinkingProvenSql())),
          ),
          eq(agents.mode, "live"),
        ),
      )
      // Never fewer than there are agents to return, so it cuts nothing. It is here as a
      // fence: a list with a LIMIT is read as it stands, not folded into the join.
      .limit(ids.length),
  );
  // The latest snapshot, strictly before this payment, of the book the agent is running
  // now: the same rows `loadBookMarks` and the leaderboard's windows measure between.
  const markBefore = sql<Date | null>`(
    select max(${equitySnapshots.at}) from ${equitySnapshots}
    where ${equitySnapshots.agentId} = ${payers.id}
      and (${equitySnapshots.mode} is null or ${equitySnapshots.mode} = ${payers.mode})
      and ${equitySnapshots.at} < ${paidAt}
  )`;
  const paid = db.$with("thinking_paid").as(
    db
      .select({
        agentId: sql<string>`${payers.id}`.as("thinking_agent_id"),
        runKey: sql<string>`coalesce(${inferencePayments.runId}, ${inferencePayments.id})`.as("thinking_run_key"),
        at: sql<Date>`${paidAt}`.as("thinking_paid_at"),
        usd: thinkingPaidUsdSql().as("thinking_usd"),
        markBefore: markBefore.as("thinking_mark_before"),
      })
      .from(payers)
      .innerJoin(inferencePayments, eq(inferencePayments.agentId, payers.id))
      .where(
        and(
          thinkingProvenSql(),
          // Strictly after the book's first mark: a payment at that instant is inside the
          // mark. An agent never marked has no first mark, and nothing is after nothing.
          sql`${paidAt} > ${payers.firstAt}`,
        ),
      ),
  );
  // No filter on `markBefore`: every payment that reaches here is after the first mark,
  // so there is always a mark before it (see the note above on why none is added).
  return db
    .with(payers, paid)
    .select({
      agentId: paid.agentId,
      // Whole epoch milliseconds, not the timestamp (a raw aggregate is not column-mapped,
      // and Postgres prints a timestamptz as "… +00", which `Date` cannot parse) and not
      // float seconds either: a payment dated at the instant of a mark has to compare
      // equal to that mark's own time, and a double times a thousand lands a hair off.
      atMs: sql<number | string | bigint>`floor(extract(epoch from max(${paid.at})) * 1000)::bigint`,
      usd: sql<string>`coalesce(sum(${paid.usd}), 0)`,
    })
    .from(paid)
    .groupBy(paid.agentId, paid.runKey, paid.markBefore);
}

/**
 * Every movement of money into or out of these agents' wallets that Tocker has a record
 * of and that is not a trade, per agent:
 *
 *  - funding transfers that were sent (`agent_funding_intents`), in;
 *  - the owner's audited USDC withdrawals, out;
 *  - what the agent paid for its own thinking (`inference_payments`, pay-per-use only),
 *    out. It is a running cost paid from the trading wallet, not a trading loss: an agent
 *    on its owner's key has the same bill and it never touches its book, so the two would
 *    not rank alike on the leaderboard if this one counted against it. The Money page
 *    shows the amount as its own line and subtracts it there, once.
 *
 * Live agents only. A paper book is measured from its notional and its equity is not its
 * wallet, so real money moving through that wallet (a deposit, or a paper agent paying
 * for its thinking) changes nothing in it and gets no entry.
 *
 * Thinking arrives one flow per run and per stretch between two marks, only for payments
 * proven on chain and made after the book's first mark (`loadThinkingFlows`), so an
 * agent that has never been marked has none.
 *
 * These are what every live P&L nets out, the same sources `/money`'s daily table reads.
 * What is not here cannot be netted: USDC sent to an agent's address from outside Tocker
 * has no funding row, and still reads as a gain.
 */
export async function loadMoneyFlows(db: Db, agentIds: string[]): Promise<Map<string, MoneyFlow[]>> {
  const out = new Map<string, MoneyFlow[]>();
  const ids = [...new Set(agentIds)].filter(Boolean);
  if (ids.length === 0) return out;

  const [deposits, withdrawals, thinking] = await Promise.all([
    db
      .select({
        agentId: agentFundingIntents.agentId,
        // Epoch seconds, not the timestamp: a raw `coalesce` is not column-mapped, and
        // Postgres prints a timestamptz as "… +00", which `Date` cannot parse.
        at: sql<number | string>`extract(epoch from coalesce(${agentFundingIntents.settledAt}, ${agentFundingIntents.createdAt}))::float8`,
        amount: agentFundingIntents.amount,
      })
      .from(agentFundingIntents)
      .innerJoin(agents, eq(agents.id, agentFundingIntents.agentId))
      .where(
        and(
          inArray(agentFundingIntents.agentId, ids),
          eq(agents.mode, "live"),
          eq(agentFundingIntents.status, "sent"),
          sql`lower(${agentFundingIntents.asset}) = 'usdc'`,
        ),
      ),
    db
      .select({ agentId: auditEvents.agentId, at: auditEvents.createdAt, metadata: auditEvents.metadata })
      .from(auditEvents)
      .innerJoin(agents, eq(agents.id, auditEvents.agentId))
      .where(
        and(
          inArray(auditEvents.agentId, ids),
          eq(agents.mode, "live"),
          eq(auditEvents.kind, "withdraw"),
          // Fee sweeps and rent recycles share the kind and carry a reason; there is one
          // of those per sweep, so they are left in the database. `withdrawnUsdc` is
          // still what decides.
          sql`(${auditEvents.metadata} ->> 'reason') is null`,
        ),
      ),
    loadThinkingFlows(db, ids),
  ]);

  const add = (agentId: string, flow: MoneyFlow) => {
    const list = out.get(agentId) ?? [];
    list.push(flow);
    out.set(agentId, list);
  };
  for (const row of deposits) {
    const ms = epochMs(row.at);
    const amountUsd = toNum(row.amount);
    if (Number.isFinite(ms) && amountUsd > 0) add(row.agentId, { at: ms, amountUsd });
  }
  for (const row of withdrawals) {
    const usdc = withdrawnUsdc(row.metadata);
    if (row.agentId && usdc > 0) add(row.agentId, { at: row.at, amountUsd: -usdc });
  }
  for (const row of thinking) {
    const ms = Number(row.atMs);
    const paidUsd = toNum(row.usd);
    if (Number.isFinite(ms) && paidUsd > 0) add(row.agentId, { at: ms, amountUsd: -paidUsd, kind: "thinking" });
  }
  return out;
}

/**
 * Where an agent's current book stands against where it started: its latest mark, and
 * the all-time P&L measured to it.
 */
export interface BookMarks {
  mode: AgentRow["mode"];
  /** The latest snapshot. */
  markId: string;
  markedAt: Date;
  equityUsd: number;
  cashUsd: number;
  /** True when the book has a first and a latest mark that are not the same row. */
  hasWindow: boolean;
  /**
   * What `equityUsd` is measured against: a paper agent's notional, or a live agent's
   * first live mark plus what was deposited, less what was withdrawn, up to the latest
   * mark.
   */
  startEquityUsd: number;
  /** What the percent is taken on: the same, without the withdrawals. */
  capitalUsd: number;
  /** Null for a live book with a single mark: one snapshot is no window at all. */
  pnlUsd: number | null;
  pnlPct: number | null;
  /**
   * Deposits less withdrawals since the latest mark, and the deposits alone. A reader
   * holding an equity fresher than that mark (the wallet, read now) adds these to the
   * basis and the capital, or a deposit made a minute ago reads as a gain until the next
   * marks pass. Always 0 for a paper book.
   */
  flowSinceMarkUsd: number;
  depositsSinceMarkUsd: number;
}

/**
 * The first and latest snapshot of each agent's current book, with the money that moved
 * in between taken out of the P&L. Agents with no snapshot in their current mode get no
 * entry. Two `distinct on` reads and the flows: never the snapshot history. A caller
 * that needs the flows for itself loads them once and hands them over.
 */
export async function loadBookMarks(
  db: Db,
  agentIds: string[],
  loadedFlows?: Promise<Map<string, MoneyFlow[]>>,
): Promise<Map<string, BookMarks>> {
  const out = new Map<string, BookMarks>();
  const ids = [...new Set(agentIds)].filter(Boolean);
  if (ids.length === 0) return out;

  const edge = (order: "first" | "latest") =>
    db
      .selectDistinctOn([equitySnapshots.agentId], {
        agentId: equitySnapshots.agentId,
        id: equitySnapshots.id,
        equityUsd: equitySnapshots.equityUsd,
        cashUsd: equitySnapshots.cashUsd,
        at: equitySnapshots.at,
        mode: agents.mode,
        paperStartingUsd: agents.paperStartingUsd,
      })
      .from(equitySnapshots)
      .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
      .where(and(inArray(equitySnapshots.agentId, ids), snapshotInCurrentMode()))
      .orderBy(
        equitySnapshots.agentId,
        order === "first" ? asc(equitySnapshots.at) : desc(equitySnapshots.at),
        order === "first" ? asc(equitySnapshots.id) : desc(equitySnapshots.id),
      );

  const [firstRows, latestRows, flows] = await Promise.all([
    edge("first"),
    edge("latest"),
    loadedFlows ?? loadMoneyFlows(db, ids),
  ]);

  const firstByAgent = new Map(firstRows.map((r) => [r.agentId, r]));
  for (const latest of latestRows) {
    const lastEquity = toNum(latest.equityUsd);
    const first = firstByAgent.get(latest.agentId);
    const marks = {
      mode: latest.mode,
      markId: latest.id,
      markedAt: latest.at,
      equityUsd: lastEquity,
      cashUsd: toNum(latest.cashUsd),
      hasWindow: Boolean(first) && first?.id !== latest.id,
    };
    // A paper book started at its notional, not at its first mark — that mark can land
    // after the first fill's fee, and then the card, the agent header and the chart
    // (which is drawn against the notional) each printed a different all-time PnL.
    if (latest.mode === "paper") {
      const start = toNum(latest.paperStartingUsd);
      const pnlUsd = lastEquity - start;
      out.set(latest.agentId, {
        ...marks,
        startEquityUsd: start,
        capitalUsd: start,
        pnlUsd,
        pnlPct: start === 0 ? 0 : (pnlUsd / Math.abs(start)) * 100,
        flowSinceMarkUsd: 0,
        depositsSinceMarkUsd: 0,
      });
      continue;
    }
    // Live: first mark to latest, as `pnlOverWindow(series, "all")` reads it, less what
    // was deposited or withdrawn between the two. A flow after the latest mark is not in
    // that mark's equity yet, so it is kept apart rather than netted against it.
    const start = first ?? latest;
    const agentFlows = flows.get(latest.agentId);
    const book = pnlNetOfFlows(toNum(start.equityUsd), lastEquity, flowsBetween(agentFlows, start.at, latest.at));
    const sinceMark = flowsBetween(agentFlows, latest.at);
    out.set(latest.agentId, {
      ...marks,
      startEquityUsd: book.basisUsd,
      capitalUsd: book.capitalUsd,
      // One snapshot is no window at all.
      pnlUsd: marks.hasWindow ? book.pnlUsd : null,
      pnlPct: marks.hasWindow ? book.pnlPct : null,
      flowSinceMarkUsd: sinceMark.netUsd,
      depositsSinceMarkUsd: sinceMark.inUsd,
    });
  }
  return out;
}

/** How far back a card's sparkline reaches, in daily closes. */
const SPARKLINE_DAYS = 30;

/**
 * Batch-load the numbers every agent card needs. One query per aggregate rather
 * than one per agent, and never the whole snapshot history: the first and latest
 * snapshot per agent carry the PnL, and the sparkline is daily closes.
 */
export async function loadAgentAggregates(
  db: Db,
  agentIds: string[],
  loadedFlows?: Promise<Map<string, MoneyFlow[]>>,
): Promise<Map<string, AgentAggregates>> {
  const out = new Map<string, AgentAggregates>();
  const ids = [...new Set(agentIds)].filter(Boolean);
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, { ...EMPTY_AGG, sparkline: [] });

  const [marks, closes, tradeCounts, followerCounts] = await Promise.all([
    loadBookMarks(db, ids, loadedFlows),
    loadDailyCloses(db, ids, new Date(Date.now() - SPARKLINE_DAYS * 86_400_000)),
    db
      .select({ agentId: trades.agentId, n: sql<number>`count(*)::int` })
      .from(trades)
      .where(and(inArray(trades.agentId, ids), eq(trades.status, "filled")))
      .groupBy(trades.agentId),
    db
      .select({ targetId: follows.targetId, n: sql<number>`count(*)::int` })
      .from(follows)
      .where(and(eq(follows.targetType, "agent"), inArray(follows.targetId, ids)))
      .groupBy(follows.targetId),
  ]);

  for (const [agentId, book] of marks) {
    const agg = out.get(agentId);
    if (!agg) continue;
    agg.equityUsd = book.equityUsd;
    agg.cashUsd = book.cashUsd;
    agg.sparkline = (closes.get(agentId) ?? []).map((p) => p.equityUsd);
    agg.startEquityUsd = book.startEquityUsd;
    agg.capitalUsd = book.capitalUsd;
    agg.pnlUsd = book.pnlUsd;
    agg.pnlPct = book.pnlPct;
    agg.flowSinceMarkUsd = book.flowSinceMarkUsd;
    agg.depositsSinceMarkUsd = book.depositsSinceMarkUsd;
    agg.hasWindow = book.hasWindow;
    agg.markId = book.markId;
    agg.markedAt = book.markedAt;
  }

  for (const row of tradeCounts) {
    const agg = out.get(row.agentId);
    if (agg) agg.tradeCount = Number(row.n ?? 0);
  }
  for (const row of followerCounts) {
    const agg = out.get(row.targetId);
    if (agg) agg.followerCount = Number(row.n ?? 0);
  }

  return out;
}

export function toAgentCard(agent: AgentRow, owner: UserCard, agg: AgentAggregates = EMPTY_AGG): AgentCard {
  return {
    id: agent.id,
    slug: agent.slug,
    name: agent.name,
    tagline: agent.tagline,
    avatarSeed: agent.avatarSeed,
    mode: agent.mode,
    status: agent.status,
    isPublic: agent.isPublic,
    owner,
    // Chains and model are public (the card advertises them); the rest of `config` is not.
    // The model is the one the agent thinks on: a pay-per-use agent's own, not the key
    // model its config still carries from before it was switched. Read as defensively as
    // before: a stored config with no `llm` block prints no model rather than throwing.
    chains: (agent.config?.chains ?? []) as Chain[],
    model: (agent.config?.llm ? thinkingModel({ llm: agent.config.llm }) : "") ?? "",
    pnlUsd: agg.pnlUsd,
    pnlPct: agg.pnlPct,
    equityUsd: agg.equityUsd ?? (agent.mode === "paper" ? toNum(agent.paperStartingUsd) : null),
    tradeCount: agg.tradeCount,
    followerCount: agg.followerCount,
    sparkline: agg.sparkline,
    lastRunAt: iso(agent.lastRunAt),
    createdAt: agent.createdAt.toISOString(),
  };
}

/**
 * Agents → AgentCards, loading owners and aggregates in bulk. A caller that already
 * holds the aggregates for these agents passes them in rather than have them read twice.
 */
export async function buildAgentCards(
  db: Db,
  rows: AgentRow[],
  loaded?: Map<string, AgentAggregates>,
): Promise<AgentCard[]> {
  if (rows.length === 0) return [];
  const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
  const [owners, aggregates] = await Promise.all([
    db
      .select({ id: users.id, handle: users.handle, displayName: users.displayName, avatarUrl: users.avatarUrl })
      .from(users)
      .where(inArray(users.id, ownerIds)),
    loaded ??
      loadAgentAggregates(
        db,
        rows.map((r) => r.id),
      ),
  ]);
  const ownerById = new Map(owners.map((o) => [o.id, toUserCard(o)]));
  const fallbackOwner = (id: string): UserCard => ({ id, handle: "unknown", displayName: null, avatarUrl: null });
  return rows.map((r) => toAgentCard(r, ownerById.get(r.ownerId) ?? fallbackOwner(r.ownerId), aggregates.get(r.id)));
}

// ---------- misc shared lookups ----------

/** Latest run timestamps are on the agent row; this is for the runs tab counts. */
export async function countRuns(db: Db, agentId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(eq(agentRuns.agentId, agentId));
  return Number(row?.n ?? 0);
}

export async function isFollowing(
  db: Db,
  viewerId: string | null | undefined,
  targetType: "user" | "agent",
  targetId: string,
): Promise<boolean> {
  if (!viewerId) return false;
  const [row] = await db
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(
      and(eq(follows.followerId, viewerId), eq(follows.targetType, targetType), eq(follows.targetId, targetId)),
    )
    .limit(1);
  return Boolean(row);
}

/** Agent ids the viewer follows, plus agent ids owned by users the viewer follows. */
export async function followedAgentIds(db: Db, viewerId: string): Promise<{ agentIds: string[]; userIds: string[] }> {
  const rows = await db
    .select({ targetType: follows.targetType, targetId: follows.targetId })
    .from(follows)
    .where(eq(follows.followerId, viewerId));
  const agentIds = rows.filter((r) => r.targetType === "agent").map((r) => r.targetId);
  const userIds = rows.filter((r) => r.targetType === "user").map((r) => r.targetId);
  return { agentIds, userIds };
}
