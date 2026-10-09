/**
 * The first-run screen's two actions: `checkHandle` as the person types, and
 * `completeOnboarding` when they press Continue.
 *
 * A username is public the moment it is saved, so most of this is what is refused and
 * that a refusal writes nothing. The rest is the once-per-account guard (a second tab
 * cannot overwrite the first tab's choice), the name a rename leaves behind, and the
 * limiter, which only an attempt that reaches the database may use.
 *
 * `getSession` and `next/cache` are mocked because these are server actions. The rows,
 * the unique index and the in-memory limiter are the real code, against in-memory
 * PGlite. `@/server/queries/handles` is the real module too, with three switches for
 * what cannot be staged otherwise: a name taken between the check and the write, and a
 * database that stops answering.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { FOUNDER_X } from "@/lib/contact";
import { limiter } from "@/lib/security/rate-limit";
import type { Session } from "@/server/types";

let session: Session | null = null;

const cache = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  refresh: vi.fn(),
}));
const force = vi.hoisted(() => ({ free: false, checkThrows: false, holdFails: false }));

vi.mock("next/cache", () => cache);
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));
vi.mock("@/server/queries/handles", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/queries/handles")>();
  return {
    ...real,
    isHandleTaken: async (...args: Parameters<typeof real.isHandleTaken>) => {
      if (force.checkThrows) throw new Error("connection lost");
      return force.free ? false : real.isHandleTaken(...args);
    },
    holdRetiredHandle: async (...args: Parameters<typeof real.holdRetiredHandle>) => {
      if (force.holdFails) throw new Error("connection lost");
      return real.holdRetiredHandle(...args);
    },
  };
});

const { checkHandle, completeOnboarding } = await import("./onboarding");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

afterEach(() => {
  session = null;
  force.free = false;
  force.checkThrows = false;
  force.holdFails = false;
  limiter.reset();
  vi.restoreAllMocks();
});

const PHOTO = "https://pbs.twimg.com/profile_images/1234567890/face_normal.jpg";
const SEED = "k3j9x0a1bz";
const seedChoice = { kind: "seed", seed: SEED } as const;

/** A handle nobody has used: a letter, then eight letters or digits. */
function freshHandle(prefix = "u"): string {
  return `${prefix}${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
}

/** The session `getSession` builds from a row. */
function sessionOf(user: typeof schema.users.$inferSelect): Session {
  return {
    userId: user.id,
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    avatarSeed: user.avatarSeed,
    onboardedAt: user.onboardedAt ? user.onboardedAt.toISOString() : null,
    email: user.email,
  };
}

async function row(userId: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw new Error(`no user ${userId}`);
  return user;
}

/** Sign in as an existing account, reading its row as every request does. */
async function signInAs(userId: string) {
  const user = await row(userId);
  session = sessionOf(user);
  return user;
}

/** A new account as sign-up leaves it (nothing chosen yet), signed in. */
async function signedIn(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const userId = `did:privy:${nanoid(8)}`;
  await db.insert(schema.users).values({ id: userId, handle: freshHandle(), ...overrides });
  return signInAs(userId);
}

/** Another account, not signed in, holding `handle`. */
async function someoneElse(handle = freshHandle("o")) {
  const userId = `did:privy:${nanoid(8)}`;
  await db.insert(schema.users).values({ id: userId, handle, onboardedAt: new Date() });
  return { userId, handle };
}

/** Who holds a name that was given up, or undefined when nobody does. */
async function heldBy(handle: string): Promise<string | undefined> {
  const [held] = await db.select().from(schema.retiredHandles).where(eq(schema.retiredHandles.handle, handle)).limit(1);
  return held?.userId;
}

async function hold(handle: string, userId: string): Promise<void> {
  await db.insert(schema.retiredHandles).values({ handle, userId });
}

describe("completeOnboarding", () => {
  it("answers signed-out with nobody signed in, and reads nothing", async () => {
    force.checkThrows = true;
    expect(await completeOnboarding({ handle: "anyone", avatar: seedChoice })).toEqual({
      ok: false,
      error: "Sign in first",
      kind: "signed-out",
    });
  });

  it("writes the username, the avatar and the date, and nothing else", async () => {
    const before = await signedIn({
      displayName: "Jane D.",
      bio: "Hello.",
      email: "jane@example.com",
      avatarUrl: PHOTO,
      createdAt: new Date("2026-09-01T09:00:00.000Z"),
      updatedAt: new Date("2026-09-01T09:00:00.000Z"),
    });
    const next = freshHandle("n");
    const started = Date.now();

    expect(await completeOnboarding({ handle: next, avatar: seedChoice })).toEqual({
      ok: true,
      data: { handle: next, avatarSeed: SEED, hasAgents: false, already: false },
    });

    const after = await row(before.id);
    expect(after.handle).toBe(next);
    expect(after.avatarSeed).toBe(SEED);
    expect(after.onboardedAt?.getTime()).toBeGreaterThanOrEqual(started - 1000);
    expect(after.updatedAt.getTime()).toBe(after.onboardedAt?.getTime());
    const untouched = ({ handle: _h, avatarSeed: _s, onboardedAt: _o, updatedAt: _u, ...rest }: typeof after) => rest;
    expect(untouched(after)).toEqual(untouched(before));
    // The photo link and the display name are the sign-in provider's, and stay.
    expect(after.avatarUrl).toBe(PHOTO);
    expect(after.displayName).toBe("Jane D.");
  });

  it("accepts the assigned username kept as it is: one press of Continue is enough", async () => {
    const me = await signedIn({ handle: `user${nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, "x")}` });
    expect(await completeOnboarding({ handle: me.handle, avatar: seedChoice })).toEqual({
      ok: true,
      data: { handle: me.handle, avatarSeed: SEED, hasAgents: false, already: false },
    });
    const after = await row(me.id);
    expect(after.handle).toBe(me.handle);
    expect(after.onboardedAt).toBeInstanceOf(Date);
    // Nothing was given up, so nothing is held.
    expect(await heldBy(me.handle)).toBeUndefined();
  });

  it("keeps a username the rules would now refuse, when it is the account's own", async () => {
    const me = await signedIn({ handle: "moderator" });
    const result = await completeOnboarding({ handle: "moderator", avatar: seedChoice });
    expect(result.ok).toBe(true);
    expect((await row(me.id)).onboardedAt).toBeInstanceOf(Date);
  });

  it("stores the name as it is kept: trimmed and lowercase", async () => {
    const me = await signedIn();
    const next = freshHandle("n");
    const result = await completeOnboarding({ handle: `  ${next.toUpperCase()} `, avatar: seedChoice });
    expect(result).toMatchObject({ ok: true, data: { handle: next } });
    expect((await row(me.id)).handle).toBe(next);
  });

  it("refuses a name the rules do not allow, and writes nothing", async () => {
    const me = await signedIn();
    for (const handle of ["", "a", "x".repeat(21), "my-name", "dot.name", "two words", "émile", "@name"]) {
      expect(await completeOnboarding({ handle, avatar: seedChoice }), handle).toEqual({
        ok: false,
        error: "Usernames are 2–20 letters, numbers or _",
        kind: "handle",
      });
    }
    expect(await row(me.id)).toEqual(me);
  });

  it("refuses the product, staff words and the founder, in any case", async () => {
    const me = await signedIn();
    for (const handle of ["support", "Support", "ADMIN", "tocker", "Tocker_Team", "_help_", "security1", "privy", FOUNDER_X.handle]) {
      expect(await completeOnboarding({ handle, avatar: seedChoice }), handle).toEqual({
        ok: false,
        error: "That username is reserved",
        kind: "handle",
      });
    }
    expect(await row(me.id)).toEqual(me);
  });

  it("refuses a name another account has", async () => {
    const other = await someoneElse();
    const me = await signedIn();
    expect(await completeOnboarding({ handle: other.handle, avatar: seedChoice })).toEqual({
      ok: false,
      error: "That username is taken",
      kind: "handle",
    });
    expect(await row(me.id)).toEqual(me);
  });

  it("refuses a name another account gave up and still holds", async () => {
    const other = await someoneElse();
    const given = freshHandle("g");
    await hold(given, other.userId);
    const me = await signedIn();
    expect(await completeOnboarding({ handle: given, avatar: seedChoice })).toEqual({
      ok: false,
      error: "That username is taken",
      kind: "handle",
    });
    expect(await row(me.id)).toEqual(me);
    expect(await heldBy(given)).toBe(other.userId);
  });

  it("accepts a name this account gave up, and stops holding it", async () => {
    const me = await signedIn();
    const mine = freshHandle("g");
    await hold(mine, me.id);
    expect(await completeOnboarding({ handle: mine, avatar: seedChoice })).toMatchObject({ ok: true, data: { handle: mine } });
    expect((await row(me.id)).handle).toBe(mine);
    expect(await heldBy(mine)).toBeUndefined();
    // And the name it left is held in its place.
    expect(await heldBy(me.handle)).toBe(me.id);
  });

  it("keeps the account's own name when a hold on it was left under someone else", async () => {
    // Another account gave this name up as this one was given it: the hold landed after.
    const other = await someoneElse();
    const me = await signedIn();
    await hold(me.handle, other.userId);
    expect(await completeOnboarding({ handle: me.handle, avatar: seedChoice })).toEqual({
      ok: true,
      data: { handle: me.handle, avatarSeed: SEED, hasAgents: false, already: false },
    });
    expect((await row(me.id)).onboardedAt).toBeInstanceOf(Date);
    expect(await heldBy(me.handle)).toBe(other.userId);
  });

  it("holds the old name after a rename, so nobody else can take it", async () => {
    const me = await signedIn();
    const next = freshHandle("n");
    expect((await completeOnboarding({ handle: next, avatar: seedChoice })).ok).toBe(true);
    expect(await heldBy(me.handle)).toBe(me.id);

    const other = await signedIn();
    expect(await completeOnboarding({ handle: me.handle, avatar: seedChoice })).toMatchObject({ ok: false, kind: "handle" });
    expect((await row(other.id)).handle).toBe(other.handle);
  });

  it("still saves when the old name could not be held", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const me = await signedIn();
    const next = freshHandle("n");
    force.holdFails = true;
    expect(await completeOnboarding({ handle: next, avatar: seedChoice })).toMatchObject({
      ok: true,
      data: { handle: next, already: false },
    });
    expect((await row(me.id)).handle).toBe(next);
    expect(await heldBy(me.handle)).toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("keeps the photo when it is one the app will show, by storing no seed", async () => {
    // An owner who picked an avatar in Settings first, and now chooses their photo.
    const me = await signedIn({ avatarUrl: PHOTO, avatarSeed: "aaaaaaaaaa" });
    expect(await completeOnboarding({ handle: me.handle, avatar: { kind: "photo" } })).toEqual({
      ok: true,
      data: { handle: me.handle, avatarSeed: null, hasAgents: false, already: false },
    });
    const after = await row(me.id);
    expect(after.avatarSeed).toBeNull();
    expect(after.avatarUrl).toBe(PHOTO);
  });

  it("refuses the photo to an account that has none the app will show", async () => {
    const REFUSAL = { ok: false, error: "That avatar is not available. Pick another.", kind: "avatar" };
    for (const avatarUrl of [null, "https://example.com/me.jpg", PHOTO.replace("https:", "http:"), "https://pbs.twimg.com.example.com/a_normal.jpg"]) {
      const me = await signedIn({ avatarUrl });
      expect(await completeOnboarding({ handle: me.handle, avatar: { kind: "photo" } }), String(avatarUrl)).toEqual(REFUSAL);
      expect(await row(me.id)).toEqual(me);
    }
  });

  it("refuses a seed the picker could not have made, and a choice of no known kind", async () => {
    const REFUSAL = { ok: false, error: "That avatar is not available. Pick another.", kind: "avatar" };
    const me = await signedIn();
    const choices: unknown[] = [
      { kind: "seed", seed: "" },
      { kind: "seed", seed: "short" },
      { kind: "seed", seed: "UPPERCASE1" },
      { kind: "seed", seed: "hello_worl" },
      { kind: "seed", seed: "abcdefghijk" },
      { kind: "seed", seed: me.handle },
      { kind: "seed", seed: "x".repeat(5000) },
      { kind: "seed", seed: 42 },
      { kind: "seed" },
      { kind: "url", url: PHOTO },
      // Still only "the photo", whatever else it carries, and this account has none.
      { kind: "photo", url: "https://example.com/tracker.gif" },
      SEED,
      null,
      undefined,
    ];
    for (const avatar of choices) {
      expect(await completeOnboarding({ handle: me.handle, avatar: avatar as never }), JSON.stringify(avatar)).toEqual(REFUSAL);
    }
    expect(await row(me.id)).toEqual(me);
  });

  it("answers a request that is not the shape the screen sends, without throwing", async () => {
    const me = await signedIn();
    for (const input of [null, undefined, "rami", 42, {}, { avatar: seedChoice }, { handle: 42, avatar: seedChoice }, { handle: "x".repeat(65), avatar: seedChoice }]) {
      expect(await completeOnboarding(input as never), JSON.stringify(input)).toMatchObject({ ok: false, kind: "handle" });
    }
    expect(await row(me.id)).toEqual(me);
  });

  it("answers `already` to a second call, and the first choice stands", async () => {
    const me = await signedIn();
    const first = freshHandle("n");
    expect(await completeOnboarding({ handle: first, avatar: seedChoice })).toMatchObject({ ok: true, data: { already: false } });
    const saved = await signInAs(me.id);

    // A second tab, still showing what it was prefilled with, or a name typed there.
    for (const handle of [me.handle, freshHandle("z")]) {
      expect(await completeOnboarding({ handle, avatar: { kind: "seed", seed: "zzzzzzzzzz" } })).toEqual({
        ok: true,
        data: { handle: first, avatarSeed: SEED, hasAgents: false, already: true },
      });
    }
    expect(await row(me.id)).toEqual(saved);
    expect(await heldBy(first)).toBeUndefined();
  });

  it("answers `already` to an account that was onboarded by the migration", async () => {
    const chosen = new Date("2026-09-01T09:00:00.000Z");
    const me = await signedIn({ handle: freshHandle("c"), onboardedAt: chosen });
    expect(await completeOnboarding({ handle: freshHandle("n"), avatar: seedChoice })).toEqual({
      ok: true,
      data: { handle: me.handle, avatarSeed: null, hasAgents: false, already: true },
    });
    expect(await row(me.id)).toEqual(me);
  });

  it("answers a name taken between the check and the write as taken, in its own sentence", async () => {
    const other = await someoneElse();
    const me = await signedIn();
    // The check says free; the unique index on `users.handle` is what refuses the row.
    force.free = true;
    expect(await completeOnboarding({ handle: other.handle, avatar: seedChoice })).toEqual({
      ok: false,
      error: "Someone just took that name. Try another.",
      kind: "handle",
    });
    expect(await row(me.id)).toEqual(me);
    expect((await row(other.userId)).handle).toBe(other.handle);
  });

  it("answers `failed` when the database does not, and says nothing of why", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const me = await signedIn();
    force.checkThrows = true;
    expect(await completeOnboarding({ handle: freshHandle("n"), avatar: seedChoice })).toEqual({
      ok: false,
      error: "Could not save. Try again.",
      kind: "failed",
    });
    expect(logged).toHaveBeenCalledTimes(1);
    force.checkThrows = false;
    expect(await row(me.id)).toEqual(me);
  });

  it("says whether the account owns an agent, which decides the second screen", async () => {
    const none = await signedIn();
    expect(await completeOnboarding({ handle: none.handle, avatar: seedChoice })).toMatchObject({
      ok: true,
      data: { hasAgents: false, already: false },
    });

    const owner = await seedAgent(db);
    // `seedAgent` names its user from nanoid's whole alphabet, which has capitals and a
    // hyphen: about one run in eleven that is not a username, and keeping it is refused.
    // Give the owner a name sign-up could have given.
    await db.update(schema.users).set({ handle: freshHandle("a") }).where(eq(schema.users.id, owner.userId));
    const me = await signInAs(owner.userId);
    expect(await completeOnboarding({ handle: me.handle, avatar: seedChoice })).toMatchObject({
      ok: true,
      data: { hasAgents: true, already: false },
    });
    // And again in the answer a second tab gets.
    await signInAs(owner.userId);
    expect(await completeOnboarding({ handle: me.handle, avatar: seedChoice })).toMatchObject({
      ok: true,
      data: { hasAgents: true, already: true },
    });
  });

  it("spends the allowance only on an attempt that reaches the database", async () => {
    const other = await someoneElse();
    const me = await signedIn();

    // Refused by the rules alone, far more often than the allowance.
    for (let i = 0; i < 12; i += 1) {
      expect(await completeOnboarding({ handle: "no", avatar: { kind: "photo" } })).toMatchObject({ kind: "avatar" });
      expect(await completeOnboarding({ handle: "support", avatar: seedChoice })).toMatchObject({ kind: "handle" });
      expect(await completeOnboarding({ handle: "a", avatar: seedChoice })).toMatchObject({ kind: "handle" });
    }

    // Ten that reach it. Each is answered for what it is.
    for (let i = 0; i < 10; i += 1) {
      expect(await completeOnboarding({ handle: other.handle, avatar: seedChoice }), `attempt ${i + 1}`).toMatchObject({
        ok: false,
        error: "That username is taken",
        kind: "handle",
      });
    }

    // The eleventh is asked to wait, in the limiter's own sentence, and writes nothing.
    const eleventh = await completeOnboarding({ handle: freshHandle("n"), avatar: seedChoice });
    expect(eleventh).toMatchObject({ ok: false, kind: "limited" });
    expect(eleventh.ok ? "" : eleventh.error).toMatch(/^Slow down — try again in \d+ seconds?\.$/);
    expect(await row(me.id)).toEqual(me);

    // A locally refused name is still answered for what it is while waiting.
    expect(await completeOnboarding({ handle: "a", avatar: seedChoice })).toMatchObject({ kind: "handle" });

    // Another account has its own allowance.
    const next = await signedIn();
    expect(await completeOnboarding({ handle: next.handle, avatar: seedChoice })).toMatchObject({ ok: true });
  });

  it("says every refusal in one line of the card", async () => {
    const other = await someoneElse();
    await signedIn();
    const refusals = [
      await completeOnboarding({ handle: "a", avatar: seedChoice }),
      await completeOnboarding({ handle: "support", avatar: seedChoice }),
      await completeOnboarding({ handle: other.handle, avatar: seedChoice }),
      await completeOnboarding({ handle: freshHandle("n"), avatar: { kind: "photo" } }),
    ];
    force.free = true;
    refusals.push(await completeOnboarding({ handle: other.handle, avatar: seedChoice }));
    for (const refusal of refusals) {
      expect(refusal.ok).toBe(false);
      if (!refusal.ok) expect(refusal.error.length, refusal.error).toBeLessThanOrEqual(44);
    }
  });
});

describe("checkHandle", () => {
  it("answers nothing to somebody who is not signed in", async () => {
    force.checkThrows = true;
    expect(await checkHandle("anyone")).toEqual({ ok: false, error: "Sign in first" });
  });

  it("answers each status, echoing the name it is about", async () => {
    const other = await someoneElse();
    await signedIn();
    const free = freshHandle("f");
    expect(await checkHandle(free)).toEqual({ ok: true, data: { handle: free, status: "available" } });
    expect(await checkHandle(other.handle)).toEqual({ ok: true, data: { handle: other.handle, status: "taken" } });
    expect(await checkHandle("support")).toEqual({ ok: true, data: { handle: "support", status: "reserved" } });
    expect(await checkHandle("my-name")).toEqual({ ok: true, data: { handle: "my-name", status: "invalid" } });
    expect(await checkHandle("a")).toEqual({ ok: true, data: { handle: "a", status: "invalid" } });
  });

  it("calls the account's own username available, reserved or not", async () => {
    const me = await signedIn({ handle: "staff" });
    expect(await checkHandle("staff")).toEqual({ ok: true, data: { handle: "staff", status: "available" } });
    expect(await checkHandle(" STAFF ")).toEqual({ ok: true, data: { handle: "staff", status: "available" } });
    expect(await checkHandle("root")).toEqual({ ok: true, data: { handle: "root", status: "reserved" } });
    expect((await row(me.id)).handle).toBe("staff");
  });

  it("checks the name as it would be kept: trimmed and lowercase", async () => {
    const other = await someoneElse();
    await signedIn();
    expect(await checkHandle(`  ${other.handle.toUpperCase()} `)).toEqual({
      ok: true,
      data: { handle: other.handle, status: "taken" },
    });
  });

  it("calls a held name taken for everyone but the account that gave it up", async () => {
    const other = await someoneElse();
    const theirs = freshHandle("g");
    await hold(theirs, other.userId);
    const me = await signedIn();
    const mine = freshHandle("g");
    await hold(mine, me.id);
    expect(await checkHandle(theirs)).toEqual({ ok: true, data: { handle: theirs, status: "taken" } });
    expect(await checkHandle(mine)).toEqual({ ok: true, data: { handle: mine, status: "available" } });
  });

  it("calls what is not a name invalid, without reading it", async () => {
    await signedIn();
    force.checkThrows = true;
    for (const input of [42, null, undefined, { handle: "x" }, ["x"], "x".repeat(65), "x".repeat(100_000)]) {
      expect(await checkHandle(input as never)).toEqual({ ok: true, data: { handle: "", status: "invalid" } });
    }
  });

  it("writes nothing", async () => {
    const me = await signedIn();
    const free = freshHandle("f");
    await checkHandle(free);
    expect(await row(me.id)).toEqual(me);
    expect(await heldBy(free)).toBeUndefined();
  });

  it("spends the allowance only on a name it has to look up, and then cannot check", async () => {
    const me = await signedIn();
    // Answered by the rules, or the caller's own: none of these is counted.
    for (let i = 0; i < 60; i += 1) {
      await checkHandle("a");
      await checkHandle("support");
      await checkHandle(me.handle);
    }
    for (let i = 0; i < 40; i += 1) {
      expect(await checkHandle(freshHandle("f")), `check ${i + 1}`).toMatchObject({ ok: true, data: { status: "available" } });
    }
    const refused = await checkHandle(freshHandle("f"));
    expect(refused.ok).toBe(false);
    // What the rules can answer is still answered.
    expect(await checkHandle("support")).toMatchObject({ ok: true, data: { status: "reserved" } });
    expect(await checkHandle(me.handle)).toMatchObject({ ok: true, data: { status: "available" } });
    // The save has its own allowance: a person who typed a great deal can still continue.
    expect(await completeOnboarding({ handle: me.handle, avatar: seedChoice })).toMatchObject({ ok: true });
  });

  it("cannot check when the database does not answer, and does not throw", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await signedIn();
    force.checkThrows = true;
    expect(await checkHandle(freshHandle("f"))).toEqual({ ok: false, error: "Could not check" });
    expect(logged).toHaveBeenCalledTimes(1);
  });
});

describe("neither action re-renders the page it was called from", () => {
  const source = readFileSync(path.join(process.cwd(), "src/server/actions/onboarding.ts"), "utf8");

  it("never calls revalidatePath, revalidateTag, updateTag or refresh", async () => {
    const other = await someoneElse();
    const me = await signedIn();
    await checkHandle(freshHandle("f"));
    await checkHandle(other.handle);
    await completeOnboarding({ handle: other.handle, avatar: seedChoice });
    await completeOnboarding({ handle: freshHandle("n"), avatar: seedChoice });
    await signInAs(me.id);
    await completeOnboarding({ handle: freshHandle("n"), avatar: seedChoice });
    for (const call of Object.values(cache)) expect(call).not.toHaveBeenCalled();
  });

  it("imports nothing from Next: no cache call, no cookie, no redirect", () => {
    expect(source).not.toMatch(/from\s+["']next\//);
  });

  it("starts each action with the session", () => {
    const actions = source.match(/^export async function \w+/gm) ?? [];
    const guarded = source.match(/^export async function \w+\(.*\{\n {2}const session = await getSession\(\);/gm) ?? [];
    expect(actions.map((line) => line.replace("export async function ", ""))).toEqual(["checkHandle", "completeOnboarding"]);
    expect(guarded).toHaveLength(actions.length);
  });
});
