import "server-only";
/**
 * The admin dashboard's read side — the only place in the app that queries across
 * every user.
 *
 * **Scope.** Every other query module is scoped: by session, by ownership, or by
 * `isPublic`. These are not, and that is the point — an admin needs to know how many
 * agents exist, not how many they own. Access is decided once, at the route, by
 * `requireAdmin()`; nothing in here takes an identifier from the request, so there is
 * no id to tamper with.
 *
 * **What is deliberately absent.** No strategy prompt, no universe rules, no data-source
 * list, no run transcript, no LLM key material — not truncated, not redacted, *absent*.
 * A strategy is its author's IP (SPEC rule 1) and an admin is not an exception to that;
 * an operator's recipe is not a support tool. What an admin gets is metadata and money:
 * names, counts, notionals, timestamps, and the two columns of `config` the product
 * already publishes on every agent card (chains and model). The one shape that crosses
 * into private territory is `agents.config`, and it is never selected here. The requests
 * for an early-access slot are listed too, as the landing form stored them: an address
 * and three answers, the same kind of thing as the users' emails already shown.
 *
 * The pay-per-use card ({@link getAdminInference}) follows the same rule. It reads the
 * ledger of what agents paid to think: amounts, statuses, times, model ids and the
 * wallets that paid. The ledger keeps no prompt and no answer (a hash of the request
 * only), so there is none to show. The one free-text column on it, a provider's words
 * for a failure, is redacted when written and again here, and cut short.
 *
 * **Every number is a fact.** Counts and sums come from SQL; balances come from Privy.
 * There is no "growth %" on this page because nothing in the database supports one
 * honestly, and a made-up trend on an admin dashboard is how an operator talks
 * themselves into a bad decision.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, sql, type SQLWrapper } from "drizzle-orm";
import {
  agentRuns,
  agents,
  auditEvents,
  getDb,
  inferenceBudgetDays,
  inferencePayments,
  platformFees,
  tokens,
  trades,
  users,
  wallets,
  waitlistSignups,
  x402Payments,
  type Db,
} from "@/db";
import { toNum } from "@/lib/money";
import { thinkSource } from "@/lib/agent/inference";
import { isLlmMock } from "@/lib/agent/mock-model";
import { SIMULATED_SETTLEMENT_TX } from "@/lib/platform/fee";
import { redactSecrets } from "@/lib/security/redact";
import { isPaperWallet, readWalletBalances, type AgentWalletRow } from "@/lib/wallets";
import {
  BREAKER_LOOKBACK_MINUTES,
  BREAKER_PAYMENT_STATUSES,
  BREAKER_RULES,
  BREAKER_STOP_REASONS,
  breakerTrips,
  controlStop,
  type BreakerRule,
} from "@/lib/x402/inference-budget";
import { readInferenceControl } from "@/lib/x402/inference-ledger";
import {
  AGENT_DAY_REQUESTS,
  inferenceFlags,
  isInferenceStopReason,
  utcDay,
  type InferenceStage,
  type InferenceStopReason,
  type ThinkSource,
} from "@/lib/x402/inference-types";
import type { AgentCard, Chain } from "@/server/types";
import { buildAgentCards, thinkingPaidUsdSql } from "./_shared";

// ---------------------------------------------------------------- view models

export interface AdminUserTotals {
  total: number;
  new7d: number;
  new30d: number;
}

export interface AdminAgentTotals {
  total: number;
  live: number;
  paper: number;
  active: number;
  paused: number;
  draft: number;
  error: number;
}

export interface AdminWalletTotals {
  /** Server wallets created for agents, one per chain per agent. */
  agentServer: number;
  /** Privy embedded wallets belonging to users, recorded at login. */
  userEmbedded: number;
}

export interface AdminVolumeWindow {
  notionalUsd: number;
  count: number;
  liveNotionalUsd: number;
  liveCount: number;
  paperNotionalUsd: number;
  paperCount: number;
}

export interface AdminVolume {
  allTime: AdminVolumeWindow;
  d30: AdminVolumeWindow;
  d7: AdminVolumeWindow;
}

export interface AdminFeeTotals {
  /** Live fills: charged and not yet swept to a platform wallet. */
  accruedUsd: number;
  /** Live fills: swept into a platform wallet. Real revenue, and only that. */
  collectedUsd: number;
  /**
   * Paper fills' fees. Written settled at accrual with a `"simulated"` hash, so they
   * would otherwise read as collected; no money moved. Shown apart, never summed in.
   */
  paperUsd: number;
}

export interface AdminDataSpend {
  /** Real x402 payments only. Fixtures (`simulated`) cost nothing and are counted apart. */
  usd: number;
  count: number;
  simulatedCount: number;
}

export interface AdminHeadline {
  users: AdminUserTotals;
  agents: AdminAgentTotals;
  wallets: AdminWalletTotals;
  volume: AdminVolume;
  fees: AdminFeeTotals;
  dataSpend: AdminDataSpend;
  waitlistSignups: number;
}

/** One UTC day of a daily series. `day` is `YYYY-MM-DD`. */
export interface AdminDailyPoint {
  day: string;
  value: number;
}

export interface AdminSeries {
  /** Waitlist signups — not accounts, which `AdminUserTotals` counts. */
  signups: AdminDailyPoint[];
  volumeUsd: AdminDailyPoint[];
  /** Fees on live fills only; a paper fill's fee is simulated. */
  feesUsd: AdminDailyPoint[];
}

export interface AdminUserRow {
  id: string;
  handle: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
  agentCount: number;
  liveAgentCount: number;
  lastRunAt: string | null;
}

/** One request for an early-access slot, as the landing page's form stored it. */
export interface AdminSlotRequestRow {
  id: string;
  email: string;
  volume: string;
  chains: string[];
  style: string | null;
  createdAt: string;
  /** A user row carries this address, compared in lower case: the person has signed in. */
  hasAccount: boolean;
}

/** An agent card plus the two admin-only columns: what its wallets hold. */
export interface AdminAgentRow {
  card: AgentCard;
  /** USDC across this agent's server wallets, from the balance snapshot. Null when unread. */
  fundedUsdc: number | null;
  /** Whether a run can start: an LLM key is attached, or the mock model stands in for one. */
  hasLlmKey: boolean;
  /**
   * Where the agent's thinking comes from. A pay-per-use agent has no key on purpose, so
   * `hasLlmKey: false` is not a fault on it; what can stop it is a hold.
   */
  thinkSource: ThinkSource;
  /** Why a pay-per-use agent is not being run, when it is held. Null otherwise. */
  inferenceHold: InferenceStopReason | null;
}

export interface AdminTradeRow {
  id: string;
  createdAt: string;
  agentName: string;
  agentSlug: string;
  ownerHandle: string;
  side: "buy" | "sell";
  chain: Chain;
  tokenSymbol: string;
  tokenAddress: string;
  notionalUsd: number;
  isPaper: boolean;
  /** The platform's flat fee on this fill, when one was recorded. */
  platformFeeUsd: number | null;
}

export interface AdminAuditRow {
  id: string;
  kind: string;
  summary: string;
  handle: string | null;
  agentName: string | null;
  ip: string | null;
  createdAt: string;
}

export interface AdminWalletBalanceRow {
  walletId: string;
  agentId: string;
  agentName: string;
  agentSlug: string;
  chain: Chain;
  address: string;
  usdc: number;
  native: number;
  isPaper: boolean;
}

export interface AdminBalancesSnapshot {
  rows: AdminWalletBalanceRow[];
  /** Agent wallets holding more than zero USDC. */
  fundedCount: number;
  /** USDC across every wallet in `rows`. */
  totalUsdc: number;
  /** When Privy was actually read. The page prints this, never "now". */
  readAt: string;
  /** Agent server wallets on record, before the cap. */
  walletsOnRecord: number;
  /** True when more real wallets exist than were read. */
  capped: boolean;
  /** False in local dev without Privy credentials: every balance below is a zero, not a reading. */
  privyConfigured: boolean;
}

// ------------------------------------------------------------------- windowing

const DAY_MS = 86_400_000;

/** Start of the UTC day `days` back, so a daily series has whole buckets. */
function startOfUtcDay(now: Date, daysBack = 0): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(d.getTime() - daysBack * DAY_MS);
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * A `YYYY-MM-DD` bucket key for a timestamptz column, computed in Postgres so the
 * grouping happens where the rows are. `at time zone 'UTC'` first: the column is
 * timestamptz, and truncating it without pinning the zone buckets by whatever the
 * server's `TimeZone` happens to be.
 */
function dayKeyExpr(column: SQLWrapper) {
  return sql<string>`to_char(date_trunc('day', ${column} at time zone 'UTC'), 'YYYY-MM-DD')`;
}

/** Fill a 30-day (inclusive) series so the chart has one bar per day, zeros included. */
function densify(rows: Array<{ day: string; value: number }>, now: Date, days = 30): AdminDailyPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, r.value]));
  const out: AdminDailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = utcDayKey(startOfUtcDay(now, i));
    out.push({ day, value: byDay.get(day) ?? 0 });
  }
  return out;
}

// -------------------------------------------------------------------- headline

async function userTotals(db: Db, now: Date): Promise<AdminUserTotals> {
  const [[total], [n7], [n30]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(users),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(gte(users.createdAt, startOfUtcDay(now, 6))),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(gte(users.createdAt, startOfUtcDay(now, 29))),
  ]);
  return { total: Number(total?.n ?? 0), new7d: Number(n7?.n ?? 0), new30d: Number(n30?.n ?? 0) };
}

async function agentTotals(db: Db): Promise<AdminAgentTotals> {
  const rows = await db
    .select({ mode: agents.mode, status: agents.status, n: sql<number>`count(*)::int` })
    .from(agents)
    .groupBy(agents.mode, agents.status);

  const out: AdminAgentTotals = { total: 0, live: 0, paper: 0, active: 0, paused: 0, draft: 0, error: 0 };
  for (const row of rows) {
    const n = Number(row.n ?? 0);
    out.total += n;
    if (row.mode === "live") out.live += n;
    else out.paper += n;
    out[row.status] += n;
  }
  return out;
}

async function walletTotals(db: Db): Promise<AdminWalletTotals> {
  const rows = await db
    .select({ kind: wallets.kind, n: sql<number>`count(*)::int` })
    .from(wallets)
    .groupBy(wallets.kind);
  const out: AdminWalletTotals = { agentServer: 0, userEmbedded: 0 };
  for (const row of rows) {
    if (row.kind === "agent_server") out.agentServer = Number(row.n ?? 0);
    else if (row.kind === "user_embedded") out.userEmbedded = Number(row.n ?? 0);
  }
  return out;
}

const EMPTY_WINDOW: AdminVolumeWindow = {
  notionalUsd: 0,
  count: 0,
  liveNotionalUsd: 0,
  liveCount: 0,
  paperNotionalUsd: 0,
  paperCount: 0,
};

/**
 * Filled notional in one window, split live/paper.
 *
 * Only `status = 'filled'` counts. A proposal nobody approved and a trade the risk
 * guard rejected are not volume, and counting them would make the dashboard's headline
 * number the one number on it that is not true.
 */
async function volumeWindow(db: Db, since: Date | null): Promise<AdminVolumeWindow> {
  const where = since
    ? and(eq(trades.status, "filled"), gte(trades.createdAt, since))
    : eq(trades.status, "filled");
  const rows = await db
    .select({
      isPaper: trades.isPaper,
      total: sql<string>`coalesce(sum(${trades.amountUsd}), 0)`,
      n: sql<number>`count(*)::int`,
    })
    .from(trades)
    .where(where)
    .groupBy(trades.isPaper);

  const out: AdminVolumeWindow = { ...EMPTY_WINDOW };
  for (const row of rows) {
    const usd = toNum(row.total);
    const n = Number(row.n ?? 0);
    out.notionalUsd += usd;
    out.count += n;
    if (row.isPaper) {
      out.paperNotionalUsd += usd;
      out.paperCount += n;
    } else {
      out.liveNotionalUsd += usd;
      out.liveCount += n;
    }
  }
  return out;
}

/**
 * A fee on a paper fill: its trade is paper, or (should the trade row be gone) its
 * settlement is the literal simulated hash. Constant SQL, so it is safe in GROUP BY.
 */
const PAPER_FEE = sql<boolean>`(coalesce(${trades.isPaper}, false) or coalesce(${platformFees.txHash} = ${sql.raw(`'${SIMULATED_SETTLEMENT_TX}'`)}, false))`;

async function feeTotals(db: Db): Promise<AdminFeeTotals> {
  const rows = await db
    .select({
      status: platformFees.status,
      paper: PAPER_FEE,
      total: sql<string>`coalesce(sum(${platformFees.amountUsd}), 0)`,
    })
    .from(platformFees)
    .leftJoin(trades, eq(trades.id, platformFees.tradeId))
    .groupBy(platformFees.status, PAPER_FEE);
  const out: AdminFeeTotals = { accruedUsd: 0, collectedUsd: 0, paperUsd: 0 };
  for (const row of rows) {
    const usd = toNum(row.total);
    // A raw boolean column arrives as `true` from one driver and "t" from another.
    if (String(row.paper) === "true" || String(row.paper) === "t") out.paperUsd += usd;
    else if (row.status === "accrued") out.accruedUsd += usd;
    else out.collectedUsd += usd;
  }
  return out;
}

async function dataSpend(db: Db): Promise<AdminDataSpend> {
  const rows = await db
    .select({
      simulated: x402Payments.simulated,
      total: sql<string>`coalesce(sum(${x402Payments.amountUsd}), 0)`,
      n: sql<number>`count(*)::int`,
    })
    .from(x402Payments)
    .groupBy(x402Payments.simulated);
  const out: AdminDataSpend = { usd: 0, count: 0, simulatedCount: 0 };
  for (const row of rows) {
    if (row.simulated) out.simulatedCount = Number(row.n ?? 0);
    else {
      out.usd = toNum(row.total);
      out.count = Number(row.n ?? 0);
    }
  }
  return out;
}

/** Every headline tile, in one round of parallel queries. */
export async function getAdminHeadline(now: Date = new Date()): Promise<AdminHeadline> {
  const db = await getDb();
  const [userRow, agentRow, walletRow, allTime, d30, d7, fees, spend, [waitlist]] = await Promise.all([
    userTotals(db, now),
    agentTotals(db),
    walletTotals(db),
    volumeWindow(db, null),
    // Whole UTC days, today included — the same window the daily bars below draw, so
    // "Volume · 30d" and the 30-day chart are one number, not two.
    volumeWindow(db, startOfUtcDay(now, 29)),
    volumeWindow(db, startOfUtcDay(now, 6)),
    feeTotals(db),
    dataSpend(db),
    db.select({ n: sql<number>`count(*)::int` }).from(waitlistSignups),
  ]);

  return {
    users: userRow,
    agents: agentRow,
    wallets: walletRow,
    volume: { allTime, d30, d7 },
    fees,
    dataSpend: spend,
    waitlistSignups: Number(waitlist?.n ?? 0),
  };
}

// ---------------------------------------------------------------------- series

/** Signups, filled notional and fees charged, per UTC day, over the last 30 days. */
export async function getAdminSeries(now: Date = new Date()): Promise<AdminSeries> {
  const db = await getDb();
  const since = startOfUtcDay(now, 29);

  const signupDay = dayKeyExpr(waitlistSignups.createdAt);
  const tradeDay = dayKeyExpr(trades.createdAt);
  const feeDay = dayKeyExpr(platformFees.createdAt);

  const [signupRows, tradeRows, feeRows] = await Promise.all([
    db
      .select({ day: signupDay, n: sql<number>`count(*)::int` })
      .from(waitlistSignups)
      .where(gte(waitlistSignups.createdAt, since))
      .groupBy(signupDay),
    db
      .select({ day: tradeDay, total: sql<string>`coalesce(sum(${trades.amountUsd}), 0)` })
      .from(trades)
      .where(and(eq(trades.status, "filled"), gte(trades.createdAt, since)))
      .groupBy(tradeDay),
    // Live fees only: a paper fill's fee is simulated, and charting it as revenue is
    // the same mistake the headline tile no longer makes.
    db
      .select({ day: feeDay, total: sql<string>`coalesce(sum(${platformFees.amountUsd}), 0)` })
      .from(platformFees)
      .leftJoin(trades, eq(trades.id, platformFees.tradeId))
      .where(and(gte(platformFees.createdAt, since), sql`not ${PAPER_FEE}`))
      .groupBy(feeDay),
  ]);

  return {
    signups: densify(
      signupRows.map((r) => ({ day: r.day, value: Number(r.n ?? 0) })),
      now,
    ),
    volumeUsd: densify(
      tradeRows.map((r) => ({ day: r.day, value: toNum(r.total) })),
      now,
    ),
    feesUsd: densify(
      feeRows.map((r) => ({ day: r.day, value: toNum(r.total) })),
      now,
    ),
  };
}

// ---------------------------------------------------------------------- tables

/** Anything unknown → a stable ISO string or null. `max()` comes back as a Date on one
 *  driver and a string on another, and neither is worth branching on at every call. */
function isoOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const ADMIN_TABLE_LIMIT = 100;
export const ADMIN_FEED_LIMIT = 50;

/** Newest users first, with how many agents they run and when one last ran. */
export async function listAdminUsers(limit = ADMIN_TABLE_LIMIT): Promise<AdminUserRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      email: users.email,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const counts = await db
    .select({
      ownerId: agents.ownerId,
      total: sql<number>`count(*)::int`,
      live: sql<number>`coalesce(sum(case when ${agents.mode} = 'live' then 1 else 0 end), 0)::int`,
      lastRunAt: sql<unknown>`max(${agents.lastRunAt})`,
    })
    .from(agents)
    .where(inArray(agents.ownerId, ids))
    .groupBy(agents.ownerId);

  const byOwner = new Map(counts.map((c) => [c.ownerId, c]));
  return rows.map((row) => {
    const agg = byOwner.get(row.id);
    return {
      id: row.id,
      handle: row.handle,
      displayName: row.displayName,
      email: row.email,
      createdAt: row.createdAt.toISOString(),
      agentCount: Number(agg?.total ?? 0),
      liveAgentCount: Number(agg?.live ?? 0),
      lastRunAt: isoOf(agg?.lastRunAt),
    };
  });
}

/**
 * Who asked for an early-access slot, newest first: the list an admin works through to
 * let people in. It is the durable record. The request mail is sent after the response
 * and can fail without anyone noticing; this row was written before the form answered.
 *
 * `hasAccount` says whether somebody has since signed in with that address, so a request
 * already dealt with is told apart from one still waiting. The match is on the lower-cased
 * email, which is how the form's own duplicate check compares them.
 */
export async function listAdminSlotRequests(limit = ADMIN_TABLE_LIMIT): Promise<AdminSlotRequestRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: waitlistSignups.id,
      email: waitlistSignups.email,
      volume: waitlistSignups.volume,
      chains: waitlistSignups.chains,
      style: waitlistSignups.style,
      createdAt: waitlistSignups.createdAt,
    })
    .from(waitlistSignups)
    // The id only settles the order of two requests stored in the same instant.
    .orderBy(desc(waitlistSignups.createdAt), desc(waitlistSignups.id))
    .limit(Math.min(Math.max(limit, 1), 500));
  if (rows.length === 0) return [];

  const emails = [...new Set(rows.map((r) => r.email.toLowerCase()))];
  const userEmail = sql<string>`lower(${users.email})`;
  const matched = await db.select({ email: userEmail }).from(users).where(inArray(userEmail, emails));
  const withAccount = new Set(matched.map((m) => m.email));

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    volume: row.volume,
    chains: row.chains,
    style: row.style,
    createdAt: row.createdAt.toISOString(),
    hasAccount: withAccount.has(row.email.toLowerCase()),
  }));
}

/**
 * Every agent, newest first, as the same public `AgentCard` the rest of the app renders
 * — so this table cannot accidentally grow a strategy column: the shape has no field
 * for one.
 */
export async function listAdminAgents(
  balances: AdminBalancesSnapshot | null,
  limit = ADMIN_TABLE_LIMIT,
): Promise<AdminAgentRow[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(agents)
    .orderBy(desc(agents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  const cards = await buildAgentCards(db, rows);

  const usdcByAgent = new Map<string, number>();
  for (const row of balances?.rows ?? []) {
    usdcByAgent.set(row.agentId, (usdcByAgent.get(row.agentId) ?? 0) + row.usdc);
  }

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const mock = isLlmMock();

  return cards.map((card) => {
    const row = rowById.get(card.id);
    // The mode is the config's own word (one predicate, everywhere), read here and not
    // passed on: nothing else of `config` leaves this function.
    const source = thinkSource(row?.config);
    const hold = row?.inferenceHold;
    return {
      card,
      fundedUsdc: balances === null ? null : (usdcByAgent.get(card.id) ?? 0),
      hasLlmKey: row?.llmKeyId != null || mock,
      thinkSource: source,
      inferenceHold: source === "usdc" && isInferenceStopReason(hold) ? hold : null,
    };
  });
}

/** The last fills across the whole platform, with the fee each one was charged. */
export async function listAdminTrades(limit = ADMIN_FEED_LIMIT): Promise<AdminTradeRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: trades.id,
      createdAt: trades.createdAt,
      side: trades.side,
      chain: trades.chain,
      amountUsd: trades.amountUsd,
      isPaper: trades.isPaper,
      agentName: agents.name,
      agentSlug: agents.slug,
      ownerHandle: users.handle,
      tokenSymbol: tokens.symbol,
      tokenAddress: tokens.address,
      platformFeeUsd: platformFees.amountUsd,
    })
    .from(trades)
    .innerJoin(agents, eq(trades.agentId, agents.id))
    .innerJoin(users, eq(agents.ownerId, users.id))
    .innerJoin(tokens, eq(trades.tokenId, tokens.id))
    .leftJoin(platformFees, eq(platformFees.tradeId, trades.id))
    .where(eq(trades.status, "filled"))
    .orderBy(desc(trades.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    agentName: row.agentName,
    agentSlug: row.agentSlug,
    ownerHandle: row.ownerHandle,
    side: row.side,
    chain: row.chain as Chain,
    tokenSymbol: row.tokenSymbol,
    tokenAddress: row.tokenAddress,
    notionalUsd: toNum(row.amountUsd),
    isPaper: row.isPaper,
    platformFeeUsd: row.platformFeeUsd === null ? null : toNum(row.platformFeeUsd),
  }));
}

/**
 * The audit trail across every user — the one read in the app that is not user-scoped.
 * `metadata` is not selected: it is written by a dozen call sites and, while nothing is
 * supposed to put a secret in it, an admin table is the wrong place to find out.
 */
export async function listAdminAuditEvents(limit = ADMIN_FEED_LIMIT): Promise<AdminAuditRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: auditEvents.id,
      kind: auditEvents.kind,
      summary: auditEvents.summary,
      agentName: auditEvents.agentName,
      ip: auditEvents.ip,
      createdAt: auditEvents.createdAt,
      handle: users.handle,
    })
    .from(auditEvents)
    .leftJoin(users, eq(auditEvents.userId, users.id))
    .orderBy(desc(auditEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    summary: row.summary,
    handle: row.handle ?? null,
    agentName: row.agentName,
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
  }));
}

// -------------------------------------------------------------------- balances

/**
 * How many agent wallets get a live Privy read, and how long a reading stays good.
 *
 * `readWalletBalances` costs two Privy calls per wallet (one per asset — the SDK
 * mis-serialises an asset array, see the note there), so a hundred agents on two chains
 * is four hundred calls. Three things keep that from being the page's cost:
 *
 *  - paper wallets resolve to zeros with no call at all;
 *  - real wallets are capped, ordered by recent activity, so the cap drops the dormant
 *    ones rather than an arbitrary slice;
 *  - the whole snapshot is cached in-process, and the page prints the time it was taken
 *    with a refresh button next to it, rather than implying it is live.
 */
export const ADMIN_BALANCE_WALLET_CAP = 200;
export const ADMIN_BALANCE_TTL_MS = 60_000;
const ADMIN_BALANCE_CONCURRENCY = 4;

interface CachedSnapshot {
  snapshot: AdminBalancesSnapshot;
  expiresAt: number;
}

/**
 * Module-level, so it is per server instance rather than per request — which is the
 * whole point (a page render must not re-read Privy for every component that wants a
 * number). Serverless means several instances may hold different snapshots; each one
 * shows its own "as of", so that is visible rather than silently wrong.
 */
let cached: CachedSnapshot | null = null;
let inflight: Promise<AdminBalancesSnapshot> | null = null;

/** Drop the cached reading. The refresh button's server action calls this. */
export function resetAdminBalanceCache(): void {
  cached = null;
  inflight = null;
}

/** Run `task` over `items`, at most `limit` at a time, results in input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

type BalanceReader = (wallet: AgentWalletRow) => Promise<{
  balances: Array<{ asset: string; amount: number }>;
}>;

function sumAsset(balances: Array<{ asset: string; amount: number }>, asset: string): number {
  return balances
    .filter((b) => b.asset.toLowerCase() === asset)
    .reduce((sum, b) => sum + (Number.isFinite(b.amount) ? b.amount : 0), 0);
}

async function readSnapshot(now: Date, read: BalanceReader): Promise<AdminBalancesSnapshot> {
  const db = await getDb();
  const [{ n: onRecord } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(wallets)
    .where(eq(wallets.kind, "agent_server"));

  // Ordered by recent activity: a wallet whose agent ran an hour ago matters more than
  // one whose agent has never run, so the cap removes the right end of the list.
  const rows = await db
    .select({
      walletId: wallets.id,
      chain: wallets.chain,
      address: wallets.address,
      agentId: agents.id,
      agentName: agents.name,
      agentSlug: agents.slug,
    })
    .from(wallets)
    .innerJoin(agents, eq(wallets.agentId, agents.id))
    .where(and(eq(wallets.kind, "agent_server"), isNotNull(wallets.agentId)))
    .orderBy(
      sql`coalesce(${agents.lastRunAt}, ${agents.updatedAt}, ${agents.createdAt}) desc`,
      desc(wallets.id),
    );

  const paperRows = rows.filter((r) => isPaperWallet(r.walletId));
  const realRows = rows.filter((r) => !isPaperWallet(r.walletId)).slice(0, ADMIN_BALANCE_WALLET_CAP);
  const realOnRecord = rows.length - paperRows.length;

  const readings = await mapWithConcurrency(realRows, ADMIN_BALANCE_CONCURRENCY, (row) =>
    read({ id: row.walletId, chain: row.chain as Chain, address: row.address }),
  );

  const out: AdminWalletBalanceRow[] = [];
  // Paper first would bury the wallets that hold money; real first, in activity order.
  realRows.forEach((row, i) => {
    const balances = readings[i]?.balances ?? [];
    out.push({
      walletId: row.walletId,
      agentId: row.agentId,
      agentName: row.agentName,
      agentSlug: row.agentSlug,
      chain: row.chain as Chain,
      address: row.address,
      usdc: sumAsset(balances, "usdc"),
      native: sumAsset(balances, row.chain === "base" ? "eth" : "sol"),
      isPaper: false,
    });
  });
  for (const row of paperRows) {
    // A paper wallet holds nothing, by construction. Reading it would be two Privy
    // calls to be told about an address that does not exist on any chain.
    out.push({
      walletId: row.walletId,
      agentId: row.agentId,
      agentName: row.agentName,
      agentSlug: row.agentSlug,
      chain: row.chain as Chain,
      address: row.address,
      usdc: 0,
      native: 0,
      isPaper: true,
    });
  }

  const { isPrivyConfigured } = await import("@/lib/privy");
  return {
    rows: out,
    fundedCount: out.filter((r) => r.usdc > 0).length,
    totalUsdc: out.reduce((sum, r) => sum + r.usdc, 0),
    readAt: now.toISOString(),
    walletsOnRecord: Number(onRecord ?? 0),
    capped: realOnRecord > realRows.length,
    privyConfigured: isPrivyConfigured(),
  };
}

/**
 * The balance snapshot, from the in-process cache when it is under a minute old.
 *
 * `read` is a test seam: without Privy credentials every real reading is a zero, which
 * would make a test about funded wallets pass for the wrong reason. Passing a reader
 * also bypasses the cache — a test must never be served another test's snapshot.
 */
export async function getAdminBalances(opts?: {
  force?: boolean;
  now?: Date;
  read?: BalanceReader;
}): Promise<AdminBalancesSnapshot> {
  const now = opts?.now ?? new Date();
  if (opts?.read) return readSnapshot(now, opts.read);

  if (!opts?.force && cached && cached.expiresAt > now.getTime()) return cached.snapshot;
  if (!opts?.force && inflight) return inflight;

  const promise = readSnapshot(now, readWalletBalances)
    .then((snapshot) => {
      cached = { snapshot, expiresAt: Date.now() + ADMIN_BALANCE_TTL_MS };
      return snapshot;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = promise;
  return promise;
}

// --------------------------------------------------------- pay-per-use thinking

/** How many open rows the card lists. The counts beside the list are of all of them. */
export const ADMIN_INFERENCE_OPEN_LIMIT = 50;
/** How many agent wallets the signature test offers. */
export const ADMIN_INFERENCE_WALLET_LIMIT = 200;
/** A provider's words for a failure are shown at most this long, after redaction. */
const ADMIN_DETAIL_MAX = 240;

/** The ledger statuses that are not final: nothing signed yet, in flight, or awaiting the chain. */
export const INFERENCE_OPEN_STATUSES = ["reserved", "signed", "unconfirmed"] as const;
export type InferenceOpenStatus = (typeof INFERENCE_OPEN_STATUSES)[number];

export interface AdminInferenceOpenRow {
  id: string;
  status: InferenceOpenStatus;
  /** Null when the agent or the account has since been deleted: the ledger outlives both. */
  agentName: string | null;
  agentSlug: string | null;
  ownerHandle: string | null;
  model: string;
  quotedUsd: number;
  createdAt: string;
  signedAt: string | null;
  httpStatus: number | null;
  /** Why it is where it is, redacted and cut short. Null when nothing was recorded. */
  detail: string | null;
}

export interface AdminInferenceWallet {
  walletId: string;
  address: string;
  agentName: string;
  agentSlug: string;
  ownerHandle: string;
  /** The agent is set to pay for its own thinking. Listed first: these are the wallets that will sign. */
  payPerUse: boolean;
}

export interface AdminInference {
  /** The switches as this server reads its environment. A deploy changes them, nothing on this page does. */
  switches: {
    stage: InferenceStage;
    /** How many user ids `INFERENCE_USDC_USER_IDS` names. Admins are admitted as well at stage `owner`. */
    invitedUsers: number;
    stepUsd: number;
    ownerDayUsd: number;
    platformDayUsd: number;
    agentDayRequests: number;
    /** A payment is never signed without our own RPC to verify and reconcile against. */
    rpcConfigured: boolean;
    /** `X402_MOCK=1`: nothing is paid and every row is `simulated`. */
    mock: boolean;
  };
  /** The UTC day the counters below belong to. */
  day: string;
  /** What the day counters hold: reserved and spent, against the caps above. */
  today: {
    platformUsd: number;
    platformRequests: number;
    /** Accounts and agents with a counter row today. */
    owners: number;
    agents: number;
    /** The account that has used most of its own daily limit, as an amount. */
    largestOwnerUsd: number;
    manualRuns: number;
    /** Today's ledger rows by status. `usd` is the settled amount, else the quote. */
    byStatus: Array<{ status: string; count: number; usd: number }>;
  };
  /** Rows not yet final, oldest first, and how many there are of each in all. */
  open: AdminInferenceOpenRow[];
  openCounts: Record<InferenceOpenStatus, number>;
  control: {
    halted: boolean;
    haltReason: string | null;
    haltClearedAt: string | null;
    pausedUntil: string | null;
    pauseReason: string | null;
    updatedBy: string | null;
    updatedAt: string | null;
    /** What the switches do to a payment asked for right now. */
    stops: "halted" | "paused" | null;
  };
  /** What the breakers are looking at, per rule: how much of it there is, and what trips it. */
  breakers: Array<{ rule: BreakerRule; count: number; agents: number | null; threshold: number; windowMinutes: number; tripped: boolean }>;
  /** Agents not being run, by the reason they are held for. */
  holds: Array<{ reason: string; agents: number }>;
  /** Real Solana agent wallets, for the signature test. */
  wallets: AdminInferenceWallet[];
}

/** Outside text for an admin's eyes: redacted again on the way out, and bounded. */
function shown(text: string | null | undefined, max = ADMIN_DETAIL_MAX): string | null {
  if (!text) return null;
  const clean = redactSecrets(text).trim();
  return clean === "" ? null : clean.slice(0, max);
}

/**
 * Everything the pay-per-use card shows, in one round of reads.
 *
 * Read-only. The halt and pause switches come from `readInferenceControl` (the ledger's
 * own reader, which is also what `reserve` trusts), so the card cannot disagree with
 * what the next payment will be told. The breaker figures are the same evidence
 * `applyInferenceBreakers` reads, and `tripped` is the ledger's own rule
 * (`breakerTrips`), not a second opinion written here.
 */
export async function getAdminInference(now: Date = new Date()): Promise<AdminInference> {
  const db = await getDb();
  const flags = inferenceFlags();
  const day = utcDay(now);
  const lookback = new Date(now.getTime() - (BREAKER_LOOKBACK_MINUTES + 10) * 60_000);
  const source = sql<string | null>`${agents.config} #>> '{llm,source}'`;

  const [control, counters, byStatus, openRows, openCounts, badPayments, badStops, holds, walletRows] = await Promise.all([
    readInferenceControl(),

    db
      .select({
        scope: inferenceBudgetDays.scope,
        rows: sql<number>`count(*)::int`,
        usd: sql<string>`coalesce(sum(${inferenceBudgetDays.usd}), 0)`,
        largestUsd: sql<string>`coalesce(max(${inferenceBudgetDays.usd}), 0)`,
        requests: sql<number>`coalesce(sum(${inferenceBudgetDays.requests}), 0)::int`,
        manualRuns: sql<number>`coalesce(sum(${inferenceBudgetDays.manualRuns}), 0)::int`,
      })
      .from(inferenceBudgetDays)
      .where(eq(inferenceBudgetDays.day, day))
      .groupBy(inferenceBudgetDays.scope),

    db
      .select({
        status: inferencePayments.status,
        count: sql<number>`count(*)::int`,
        usd: sql<string>`coalesce(sum(${thinkingPaidUsdSql()}), 0)`,
      })
      .from(inferencePayments)
      .where(eq(inferencePayments.budgetDay, day))
      .groupBy(inferencePayments.status),

    // Oldest first: the row that has been open longest is the one to look at.
    db
      .select({
        id: inferencePayments.id,
        status: inferencePayments.status,
        model: inferencePayments.model,
        quotedUsd: inferencePayments.quotedUsd,
        createdAt: inferencePayments.createdAt,
        signedAt: inferencePayments.signedAt,
        httpStatus: inferencePayments.httpStatus,
        detail: inferencePayments.detail,
        agentName: agents.name,
        agentSlug: agents.slug,
        ownerHandle: users.handle,
      })
      .from(inferencePayments)
      .leftJoin(agents, eq(agents.id, inferencePayments.agentId))
      .leftJoin(users, eq(users.id, inferencePayments.ownerId))
      .where(inArray(inferencePayments.status, [...INFERENCE_OPEN_STATUSES]))
      .orderBy(asc(inferencePayments.createdAt), asc(inferencePayments.id))
      .limit(ADMIN_INFERENCE_OPEN_LIMIT),

    db
      .select({ status: inferencePayments.status, count: sql<number>`count(*)::int` })
      .from(inferencePayments)
      .where(inArray(inferencePayments.status, [...INFERENCE_OPEN_STATUSES]))
      .groupBy(inferencePayments.status),

    db
      .select({
        status: inferencePayments.status,
        agentId: inferencePayments.agentId,
        signedAt: inferencePayments.signedAt,
        createdAt: inferencePayments.createdAt,
      })
      .from(inferencePayments)
      .where(and(inArray(inferencePayments.status, [...BREAKER_PAYMENT_STATUSES]), gte(inferencePayments.createdAt, lookback)))
      .limit(500),

    db
      .select({ reason: agentRuns.stopReason, finishedAt: agentRuns.finishedAt, createdAt: agentRuns.createdAt })
      .from(agentRuns)
      .where(and(inArray(agentRuns.stopReason, [...BREAKER_STOP_REASONS]), gte(agentRuns.createdAt, lookback)))
      .limit(500),

    db
      .select({ reason: agents.inferenceHold, n: sql<number>`count(*)::int` })
      .from(agents)
      .where(isNotNull(agents.inferenceHold))
      .groupBy(agents.inferenceHold),

    // The one word of `config` this page reads, picked out in SQL so the rest of the
    // config (the strategy) is never selected at all.
    db
      .select({
        walletId: wallets.id,
        address: wallets.address,
        agentName: agents.name,
        agentSlug: agents.slug,
        ownerHandle: users.handle,
        source,
      })
      .from(wallets)
      .innerJoin(agents, eq(wallets.agentId, agents.id))
      .innerJoin(users, eq(agents.ownerId, users.id))
      .where(and(eq(wallets.kind, "agent_server"), eq(wallets.chain, "solana")))
      .orderBy(
        sql`case when ${source} = 'usdc' then 0 else 1 end`,
        sql`coalesce(${agents.lastRunAt}, ${agents.updatedAt}, ${agents.createdAt}) desc`,
        desc(wallets.id),
      )
      .limit(ADMIN_INFERENCE_WALLET_LIMIT),
  ]);

  const counter = (scope: string) => counters.find((row) => row.scope === scope);
  const platform = counter("platform");
  const owner = counter("owner");

  // The same two lists, shaped as the breaker rules take them.
  const evidence = {
    payments: badPayments.map((row) => ({ status: row.status, agentId: row.agentId, at: row.signedAt ?? row.createdAt })),
    stops: badStops.map((row) => ({ reason: row.reason, at: row.finishedAt ?? row.createdAt })),
  };
  const tripped = new Set(breakerTrips(evidence, now).map((trip) => trip.rule));
  const within = (at: Date, minutes: number) => now.getTime() - at.getTime() < minutes * 60_000;
  const stopsOf = (reasons: readonly string[], minutes: number) =>
    evidence.stops.filter((stop) => stop.reason !== null && reasons.includes(stop.reason) && within(stop.at, minutes)).length;
  const unanswered = evidence.payments.filter((payment) => within(payment.at, BREAKER_RULES.unanswered.windowMinutes));

  const counts: Record<InferenceOpenStatus, number> = { reserved: 0, signed: 0, unconfirmed: 0 };
  for (const row of openCounts) {
    if ((INFERENCE_OPEN_STATUSES as readonly string[]).includes(row.status)) counts[row.status as InferenceOpenStatus] = Number(row.count ?? 0);
  }

  return {
    switches: {
      stage: flags.stage,
      invitedUsers: flags.userIds.length,
      stepUsd: flags.hardStepUsd,
      ownerDayUsd: flags.ownerDayUsd,
      platformDayUsd: flags.platformDayUsd,
      agentDayRequests: AGENT_DAY_REQUESTS,
      rpcConfigured: Boolean(process.env.SOLANA_RPC_URL?.trim()),
      mock: process.env.X402_MOCK === "1",
    },
    day,
    today: {
      // The ledger keeps one platform row a day. Summed all the same, so a stray second
      // row could only make the figure larger, never hide spend.
      platformUsd: toNum(platform?.usd),
      platformRequests: Number(platform?.requests ?? 0),
      owners: Number(owner?.rows ?? 0),
      agents: Number(counter("agent")?.rows ?? 0),
      largestOwnerUsd: toNum(owner?.largestUsd),
      manualRuns: Number(owner?.manualRuns ?? 0),
      byStatus: byStatus
        .map((row) => ({ status: row.status, count: Number(row.count ?? 0), usd: toNum(row.usd) }))
        .sort((a, b) => a.status.localeCompare(b.status)),
    },
    open: openRows.map((row) => ({
      id: row.id,
      status: row.status as InferenceOpenStatus,
      agentName: row.agentName ?? null,
      agentSlug: row.agentSlug ?? null,
      ownerHandle: row.ownerHandle ?? null,
      model: shown(row.model, 100) ?? "",
      quotedUsd: toNum(row.quotedUsd),
      createdAt: row.createdAt.toISOString(),
      signedAt: row.signedAt ? row.signedAt.toISOString() : null,
      httpStatus: row.httpStatus ?? null,
      detail: shown(row.detail),
    })),
    openCounts: counts,
    control: {
      halted: control.halted,
      haltReason: shown(control.haltReason),
      haltClearedAt: control.haltClearedAt ? control.haltClearedAt.toISOString() : null,
      pausedUntil: control.pausedUntil ? control.pausedUntil.toISOString() : null,
      pauseReason: shown(control.pauseReason),
      updatedBy: shown(control.updatedBy, 80),
      updatedAt: control.updatedAt ? control.updatedAt.toISOString() : null,
      stops: controlStop(control, now),
    },
    breakers: [
      {
        rule: "unanswered",
        count: unanswered.length,
        agents: new Set(unanswered.map((payment) => payment.agentId ?? "")).size,
        threshold: BREAKER_RULES.unanswered.rows,
        windowMinutes: BREAKER_RULES.unanswered.windowMinutes,
        tripped: tripped.has("unanswered"),
      },
      {
        rule: "gateway",
        count: stopsOf(["quote_failed", "gateway_error"], BREAKER_RULES.gateway.windowMinutes),
        agents: null,
        threshold: BREAKER_RULES.gateway.failures,
        windowMinutes: BREAKER_RULES.gateway.windowMinutes,
        tripped: tripped.has("gateway"),
      },
      {
        rule: "signature",
        count: stopsOf(["signature_failed"], BREAKER_RULES.signature.windowMinutes),
        agents: null,
        threshold: BREAKER_RULES.signature.failures,
        windowMinutes: BREAKER_RULES.signature.windowMinutes,
        tripped: tripped.has("signature"),
      },
      {
        rule: "pin_mismatch",
        count: stopsOf(["pin_mismatch"], BREAKER_RULES.pin_mismatch.windowMinutes),
        agents: null,
        threshold: BREAKER_RULES.pin_mismatch.failures,
        windowMinutes: BREAKER_RULES.pin_mismatch.windowMinutes,
        tripped: tripped.has("pin_mismatch"),
      },
    ],
    holds: holds
      .map((row) => ({ reason: shown(row.reason, 40) ?? "", agents: Number(row.n ?? 0) }))
      .filter((row) => row.reason !== "")
      .sort((a, b) => b.agents - a.agents || a.reason.localeCompare(b.reason)),
    // A paper placeholder has no key behind it and can sign nothing.
    wallets: walletRows
      .filter((row) => !isPaperWallet(row.walletId))
      .map((row) => ({
        walletId: row.walletId,
        address: row.address,
        agentName: row.agentName,
        agentSlug: row.agentSlug,
        ownerHandle: row.ownerHandle,
        payPerUse: row.source === "usdc",
      })),
  };
}

/**
 * The one real Solana agent wallet with this id, or null. What the signature test signs
 * with is decided here, from the database: the action passes an id and never an address,
 * so a caller cannot point the test at a wallet that is not an agent's.
 */
export async function findAgentSolanaWallet(walletId: string): Promise<{ walletId: string; address: string; agentName: string } | null> {
  if (typeof walletId !== "string" || walletId === "" || walletId.length > 200 || isPaperWallet(walletId)) return null;
  const db = await getDb();
  const [row] = await db
    .select({ walletId: wallets.id, address: wallets.address, agentName: agents.name })
    .from(wallets)
    .innerJoin(agents, eq(wallets.agentId, agents.id))
    .where(and(eq(wallets.id, walletId), eq(wallets.kind, "agent_server"), eq(wallets.chain, "solana")))
    .limit(1);
  return row ?? null;
}
