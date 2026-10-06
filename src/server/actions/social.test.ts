/**
 * Follows, likes and comments: what they may write into someone else's inbox, and what
 * a follower can still do once an agent has gone private.
 *
 * `getSession` and `next/cache` are mocked because these are server actions. The rows,
 * the visibility rule and the in-memory limiter are the real code, against in-memory
 * PGlite. Every test signs in as a fresh user, so no test spends another's limiter.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import type { Session } from "@/server/types";

let session: Session | null = null;

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));

const { addComment, setFollow, setLike, toggleFollow, toggleLike } = await import("./social");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  session = null;
});

/** A new user, signed in. */
async function signInAsNewUser(): Promise<Session> {
  const userId = `did:privy:${nanoid(8)}`;
  const handle = `v${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
  await db.insert(schema.users).values({ id: userId, handle });
  session = { userId, handle, displayName: null, avatarUrl: null, email: null };
  return session;
}

function followsOf(userId: string, agentId: string) {
  return db
    .select()
    .from(schema.follows)
    .where(
      and(
        eq(schema.follows.followerId, userId),
        eq(schema.follows.targetType, "agent"),
        eq(schema.follows.targetId, agentId),
      ),
    );
}

function inbox(userId: string, kind: string) {
  return db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.kind, kind)));
}

async function goPrivate(agentId: string): Promise<void> {
  await db.update(schema.agents).set({ isPublic: false }).where(eq(schema.agents.id, agentId));
}

async function seedPost(agent: { agentId: string; userId: string }): Promise<string> {
  const id = `post_${nanoid(10)}`;
  await db.insert(schema.posts).values({ id, authorId: agent.userId, agentId: agent.agentId, kind: "note", body: "A note." });
  return id;
}

describe("setFollow on an agent that went private", () => {
  it("lets a follower unfollow it, and says nothing about its follower count", async () => {
    const agent = await seedAgent(db);
    const other = await signInAsNewUser();
    await setFollow("agent", agent.agentId, true);
    const me = await signInAsNewUser();
    expect(await setFollow("agent", agent.agentId, true)).toEqual({ ok: true, data: { following: true, followerCount: 2 } });

    await goPrivate(agent.agentId);

    expect(await setFollow("agent", agent.agentId, false)).toEqual({ ok: true, data: { following: false, followerCount: 0 } });
    expect(await followsOf(me.userId, agent.agentId)).toHaveLength(0);
    // Only the caller's own row went.
    expect(await followsOf(other.userId, agent.agentId)).toHaveLength(1);
  });

  it("still refuses a new follow of a private agent", async () => {
    const agent = await seedAgent(db);
    await goPrivate(agent.agentId);
    const me = await signInAsNewUser();

    expect(await setFollow("agent", agent.agentId, true)).toEqual({ ok: false, error: "This agent is private" });
    expect(await followsOf(me.userId, agent.agentId)).toHaveLength(0);
  });

  it("answers an unfollow the same way for a private agent and for one that does not exist", async () => {
    const agent = await seedAgent(db);
    await goPrivate(agent.agentId);
    await signInAsNewUser();

    const expected = { ok: true, data: { following: false, followerCount: 0 } };
    expect(await setFollow("agent", agent.agentId, false)).toEqual(expected);
    expect(await setFollow("agent", "no-such-agent", false)).toEqual(expected);
  });

  it("toggleFollow unfollows it too, and will not follow it back", async () => {
    const agent = await seedAgent(db);
    const me = await signInAsNewUser();
    await setFollow("agent", agent.agentId, true);
    await goPrivate(agent.agentId);

    expect(await toggleFollow("agent", agent.agentId)).toEqual({ ok: true, data: { following: false, followerCount: 0 } });
    expect(await followsOf(me.userId, agent.agentId)).toHaveLength(0);
    expect(await toggleFollow("agent", agent.agentId)).toEqual({ ok: false, error: "This agent is private" });
    expect(await followsOf(me.userId, agent.agentId)).toHaveLength(0);
  });
});

describe("follow and like notifications", () => {
  it("tells an agent's owner once, however many times the same person follows again", async () => {
    const agent = await seedAgent(db);
    await signInAsNewUser();

    for (let lap = 0; lap < 4; lap++) {
      expect((await setFollow("agent", agent.agentId, true)).ok).toBe(true);
      expect((await setFollow("agent", agent.agentId, false)).ok).toBe(true);
    }
    expect((await toggleFollow("agent", agent.agentId)).ok).toBe(true);

    expect(await inbox(agent.userId, "follow")).toHaveLength(1);
  });

  it("tells a person once, even when the follower renames between follows", async () => {
    const target = await seedAgent(db);
    const me = await signInAsNewUser();

    expect((await setFollow("user", target.userId, true)).ok).toBe(true);
    expect((await setFollow("user", target.userId, false)).ok).toBe(true);
    // Same account under a new name: the title changes, the follower does not.
    session = { ...me, handle: `${me.handle}2` };
    expect((await setFollow("user", target.userId, true)).ok).toBe(true);

    expect(await inbox(target.userId, "follow")).toHaveLength(1);
  });

  it("still tells the owner about each different follower", async () => {
    const agent = await seedAgent(db);
    for (let i = 0; i < 3; i++) {
      await signInAsNewUser();
      expect((await setFollow("agent", agent.agentId, true)).ok).toBe(true);
    }
    expect(await inbox(agent.userId, "follow")).toHaveLength(3);
  });

  it("tells a post's author once, however many times the same person likes it again", async () => {
    const agent = await seedAgent(db);
    const postId = await seedPost(agent);
    const otherPost = await seedPost(agent);
    await signInAsNewUser();

    for (let lap = 0; lap < 3; lap++) {
      expect((await setLike(postId, true)).ok).toBe(true);
      expect((await setLike(postId, false)).ok).toBe(true);
    }
    expect((await toggleLike(postId)).ok).toBe(true);
    expect(await inbox(agent.userId, "like")).toHaveLength(1);

    // A different post is a different event.
    expect((await setLike(otherPost, true)).ok).toBe(true);
    expect(await inbox(agent.userId, "like")).toHaveLength(2);
  });
});

describe("addComment's hourly cap", () => {
  async function seedComments(postId: string, authorId: string, count: number, at: Date): Promise<void> {
    await db.insert(schema.comments).values(
      Array.from({ length: count }, () => ({ id: `cmt_${nanoid(12)}`, postId, authorId, body: "Earlier.", createdAt: at })),
    );
  }

  it("refuses the 31st comment in an hour, counted from the rows", async () => {
    const agent = await seedAgent(db);
    const postId = await seedPost(agent);
    const me = await signInAsNewUser();
    await seedComments(postId, me.userId, 30, new Date(Date.now() - 10 * 60_000));

    expect(await addComment(postId, "One more.")).toEqual({
      ok: false,
      error: "You're commenting a lot. Try again in an hour.",
    });
    // Nothing was written, and nothing reached the author's inbox.
    expect(await db.select().from(schema.comments).where(eq(schema.comments.authorId, me.userId))).toHaveLength(30);
    expect(await inbox(agent.userId, "comment")).toHaveLength(0);
  });

  it("does not count comments older than an hour, or anyone else's", async () => {
    const agent = await seedAgent(db);
    const postId = await seedPost(agent);
    const someoneElse = await signInAsNewUser();
    await seedComments(postId, someoneElse.userId, 30, new Date(Date.now() - 10 * 60_000));
    const me = await signInAsNewUser();
    await seedComments(postId, me.userId, 30, new Date(Date.now() - 61 * 60_000));
    await seedComments(postId, me.userId, 29, new Date(Date.now() - 10 * 60_000));

    const result = await addComment(postId, "The thirtieth this hour.");
    expect(result.ok).toBe(true);
    expect(await inbox(agent.userId, "comment")).toHaveLength(1);
    // And that was the last one.
    expect((await addComment(postId, "The thirty-first.")).ok).toBe(false);
  });
});
