import "server-only";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { agents, comments, getDb, likes, posts, trades, users, type Db } from "@/db";
import type { CommentRow, FeedItem, Page } from "@/server/types";
import {
  decodeCursor,
  encodeCursor,
  followedAgentIds,
  loadAgentAggregates,
  loadTokens,
  pageSize,
  toTradeRow,
  toUserCard,
} from "./_shared";

type PostJoin = {
  post: typeof posts.$inferSelect;
  author: { id: string; handle: string; displayName: string | null; avatarUrl: string | null };
  agent: typeof agents.$inferSelect | null;
  trade: typeof trades.$inferSelect | null;
};

function baseQuery(db: Db) {
  return db
    .select({
      post: posts,
      author: { id: users.id, handle: users.handle, displayName: users.displayName, avatarUrl: users.avatarUrl },
      agent: agents,
      trade: trades,
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .leftJoin(agents, eq(agents.id, posts.agentId))
    .leftJoin(trades, eq(trades.id, posts.tradeId));
}

/** Posts about private agents never surface publicly. */
const visible = or(isNull(posts.agentId), eq(agents.isPublic, true));

async function hydrate(db: Db, rows: PostJoin[], viewerId?: string | null): Promise<FeedItem[]> {
  if (rows.length === 0) return [];
  const tokenIds = rows.flatMap((r) => (r.trade ? [r.trade.tokenId] : []));
  const agentIds = rows.flatMap((r) => (r.agent ? [r.agent.id] : []));

  const [tokenMap, aggregates, likedRows] = await Promise.all([
    loadTokens(db, tokenIds),
    loadAgentAggregates(db, agentIds),
    viewerId
      ? db
          .select({ postId: likes.postId })
          .from(likes)
          .where(
            and(
              eq(likes.userId, viewerId),
              inArray(
                likes.postId,
                rows.map((r) => r.post.id),
              ),
            ),
          )
      : Promise.resolve([] as Array<{ postId: string }>),
  ]);
  const liked = new Set(likedRows.map((l) => l.postId));

  return rows.map((r) => {
    const token = r.trade ? tokenMap.get(r.trade.tokenId) : undefined;
    const agg = r.agent ? aggregates.get(r.agent.id) : undefined;
    return {
      id: r.post.id,
      kind: r.post.kind,
      body: r.post.body,
      createdAt: r.post.createdAt.toISOString(),
      author: toUserCard(r.author),
      agent: r.agent
        ? {
            id: r.agent.id,
            slug: r.agent.slug,
            name: r.agent.name,
            avatarSeed: r.agent.avatarSeed,
            mode: r.agent.mode,
            pnlPct: agg?.pnlPct ?? null,
          }
        : null,
      trade: r.trade && token ? toTradeRow(r.trade, token) : null,
      likeCount: r.post.likeCount,
      commentCount: r.post.commentCount,
      likedByViewer: liked.has(r.post.id),
    };
  });
}

export async function getFeed(opts: {
  scope: "global" | "following";
  cursor?: string | null;
  limit?: number;
  viewerId?: string | null;
}): Promise<Page<FeedItem>> {
  const db = await getDb();
  const limit = pageSize(opts.limit);
  const cursor = decodeCursor(opts.cursor);

  const conditions = [visible];
  if (cursor) {
    conditions.push(
      or(lt(posts.createdAt, cursor.at), and(eq(posts.createdAt, cursor.at), lt(posts.id, cursor.id))),
    );
  }

  if (opts.scope === "following") {
    if (!opts.viewerId) return { items: [], nextCursor: null };
    const { agentIds, userIds } = await followedAgentIds(db, opts.viewerId);
    if (agentIds.length === 0 && userIds.length === 0) return { items: [], nextCursor: null };
    const followClauses = [];
    if (agentIds.length) followClauses.push(inArray(posts.agentId, agentIds));
    if (userIds.length) followClauses.push(inArray(posts.authorId, userIds));
    conditions.push(followClauses.length === 1 ? followClauses[0] : or(...followClauses));
  }

  const rows = await baseQuery(db)
    .where(and(...conditions))
    .orderBy(sql`${posts.createdAt} desc`, sql`${posts.id} desc`)
    .limit(limit + 1);

  const page = rows.slice(0, limit) as PostJoin[];
  const last = page.at(-1);
  return {
    items: await hydrate(db, page, opts.viewerId),
    nextCursor: rows.length > limit && last ? encodeCursor(last.post.createdAt, last.post.id) : null,
  };
}

export async function getPost(postId: string, viewerId?: string | null): Promise<FeedItem | null> {
  const db = await getDb();
  const rows = await baseQuery(db).where(eq(posts.id, postId)).limit(1);
  const row = rows[0] as PostJoin | undefined;
  if (!row) return null;
  if (row.agent && !row.agent.isPublic && row.agent.ownerId !== viewerId) return null;
  const [item] = await hydrate(db, [row], viewerId);
  return item ?? null;
}

export async function getComments(postId: string, cursor?: string | null): Promise<Page<CommentRow>> {
  const db = await getDb();
  const limit = 30;
  const c = decodeCursor(cursor);
  const rows = await db
    .select({
      comment: comments,
      author: { id: users.id, handle: users.handle, displayName: users.displayName, avatarUrl: users.avatarUrl },
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(
      c
        ? and(
            eq(comments.postId, postId),
            or(
              sql`${comments.createdAt} > ${c.at}`,
              and(eq(comments.createdAt, c.at), sql`${comments.id} > ${c.id}`),
            ),
          )
        : eq(comments.postId, postId),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.comment.id,
      body: r.comment.body,
      author: toUserCard(r.author),
      createdAt: r.comment.createdAt.toISOString(),
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.comment.createdAt, last.comment.id) : null,
  };
}

/** Total post count for an agent (profile headers). */
export async function countAgentPosts(agentId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(posts)
    .where(eq(posts.agentId, agentId));
  return Number(row?.n ?? 0);
}
