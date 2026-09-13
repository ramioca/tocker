import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
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
import { pnlOverWindow } from "@/lib/pnl";
import type { AgentCard, Chain, ScoreComponents, TokenRef, TradeRow, TradeScore, UserCard } from "@/server/types";

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
    // sentiment is explicitly nullable: null means "the agent did not pay for it".
    sentiment: typeof raw.sentiment === "number" ? raw.sentiment : null,
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

export function toTradeRow(row: typeof trades.$inferSelect, token: TokenRef): TradeRow {
  return {
    id: row.id,
    agentId: row.agentId,
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
    rationale: row.rationale,
    score: toTradeScore(row.scoreSnapshot),
    error: row.error,
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
  pnlUsd: number | null;
  pnlPct: number | null;
  sparkline: number[];
  tradeCount: number;
  followerCount: number;
  cashUsd: number | null;
}

const EMPTY_AGG: AgentAggregates = {
  equityUsd: null,
  pnlUsd: null,
  pnlPct: null,
  sparkline: [],
  tradeCount: 0,
  followerCount: 0,
  cashUsd: null,
};

/**
 * Batch-load the numbers every agent card needs. One query per aggregate rather
 * than one per agent.
 */
export async function loadAgentAggregates(db: Db, agentIds: string[]): Promise<Map<string, AgentAggregates>> {
  const out = new Map<string, AgentAggregates>();
  const ids = [...new Set(agentIds)].filter(Boolean);
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, { ...EMPTY_AGG, sparkline: [] });

  const [snapshots, tradeCounts, followerCounts] = await Promise.all([
    db
      .select({
        agentId: equitySnapshots.agentId,
        equityUsd: equitySnapshots.equityUsd,
        cashUsd: equitySnapshots.cashUsd,
        at: equitySnapshots.at,
      })
      .from(equitySnapshots)
      .where(inArray(equitySnapshots.agentId, ids))
      .orderBy(equitySnapshots.agentId, equitySnapshots.at),
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

  const byAgent = new Map<string, Array<{ at: Date; equityUsd: number; cashUsd: number }>>();
  for (const s of snapshots) {
    const list = byAgent.get(s.agentId) ?? [];
    list.push({ at: s.at, equityUsd: toNum(s.equityUsd), cashUsd: toNum(s.cashUsd) });
    byAgent.set(s.agentId, list);
  }

  for (const [agentId, series] of byAgent) {
    const agg = out.get(agentId);
    if (!agg) continue;
    const last = series.at(-1);
    agg.equityUsd = last ? last.equityUsd : null;
    agg.cashUsd = last ? last.cashUsd : null;
    agg.sparkline = series.slice(-30).map((p) => p.equityUsd);
    const window = pnlOverWindow(series, "all");
    agg.pnlUsd = window ? window.pnlUsd : null;
    agg.pnlPct = window ? window.pnlPct : null;
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
