"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, gte, sql } from "drizzle-orm";
import { agents, comments, follows, getDb, likes, notifications, posts, users } from "@/db";
import { getSession } from "@/lib/auth";
import { SECRET_IN_PUBLIC_TEXT, looksLikeSecret } from "@/lib/security/redact";
import { newId } from "@/server/queries/_shared";
import type { ActionResult } from "@/server/types";
import { ACTION_LIMITS, slowDown } from "./_shared";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * The most comments one account may write in an hour, counted in the database. A
 * comment's first line lands in the post author's inbox, so this is also the most one
 * account can put there.
 */
const MAX_COMMENTS_PER_HOUR = 30;
const COMMENT_WINDOW_MS = 60 * 60_000;

/**
 * A post that belongs to a private agent is invisible in every feed query, so it must
 * not be likeable or commentable either — otherwise the write path becomes an oracle for
 * post ids the reader was never shown.
 */
async function postIsVisible(db: Db, agentId: string | null, viewerId: string) {
  if (!agentId) return true;
  const [agent] = await db
    .select({ ownerId: agents.ownerId, isPublic: agents.isPublic })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) return false;
  return agent.isPublic || agent.ownerId === viewerId;
}

type FollowTarget = { href: string; title: string; ownerId: string };

/** Who gets told about a follow, and where the notification points. Applies the visibility rule. */
async function resolveFollowTarget(
  db: Db,
  targetType: "user" | "agent",
  targetId: string,
  viewer: { userId: string; handle: string },
): Promise<FollowTarget | { error: string }> {
  if (targetType === "agent") {
    const [agent] = await db
      .select({ id: agents.id, slug: agents.slug, name: agents.name, ownerId: agents.ownerId, isPublic: agents.isPublic })
      .from(agents)
      .where(eq(agents.id, targetId))
      .limit(1);
    if (!agent) return { error: "Agent not found" };
    if (!agent.isPublic && agent.ownerId !== viewer.userId) return { error: "This agent is private" };
    return { href: `/agents/${agent.slug}`, title: `@${viewer.handle} followed ${agent.name}`, ownerId: agent.ownerId };
  }
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId)).limit(1);
  if (!user) return { error: "User not found" };
  return { href: `/u/${viewer.handle}`, title: `@${viewer.handle} followed you`, ownerId: user.id };
}

function followRow(followerId: string, targetType: "user" | "agent", targetId: string) {
  return and(eq(follows.followerId, followerId), eq(follows.targetType, targetType), eq(follows.targetId, targetId));
}

/**
 * A notification id that is the same for the same actor, subject and UTC day.
 *
 * Unfollow deletes the row, so "following twice inserts once" does not cover follow,
 * unfollow, follow: every lap used to write another line into someone else's inbox,
 * which buries the proposals and exits that inbox exists for. With the id derived from
 * who did it, to what, and the day, the insert itself is the check: a repeat collides
 * with the first and writes nothing. Keyed on ids rather than on the title so a
 * follower who renames between laps is still the same follower, and atomic so two taps
 * racing cannot both get through.
 */
function oncePerDayId(kind: "follow" | "like", actorId: string, subject: string): string {
  const key = createHash("sha256").update(`${kind}\n${actorId}\n${subject}`).digest("base64url").slice(0, 22);
  return `ntf_${key}_${new Date().toISOString().slice(0, 10)}`;
}

async function notifyFollow(
  db: Db,
  target: FollowTarget,
  followerId: string,
  targetType: "user" | "agent",
  targetId: string,
) {
  if (target.ownerId === followerId) return;
  await db
    .insert(notifications)
    .values({
      id: oncePerDayId("follow", followerId, `${targetType}:${targetId}`),
      userId: target.ownerId,
      kind: "follow",
      title: target.title,
      body: null,
      href: target.href,
    })
    .onConflictDoNothing();
}

async function followerCount(db: Db, targetType: "user" | "agent", targetId: string): Promise<number> {
  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(follows)
    .where(and(eq(follows.targetType, targetType), eq(follows.targetId, targetId)));
  return Number(countRow?.n ?? 0);
}

export async function toggleFollow(
  targetType: "user" | "agent",
  targetId: string,
): Promise<ActionResult<{ following: boolean; followerCount: number }>> {
  const session = await getSession();
  if (!session) return fail("Sign in to follow");
  const limited = slowDown("social", session.userId, ACTION_LIMITS.social);
  if (limited) return fail(limited);
  if (targetType === "user" && targetId === session.userId) return fail("You cannot follow yourself");

  const db = await getDb();
  // The viewer's own row is read, and removed, before the target's visibility is asked
  // about: see `setFollow`.
  const existing = await db
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(followRow(session.userId, targetType, targetId))
    .limit(1);
  if (existing.length > 0) await db.delete(follows).where(followRow(session.userId, targetType, targetId));

  const target = await resolveFollowTarget(db, targetType, targetId, session);
  if ("error" in target) {
    return existing.length > 0 ? { ok: true, data: { following: false, followerCount: 0 } } : fail(target.error);
  }

  const following = existing.length === 0;
  if (following) {
    await db
      .insert(follows)
      .values({ followerId: session.userId, targetType, targetId })
      .onConflictDoNothing();
    await notifyFollow(db, target, session.userId, targetType, targetId);
  }

  const count = await followerCount(db, targetType, targetId);
  revalidatePath("/feed");
  revalidatePath(target.href);
  return { ok: true, data: { following, followerCount: count } };
}

/**
 * Set the viewer's follow to `following`, rather than flipping it.
 *
 * A button sends the state it is showing, so a stale button (followed in another tab,
 * a row remounted from an older render) cannot do the opposite of what it says. The
 * write is idempotent: following twice inserts once and notifies once.
 */
export async function setFollow(
  targetType: "user" | "agent",
  targetId: string,
  following: boolean,
): Promise<ActionResult<{ following: boolean; followerCount: number }>> {
  const session = await getSession();
  if (!session) return fail("Sign in to follow");
  // A public endpoint: the arguments are whatever the caller sent.
  if ((targetType !== "user" && targetType !== "agent") || typeof targetId !== "string" || typeof following !== "boolean") {
    return fail("Nothing to follow");
  }
  const limited = slowDown("social", session.userId, ACTION_LIMITS.social);
  if (limited) return fail(limited);
  if (targetType === "user" && targetId === session.userId) return fail("You cannot follow yourself");

  const db = await getDb();
  // Unfollowing removes the viewer's own row and needs nobody's permission, so it runs
  // before the visibility rule. An agent that went private after it was followed would
  // otherwise answer "This agent is private" here and keep its followers for good.
  if (!following) await db.delete(follows).where(followRow(session.userId, targetType, targetId));

  const target = await resolveFollowTarget(db, targetType, targetId, session);
  if ("error" in target) {
    // The unfollow is done. Zero, not a recount: a private agent's follower count is
    // not this caller's to read.
    return following ? fail(target.error) : { ok: true, data: { following: false, followerCount: 0 } };
  }

  if (following) {
    const inserted = await db
      .insert(follows)
      .values({ followerId: session.userId, targetType, targetId })
      .onConflictDoNothing()
      .returning({ followerId: follows.followerId });
    if (inserted.length > 0) await notifyFollow(db, target, session.userId, targetType, targetId);
  }

  const count = await followerCount(db, targetType, targetId);
  revalidatePath("/feed");
  revalidatePath(target.href);
  return { ok: true, data: { following, followerCount: count } };
}

/** The post, or null when it does not exist or the viewer may not see it (same answer for both). */
async function visiblePost(db: Db, postId: string, viewerId: string) {
  const [post] = await db
    .select({ id: posts.id, authorId: posts.authorId, agentId: posts.agentId })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!post) return null;
  if (!(await postIsVisible(db, post.agentId, viewerId))) return null;
  return post;
}

async function notifyLike(db: Db, post: { id: string; authorId: string }, viewer: { userId: string; handle: string }) {
  if (post.authorId === viewer.userId) return;
  // Like, unlike, like is the same loop as follow, unfollow, follow: once a day per post.
  await db
    .insert(notifications)
    .values({
      id: oncePerDayId("like", viewer.userId, post.id),
      userId: post.authorId,
      kind: "like",
      title: `@${viewer.handle} liked your post`,
      body: null,
      href: `/feed/${post.id}`,
    })
    .onConflictDoNothing();
}

/** Recount from the rows and store it on the post, so the cached count never drifts. */
async function syncLikeCount(db: Db, postId: string): Promise<number> {
  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(likes)
    .where(eq(likes.postId, postId));
  const likeCount = Number(countRow?.n ?? 0);
  await db.update(posts).set({ likeCount }).where(eq(posts.id, postId));
  return likeCount;
}

export async function toggleLike(postId: string): Promise<ActionResult<{ liked: boolean; likeCount: number }>> {
  const session = await getSession();
  if (!session) return fail("Sign in to like");
  const limited = slowDown("social", session.userId, ACTION_LIMITS.social);
  if (limited) return fail(limited);

  const db = await getDb();
  const post = await visiblePost(db, postId, session.userId);
  if (!post) return fail("Post not found");

  const existing = await db
    .select({ postId: likes.postId })
    .from(likes)
    .where(and(eq(likes.userId, session.userId), eq(likes.postId, postId)))
    .limit(1);

  let liked: boolean;
  if (existing.length > 0) {
    await db.delete(likes).where(and(eq(likes.userId, session.userId), eq(likes.postId, postId)));
    liked = false;
  } else {
    await db.insert(likes).values({ userId: session.userId, postId }).onConflictDoNothing();
    liked = true;
    await notifyLike(db, post, session);
  }

  const likeCount = await syncLikeCount(db, postId);
  revalidatePath("/feed");
  return { ok: true, data: { liked, likeCount } };
}

/**
 * Set the viewer's like on a post to `liked`, rather than flipping it.
 *
 * Idempotent at the source: a second "like" inserts nothing and notifies nobody, and a
 * card that went stale (liked in another tab, a tap racing a refetch) cannot flip the
 * server the wrong way.
 */
export async function setLike(postId: string, liked: boolean): Promise<ActionResult<{ liked: boolean; likeCount: number }>> {
  const session = await getSession();
  if (!session) return fail("Sign in to like");
  // A public endpoint: the arguments are whatever the caller sent.
  if (typeof postId !== "string" || typeof liked !== "boolean") return fail("Post not found");
  const limited = slowDown("social", session.userId, ACTION_LIMITS.social);
  if (limited) return fail(limited);

  const db = await getDb();
  const post = await visiblePost(db, postId, session.userId);
  if (!post) return fail("Post not found");

  if (liked) {
    const inserted = await db
      .insert(likes)
      .values({ userId: session.userId, postId })
      .onConflictDoNothing()
      .returning({ postId: likes.postId });
    if (inserted.length > 0) await notifyLike(db, post, session);
  } else {
    await db.delete(likes).where(and(eq(likes.userId, session.userId), eq(likes.postId, postId)));
  }

  const likeCount = await syncLikeCount(db, postId);
  revalidatePath("/feed");
  revalidatePath(`/feed/${postId}`);
  return { ok: true, data: { liked, likeCount } };
}

export async function addComment(postId: string, body: string): Promise<ActionResult<{ id: string }>> {
  const session = await getSession();
  if (!session) return fail("Sign in to comment");

  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return fail("Write something first");
  if (text.length > 1000) return fail("Comments are limited to 1000 characters");
  if (looksLikeSecret(text)) return fail(SECRET_IN_PUBLIC_TEXT);
  // After validation, so a typo'd empty comment does not spend one of the ten.
  const limited = slowDown("comment", session.userId, ACTION_LIMITS.comment);
  if (limited) return fail(limited);

  const db = await getDb();
  // The limiter above lives in one server instance's memory, so its real ceiling is ten
  // a minute times however many instances are up. This one is counted from the rows.
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(comments)
    .where(and(eq(comments.authorId, session.userId), gte(comments.createdAt, new Date(Date.now() - COMMENT_WINDOW_MS))));
  if (Number(recent?.n ?? 0) >= MAX_COMMENTS_PER_HOUR) return fail("You're commenting a lot. Try again in an hour.");

  const post = await visiblePost(db, postId, session.userId);
  if (!post) return fail("Post not found");

  const id = newId("cmt");
  await db.insert(comments).values({ id, postId, authorId: session.userId, body: text });

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(comments)
    .where(eq(comments.postId, postId));
  await db.update(posts).set({ commentCount: Number(countRow?.n ?? 0) }).where(eq(posts.id, postId));

  if (post.authorId !== session.userId) {
    await db.insert(notifications).values({
      id: newId("ntf"),
      userId: post.authorId,
      kind: "comment",
      title: `@${session.handle} commented on your post`,
      body: text.slice(0, 140),
      href: `/feed/${postId}`,
    });
  }

  revalidatePath("/feed");
  revalidatePath(`/feed/${postId}`);
  return { ok: true, data: { id } };
}

export async function createNotePost(agentId: string, body: string): Promise<ActionResult<{ id: string }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return fail("Write something first");
  if (text.length > 2000) return fail("Notes are limited to 2000 characters");
  if (looksLikeSecret(text)) return fail(SECRET_IN_PUBLIC_TEXT);
  // Notes and comments share one bucket: both are public text on the feed.
  const limited = slowDown("comment", session.userId, ACTION_LIMITS.comment);
  if (limited) return fail(limited);

  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId, slug: agents.slug })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  const id = newId("post");
  await db.insert(posts).values({ id, authorId: session.userId, agentId, kind: "note", body: text });

  revalidatePath("/feed");
  revalidatePath(`/agents/${agent.slug}`);
  return { ok: true, data: { id } };
}
