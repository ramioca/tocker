import "server-only";
import { and, asc, desc, eq, exists, ilike, inArray, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import { agents, follows, getDb, llmKeys, notifications, users, type Db } from "@/db";
import type { LlmKeyRow, NotificationRow, Page, UserProfile } from "@/server/types";
import { buildAgentCards, decodeCursor, encodeCursor, isFollowing, pageSize } from "./_shared";
import { redactSecrets } from "@/lib/security/redact";
import { visibleRationale } from "./visibility";
import { missingKeySql } from "@/lib/agent/inference-gate";
import { isLlmMock } from "@/lib/agent/mock-model";
import { mutedKinds, sanitizePrefs, type NotificationPrefs } from "@/lib/notifications/prefs";

async function readPrefs(db: Db, userId: string): Promise<NotificationPrefs> {
  const [row] = await db
    .select({ prefs: users.notificationPrefs })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return sanitizePrefs(row?.prefs);
}

/** The viewer's stored notification switches, cleaned. `{}` means everything is on. */
export async function getNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  return readPrefs(await getDb(), userId);
}

/** The filter both the list and the unread count apply, so they can never disagree. */
async function visibleKinds(db: Db, userId: string): Promise<SQL | undefined> {
  const muted = mutedKinds(await readPrefs(db, userId));
  return muted.length > 0 ? notInArray(notifications.kind, muted) : undefined;
}

/**
 * People whose handle or display name contains `query`, for ⌘K. Only owners of a
 * public agent, like the palette's own index: someone who has never published an
 * agent is not listed by name. The caller strips LIKE wildcards from `query`.
 */
export async function searchUsers(
  query: string,
  limit = 8,
): Promise<Array<{ handle: string; displayName: string | null }>> {
  const q = query.trim();
  if (q.length === 0) return [];
  const db = await getDb();
  const like = `%${q}%`;
  return db
    .select({ handle: users.handle, displayName: users.displayName })
    .from(users)
    .where(
      and(
        or(ilike(users.handle, like), ilike(users.displayName, like)),
        exists(
          db
            .select({ one: sql`1` })
            .from(agents)
            .where(
              and(
                eq(agents.ownerId, users.id),
                eq(agents.isPublic, true),
                inArray(agents.status, ["active", "paused"]),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(sql`length(${users.handle})`), asc(users.handle))
    .limit(Math.min(50, Math.max(1, limit)));
}

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

/**
 * How many of this user's agents have no LLM key and so cannot run. Owner-only by
 * construction: it counts the caller's own agents.
 */
export async function countKeylessAgents(userId: string): Promise<number> {
  // The mock model runs every agent without a key, so none of them is missing one.
  if (isLlmMock()) return 0;
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agents)
    // A key agent with no key. An agent that pays per use has none and needs none.
    .where(and(eq(agents.ownerId, userId), missingKeySql()));
  return Number(row?.n ?? 0);
}

export async function getNotifications(userId: string, cursor?: string | null): Promise<Page<NotificationRow>> {
  const db = await getDb();
  const limit = pageSize(30);
  const c = decodeCursor(cursor);
  const visible = await visibleKinds(db, userId);
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        visible,
        c
          ? or(
              lt(notifications.createdAt, c.at),
              and(eq(notifications.createdAt, c.at), lt(notifications.id, c.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: redactSecrets(n.title),
      // A `trade` notification goes to followers. Rows written before follower bodies
      // were redacted can still carry an exit threshold or a paid source's name.
      // A failure notice quotes what broke, which can be a provider's or a node's own
      // sentence with a credential in it.
      body: n.kind === "trade" ? visibleRationale(n.body, { isOwner: false }) : n.body === null ? null : redactSecrets(n.body),
      href: n.href,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const db = await getDb();
  const visible = await visibleKinds(db, userId);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), visible));
  return Number(row?.n ?? 0);
}
