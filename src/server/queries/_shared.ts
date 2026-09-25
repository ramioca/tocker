import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  agents,
  agentRuns,
  equitySnapshots,
  follows,
  getDb,
  tokens,
  trades,
  users,
  type Db,
} from "@/db";
import type { TradeScoreSnapshot } from "@/db/schema";
import { toNum, toNumOrNull } from "@/lib/money";
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

/** Globally unique agent slug (`agents.slug` is unique) — appends -2, -3, … */
export async function uniqueSlug(name: string, db?: Db): Promise<string> {
  const database = db ?? (await getDb());
  const root = slugify(name);
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
    entryScore: typeof row.scoreSnapshot?.total === "number" ? row.scoreSnapshot.total : null,
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
  };
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
   * What the current book started with: a paper agent's notional, or a live agent's
   * first live mark. All-time PnL is measured against it, here and on the agent page.
   */
  startEquityUsd: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  sparkline: number[];
  tradeCount: number;
  followerCount: number;
  cashUsd: number | null;
}

const EMPTY_AGG: AgentAggregates = {
  equityUsd: null,
  startEquityUsd: null,
  pnlUsd: null,
  pnlPct: null,
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

/** How far back a card's sparkline reaches, in daily closes. */
const SPARKLINE_DAYS = 30;

/**
 * Batch-load the numbers every agent card needs. One query per aggregate rather
 * than one per agent, and never the whole snapshot history: the first and latest
 * snapshot per agent carry the PnL, and the sparkline is daily closes.
 */
export async function loadAgentAggregates(db: Db, agentIds: string[]): Promise<Map<string, AgentAggregates>> {
  const out = new Map<string, AgentAggregates>();
  const ids = [...new Set(agentIds)].filter(Boolean);
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, { ...EMPTY_AGG, sparkline: [] });

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

  const [firstRows, latestRows, closes, tradeCounts, followerCounts] = await Promise.all([
    edge("first"),
    edge("latest"),
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

  const firstByAgent = new Map(firstRows.map((r) => [r.agentId, r]));
  for (const latest of latestRows) {
    const agg = out.get(latest.agentId);
    if (!agg) continue;
    const lastEquity = toNum(latest.equityUsd);
    agg.equityUsd = lastEquity;
    agg.cashUsd = toNum(latest.cashUsd);
    agg.sparkline = (closes.get(latest.agentId) ?? []).map((p) => p.equityUsd);
    // A paper book started at its notional, not at its first mark — that mark can land
    // after the first fill's fee, and then the card, the agent header and the chart
    // (which is drawn against the notional) each printed a different all-time PnL.
    if (latest.mode === "paper") {
      const start = toNum(latest.paperStartingUsd);
      agg.startEquityUsd = start;
      agg.pnlUsd = lastEquity - start;
      agg.pnlPct = start === 0 ? 0 : (agg.pnlUsd / Math.abs(start)) * 100;
      continue;
    }
    // Live: first mark to latest, as `pnlOverWindow(series, "all")` reads it. One
    // snapshot is no window at all.
    const first = firstByAgent.get(latest.agentId);
    agg.startEquityUsd = first ? toNum(first.equityUsd) : null;
    if (!first || first.id === latest.id) {
      agg.pnlUsd = null;
      agg.pnlPct = null;
      continue;
    }
    const start = toNum(first.equityUsd);
    agg.pnlUsd = lastEquity - start;
    agg.pnlPct = start === 0 ? 0 : (agg.pnlUsd / Math.abs(start)) * 100;
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
    chains: (agent.config?.chains ?? []) as Chain[],
    model: agent.config?.llm?.model ?? "",
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

/** Agents → AgentCards, loading owners and aggregates in bulk. */
export async function buildAgentCards(db: Db, rows: AgentRow[]): Promise<AgentCard[]> {
  if (rows.length === 0) return [];
  const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
  const [owners, aggregates] = await Promise.all([
    db
      .select({ id: users.id, handle: users.handle, displayName: users.displayName, avatarUrl: users.avatarUrl })
      .from(users)
      .where(inArray(users.id, ownerIds)),
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
