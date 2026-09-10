import "server-only";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { agents, follows, getDb, llmKeys, notifications, users } from "@/db";
import type { LlmKeyRow, NotificationRow, Page, UserProfile } from "@/server/types";
import { buildAgentCards, decodeCursor, encodeCursor, isFollowing, pageSize } from "./_shared";

export async function getUserProfile(handle: string, viewerId?: string | null): Promise<UserProfile | null> {
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.handle, handle)).limit(1);
  if (!user) return null;
  const isSelf = Boolean(viewerId && viewerId === user.id);

  const [agentRows, followerRow, followingRow, followed] = await Promise.all([
    db
      .select()
      .from(agents)
      .where(isSelf ? eq(agents.ownerId, user.id) : and(eq(agents.ownerId, user.id), eq(agents.isPublic, true)))
      .orderBy(desc(agents.createdAt)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(follows)
      .where(and(eq(follows.targetType, "user"), eq(follows.targetId, user.id))),
    db.select({ n: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followerId, user.id)),
    isFollowing(db, viewerId, "user", user.id),
  ]);

  const agentCards = await buildAgentCards(db, agentRows);
  const totalPnlUsd = agentCards.reduce((sum, a) => sum + (a.pnlUsd ?? 0), 0);

  return {
    id: user.id,
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    createdAt: user.createdAt.toISOString(),
    followerCount: Number(followerRow[0]?.n ?? 0),
    followingCount: Number(followingRow[0]?.n ?? 0),
    isFollowedByViewer: followed,
    isSelf,
    agents: agentCards,
    totalPnlUsd,
  };
}

export async function getMyLlmKeys(userId: string): Promise<LlmKeyRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: llmKeys.id,
      provider: llmKeys.provider,
      label: llmKeys.label,
      last4: llmKeys.last4,
      createdAt: llmKeys.createdAt,
    })
    .from(llmKeys)
    .where(eq(llmKeys.userId, userId))
    .orderBy(desc(llmKeys.createdAt));
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    label: r.label,
    last4: r.last4,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getNotifications(userId: string, cursor?: string | null): Promise<Page<NotificationRow>> {
  const db = await getDb();
  const limit = pageSize(30);
  const c = decodeCursor(cursor);
  const rows = await db
    .select()
    .from(notifications)
    .where(
      c
        ? and(
            eq(notifications.userId, userId),
            or(
              lt(notifications.createdAt, c.at),
              and(eq(notifications.createdAt, c.at), lt(notifications.id, c.id)),
            ),
          )
        : eq(notifications.userId, userId),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      href: n.href,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(row?.n ?? 0);
}
