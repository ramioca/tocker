"use server";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { agents, comments, follows, getDb, likes, notifications, posts, users } from "@/db";
import { getSession } from "@/lib/auth";
import { newId } from "@/server/queries/_shared";
import type { ActionResult } from "@/server/types";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export async function toggleFollow(
  targetType: "user" | "agent",
  targetId: string,
): Promise<ActionResult<{ following: boolean; followerCount: number }>> {
  const session = await getSession();
  if (!session) return fail("Sign in to follow");
  if (targetType === "user" && targetId === session.userId) return fail("You cannot follow yourself");

  const db = await getDb();

  let href: string | null = null;
  let title = "";
  let ownerId: string | null = null;
  if (targetType === "agent") {
    const [agent] = await db
      .select({ id: agents.id, slug: agents.slug, name: agents.name, ownerId: agents.ownerId, isPublic: agents.isPublic })
      .from(agents)
      .where(eq(agents.id, targetId))
      .limit(1);
    if (!agent) return fail("Agent not found");
    if (!agent.isPublic && agent.ownerId !== session.userId) return fail("This agent is private");
    href = `/agents/${agent.slug}`;
    title = `@${session.handle} followed ${agent.name}`;
    ownerId = agent.ownerId;
  } else {
    const [user] = await db.select({ id: users.id, handle: users.handle }).from(users).where(eq(users.id, targetId)).limit(1);
    if (!user) return fail("User not found");
    href = `/u/${session.handle}`;
    title = `@${session.handle} followed you`;
    ownerId = user.id;
  }

  const existing = await db
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(
      and(
        eq(follows.followerId, session.userId),
        eq(follows.targetType, targetType),
        eq(follows.targetId, targetId),
      ),
    )
    .limit(1);

  let following: boolean;
  if (existing.length > 0) {
    await db
      .delete(follows)
      .where(
        and(
          eq(follows.followerId, session.userId),
          eq(follows.targetType, targetType),
          eq(follows.targetId, targetId),
        ),
      );
    following = false;
  } else {
    await db
      .insert(follows)
      .values({ followerId: session.userId, targetType, targetId })
      .onConflictDoNothing();
    following = true;
    if (ownerId && ownerId !== session.userId) {
      await db.insert(notifications).values({
        id: newId("ntf"),
        userId: ownerId,
        kind: "follow",
        title,
        body: null,
        href,
      });
    }
  }

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(follows)
    .where(and(eq(follows.targetType, targetType), eq(follows.targetId, targetId)));

  revalidatePath("/feed");
  if (href) revalidatePath(href);
  return { ok: true, data: { following, followerCount: Number(countRow?.n ?? 0) } };
}

export async function toggleLike(postId: string): Promise<ActionResult<{ liked: boolean; likeCount: number }>> {
  const session = await getSession();
  if (!session) return fail("Sign in to like");

  const db = await getDb();
  const [post] = await db
    .select({ id: posts.id, authorId: posts.authorId, agentId: posts.agentId })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
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
    if (post.authorId !== session.userId) {
      await db.insert(notifications).values({
        id: newId("ntf"),
        userId: post.authorId,
        kind: "like",
        title: `@${session.handle} liked your post`,
        body: null,
        href: `/feed`,
      });
    }
  }

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(likes)
    .where(eq(likes.postId, postId));
  const likeCount = Number(countRow?.n ?? 0);
  await db.update(posts).set({ likeCount }).where(eq(posts.id, postId));

  revalidatePath("/feed");
  return { ok: true, data: { liked, likeCount } };
}

export async function addComment(postId: string, body: string): Promise<ActionResult<{ id: string }>> {
  const session = await getSession();
  if (!session) return fail("Sign in to comment");

  const text = body?.trim();
  if (!text) return fail("Write something first");
  if (text.length > 1000) return fail("Comments are limited to 1000 characters");

  const db = await getDb();
  const [post] = await db.select({ id: posts.id, authorId: posts.authorId }).from(posts).where(eq(posts.id, postId)).limit(1);
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
      href: `/feed`,
    });
  }

  revalidatePath("/feed");
  return { ok: true, data: { id } };
}

export async function createNotePost(agentId: string, body: string): Promise<ActionResult<{ id: string }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const text = body?.trim();
  if (!text) return fail("Write something first");
  if (text.length > 2000) return fail("Notes are limited to 2000 characters");

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
