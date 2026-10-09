/**
 * `updateProfile` and the names it refuses.
 *
 * A handle is the name on a comment notification in someone else's inbox, so the
 * interesting cases are the refusals: nobody renames themselves to the product, its
 * staff or its founder, and nobody carries those words in a display name. The other
 * half is that the rule only bites on a change, so an account that already holds such a
 * name is not locked out of its own profile form.
 *
 * Then what a rename leaves behind (the old name is held, so the links in other
 * people's notifications cannot be taken over) and the avatar: one of the generated
 * ones or none, and never a link.
 *
 * `getSession` and `next/cache` are mocked because this is a server action; the rows
 * are real, against in-memory PGlite.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { profilePayload, type ProfileDraft } from "@/components/settings/profile-model";
import { setupTestDb } from "@/lib/agent/test-support";
import { FOUNDER_X } from "@/lib/contact";
import { limiter } from "@/lib/security/rate-limit";
import { HELD_NAMES_MAX } from "@/server/queries/handles";
import type { Session } from "@/server/types";

let session: Session | null = null;

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));

const { updateProfile } = await import("./users");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

afterEach(() => {
  session = null;
  limiter.reset();
  vi.unstubAllEnvs();
});

/** A handle nobody has used: a letter, then eight letters or digits. */
function freshHandle(prefix = "u"): string {
  return `${prefix}${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
}

/** A user row, signed in as that user. */
async function signedIn(
  overrides: {
    handle?: string;
    displayName?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
    avatarSeed?: string | null;
    onboardedAt?: Date | null;
  } = {},
) {
  const userId = `did:privy:${nanoid(8)}`;
  const handle = overrides.handle ?? freshHandle();
  const displayName = overrides.displayName ?? null;
  const email = overrides.email ?? null;
  const avatarUrl = overrides.avatarUrl ?? null;
  const avatarSeed = overrides.avatarSeed ?? null;
  const onboardedAt = overrides.onboardedAt ?? null;
  await db.insert(schema.users).values({ id: userId, handle, displayName, email, avatarUrl, avatarSeed, onboardedAt });
  session = { userId, handle, displayName, avatarUrl, avatarSeed, onboardedAt: onboardedAt?.toISOString() ?? null, email };
  return { userId, handle, session };
}

async function row(userId: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return user;
}

/** Who holds a name that was given up, or undefined when nobody does. */
async function heldBy(handle: string): Promise<string | undefined> {
  const [held] = await db.select().from(schema.retiredHandles).where(eq(schema.retiredHandles.handle, handle)).limit(1);
  return held?.userId;
}

/** Every name an account holds, in no order. */
async function namesHeldBy(userId: string): Promise<string[]> {
  const held = await db.select().from(schema.retiredHandles).where(eq(schema.retiredHandles.userId, userId));
  return held.map((name) => name.handle);
}

describe("updateProfile: reserved handles", () => {
  it("refuses a rename to the product, staff words or the founder, in any case", async () => {
    const me = await signedIn();
    for (const handle of ["support", "Support", "ADMIN", "tocker", "Tocker_Team", "tockerhq", "_help_", "security1", "privy", FOUNDER_X.handle]) {
      const result = await updateProfile({ handle });
      expect(result, handle).toEqual({ ok: false, error: "That username is reserved" });
    }
    expect((await row(me.userId))?.handle).toBe(me.handle);
  });

  it("still lets an ordinary rename through", async () => {
    const me = await signedIn();
    const next = `n${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
    expect(await updateProfile({ handle: next })).toEqual({ ok: true, data: undefined });
    expect((await row(me.userId))?.handle).toBe(next);
  });

  it("lets an account that already holds a reserved handle keep saving its profile", async () => {
    // A save may carry the username unchanged.
    const me = await signedIn({ handle: "staff" });
    expect(await updateProfile({ handle: "staff", bio: "Still here." })).toEqual({ ok: true, data: undefined });
    const saved = await row(me.userId);
    expect(saved?.handle).toBe("staff");
    expect(saved?.bio).toBe("Still here.");
  });

  it("does not let that account move to a different reserved handle", async () => {
    await signedIn({ handle: "moderator" });
    expect(await updateProfile({ handle: "root" })).toEqual({ ok: false, error: "That username is reserved" });
  });
});

describe("updateProfile: display names", () => {
  const REFUSAL = { ok: false, error: "Display names can't include Tocker, official, support or admin" };

  it("refuses a name that reads as the product or its staff", async () => {
    const me = await signedIn();
    for (const displayName of ["Tocker Support", "tocker", "Official Tocker", "Site Admin", "customer SUPPORT"]) {
      expect(await updateProfile({ displayName }), displayName).toEqual(REFUSAL);
    }
    expect((await row(me.userId))?.displayName).toBeNull();
  });

  it("saves an ordinary name", async () => {
    const me = await signedIn();
    expect(await updateProfile({ displayName: "Mila K." })).toEqual({ ok: true, data: undefined });
    expect((await row(me.userId))?.displayName).toBe("Mila K.");
  });

  it("lets an account whose name already has one of the words save the rest of its profile", async () => {
    const me = await signedIn({ displayName: "Supportive Sam" });
    expect(await updateProfile({ displayName: "Supportive Sam", bio: "Unchanged name." })).toEqual({ ok: true, data: undefined });
    expect((await row(me.userId))?.bio).toBe("Unchanged name.");
    // A different name with the word in it is a change, and is refused.
    expect(await updateProfile({ displayName: "Support Sam" })).toEqual(REFUSAL);
  });

  it("leaves the words to the people in ADMIN_EMAILS, and to nobody else", async () => {
    vi.stubEnv("ADMIN_EMAILS", "founder@example.com");
    const admin = await signedIn({ email: "founder@example.com" });
    expect(await updateProfile({ displayName: "Tocker" })).toEqual({ ok: true, data: undefined });
    expect((await row(admin.userId))?.displayName).toBe("Tocker");

    await signedIn({ email: "someone@example.com" });
    expect(await updateProfile({ displayName: "Tocker" })).toEqual(REFUSAL);
  });

  it("gives an admin no pass on a reserved handle", async () => {
    vi.stubEnv("ADMIN_EMAILS", "founder@example.com");
    await signedIn({ email: "founder@example.com" });
    expect(await updateProfile({ handle: "tocker" })).toEqual({ ok: false, error: "That username is reserved" });
  });
});

describe("updateProfile: a rename holds the old name", () => {
  it("keeps the name that was given up for the account that gave it up", async () => {
    const me = await signedIn();
    const next = freshHandle("n");
    expect(await updateProfile({ handle: next })).toEqual({ ok: true, data: undefined });
    expect((await row(me.userId))?.handle).toBe(next);
    expect(await heldBy(me.handle)).toBe(me.userId);
    // The new name was never held, and still is not.
    expect(await heldBy(next)).toBeUndefined();
  });

  it("refuses the held name to everyone else, in the sentence for a taken one", async () => {
    const first = await signedIn();
    expect((await updateProfile({ handle: freshHandle("n") })).ok).toBe(true);

    const other = await signedIn();
    expect(await updateProfile({ handle: first.handle })).toEqual({ ok: false, error: "That username is taken" });
    expect((await row(other.userId))?.handle).toBe(other.handle);
    expect(await heldBy(first.handle)).toBe(first.userId);
  });

  it("lets its old owner take it back, and then holds the one they left", async () => {
    const me = await signedIn();
    const second = freshHandle("n");
    expect((await updateProfile({ handle: second })).ok).toBe(true);
    // The next request reads the row again, as `getSession` does.
    session = { ...me.session, handle: second };
    expect(await updateProfile({ handle: me.handle })).toEqual({ ok: true, data: undefined });
    expect((await row(me.userId))?.handle).toBe(me.handle);
    expect(await heldBy(me.handle)).toBeUndefined();
    expect(await heldBy(second)).toBe(me.userId);
  });

  it("holds nothing when the username is sent unchanged, or in another case", async () => {
    const me = await signedIn();
    expect((await updateProfile({ handle: me.handle, bio: "Same name." })).ok).toBe(true);
    expect((await updateProfile({ handle: `  ${me.handle.toUpperCase()} ` })).ok).toBe(true);
    expect((await row(me.userId))?.handle).toBe(me.handle);
    expect(await heldBy(me.handle)).toBeUndefined();
  });

  it("refuses a name another account has now", async () => {
    const taken = await signedIn();
    const me = await signedIn();
    expect(await updateProfile({ handle: taken.handle })).toEqual({ ok: false, error: "That username is taken" });
    expect((await row(me.userId))?.handle).toBe(me.handle);
    expect(await heldBy(me.handle)).toBeUndefined();
  });

  it("refuses a name the rules do not allow, in the sentence the forms say", async () => {
    await signedIn();
    for (const handle of ["a", "has-hyphen", "x".repeat(21), "dot.name", ""]) {
      expect(await updateProfile({ handle }), handle).toEqual({
        ok: false,
        error: "Usernames are 2–20 letters, numbers or _",
      });
    }
  });

  it("counts as choosing a username, so the first-run screen has nothing left to ask", async () => {
    const me = await signedIn();
    expect((await row(me.userId))?.onboardedAt).toBeNull();
    // Saving the rest of the profile under the assigned name is not choosing one.
    expect((await updateProfile({ handle: me.handle, bio: "Hello." })).ok).toBe(true);
    expect((await row(me.userId))?.onboardedAt).toBeNull();

    expect((await updateProfile({ handle: freshHandle("n") })).ok).toBe(true);
    expect((await row(me.userId))?.onboardedAt).toBeInstanceOf(Date);
  });

  it("leaves the date of an account that had already chosen", async () => {
    const chosen = new Date("2026-09-01T09:00:00.000Z");
    const me = await signedIn({ onboardedAt: chosen });
    expect((await updateProfile({ handle: freshHandle("n") })).ok).toBe(true);
    expect((await row(me.userId))?.onboardedAt?.toISOString()).toBe(chosen.toISOString());
  });
});

describe("updateProfile: an account's own name is its own", () => {
  it("saves the rest of the profile when a hold on its name was left under someone else", async () => {
    // Two renames crossed: another account gave this name up, this one took it before
    // the hold was written, and the hold then landed under the other account.
    const other = await signedIn();
    const me = await signedIn();
    await db.insert(schema.retiredHandles).values({ handle: me.handle, userId: other.userId });

    expect(await updateProfile({ handle: me.handle, displayName: "Mila K.", bio: "Still mine." })).toEqual({
      ok: true,
      data: undefined,
    });
    const saved = await row(me.userId);
    expect(saved?.handle).toBe(me.handle);
    expect(saved?.displayName).toBe("Mila K.");
    expect(saved?.bio).toBe("Still mine.");
    // Nothing was renamed, so nothing was held or let go.
    expect(await heldBy(me.handle)).toBe(other.userId);
  });

  it("still refuses a name somebody else holds to an account that does not have it", async () => {
    const other = await signedIn();
    const given = freshHandle("g");
    await db.insert(schema.retiredHandles).values({ handle: given, userId: other.userId });
    const me = await signedIn();
    expect(await updateProfile({ handle: given })).toEqual({ ok: false, error: "That username is taken" });
    expect((await row(me.userId))?.handle).toBe(me.handle);
  });
});

describe("updateProfile: a form that was open while the first-run card saved", () => {
  it("does not rename the account back to the name the form was opened with", async () => {
    // The account was `old` when Settings rendered. The first-run card, open over it,
    // saved `chosen` and holds `old`. The form behind was never remounted.
    const old = freshHandle("user");
    const chosen = freshHandle("n");
    const me = await signedIn({ handle: chosen, onboardedAt: new Date() });
    await db.insert(schema.retiredHandles).values({ handle: old, userId: me.userId });
    const opened: ProfileDraft = { handle: old, displayName: "", bio: "", avatar: null };

    expect(await updateProfile(profilePayload({ ...opened, bio: "hello" }, opened))).toEqual({ ok: true, data: undefined });

    const saved = await row(me.userId);
    expect(saved?.handle).toBe(chosen);
    expect(saved?.bio).toBe("hello");
    expect(await heldBy(old)).toBe(me.userId);
    expect(await heldBy(chosen)).toBeUndefined();
  });
});

describe("updateProfile: one account cannot hold names without end", () => {
  it(`holds only the newest ${HELD_NAMES_MAX} names an account gave up, and frees the rest`, async () => {
    const me = await signedIn();
    // Three it gave up before, oldest first.
    const earlier = [freshHandle("a"), freshHandle("b"), freshHandle("c")];
    await db.insert(schema.retiredHandles).values(
      earlier.map((handle, index) => ({ handle, userId: me.userId, retiredAt: new Date(Date.UTC(2026, 8, index + 1)) })),
    );

    expect((await updateProfile({ handle: freshHandle("n") })).ok).toBe(true);

    // The one just given up, and the two newest before it.
    expect((await namesHeldBy(me.userId)).sort()).toEqual([me.handle, earlier[1], earlier[2]].sort());
    expect(HELD_NAMES_MAX).toBe(3);

    // The oldest is anybody's again.
    const other = await signedIn();
    expect(await updateProfile({ handle: earlier[0] })).toEqual({ ok: true, data: undefined });
    expect((await row(other.userId))?.handle).toBe(earlier[0]);
    // And the newest is not.
    expect(await updateProfile({ handle: earlier[2] })).toEqual({ ok: false, error: "That username is taken" });
  });

  it("never lets go of another account's names", async () => {
    const other = await signedIn();
    const theirs = [freshHandle("t"), freshHandle("t"), freshHandle("t"), freshHandle("t")];
    await db.insert(schema.retiredHandles).values(theirs.map((handle) => ({ handle, userId: other.userId })));

    await signedIn();
    expect((await updateProfile({ handle: freshHandle("n") })).ok).toBe(true);
    expect((await namesHeldBy(other.userId)).sort()).toEqual([...theirs].sort());
  });

  it("holds a bounded number however often one account renames", async () => {
    const me = await signedIn();
    let current = me.handle;
    for (let i = 0; i < 12; i += 1) {
      // Each as its own minute: the pace of renames is the next test's.
      limiter.reset();
      session = { ...me.session, handle: current };
      const next = freshHandle("n");
      expect((await updateProfile({ handle: next })).ok, `rename ${i + 1}`).toBe(true);
      current = next;
      expect((await namesHeldBy(me.userId)).length).toBeLessThanOrEqual(HELD_NAMES_MAX);
    }
    expect(await namesHeldBy(me.userId)).toHaveLength(HELD_NAMES_MAX);
  });

  it("paces renames: five in a minute, then the account is asked to wait", async () => {
    const me = await signedIn();
    let current = me.handle;
    for (let i = 0; i < 5; i += 1) {
      session = { ...me.session, handle: current };
      const next = freshHandle("n");
      expect(await updateProfile({ handle: next }), `rename ${i + 1}`).toEqual({ ok: true, data: undefined });
      current = next;
    }
    session = { ...me.session, handle: current };
    const sixth = await updateProfile({ handle: freshHandle("n"), bio: "Not saved." });
    expect(sixth.ok).toBe(false);
    expect(sixth.ok ? "" : sixth.error).toMatch(/^Slow down — try again in \d+ seconds?\.$/);
    // Nothing of that save was written.
    const after = await row(me.userId);
    expect(after?.handle).toBe(current);
    expect(after?.bio).toBeNull();

    // The rest of the profile still saves, with the name unchanged or left out.
    expect((await updateProfile({ handle: current, bio: "Saved." })).ok).toBe(true);
    expect((await updateProfile({ displayName: "Mila K." })).ok).toBe(true);
    // Another account has its own allowance.
    await signedIn();
    expect((await updateProfile({ handle: freshHandle("n") })).ok).toBe(true);
  });

  it("counts only a rename that is about to be written", async () => {
    const taken = await signedIn();
    const me = await signedIn();
    // Refused for the name, or for something else in the same save: far more than the allowance.
    for (let i = 0; i < 8; i += 1) {
      expect((await updateProfile({ handle: taken.handle })).ok).toBe(false);
      expect((await updateProfile({ handle: "support" })).ok).toBe(false);
      expect((await updateProfile({ handle: freshHandle("n"), bio: "x".repeat(281) })).ok).toBe(false);
      expect((await updateProfile({ handle: me.handle, bio: `Unchanged name, save ${i}.` })).ok).toBe(true);
    }
    expect(await updateProfile({ handle: freshHandle("n") })).toEqual({ ok: true, data: undefined });
  });
});

describe("updateProfile: the avatar", () => {
  const REFUSAL = { ok: false, error: "That avatar is not available. Pick another." };
  const PHOTO = "https://pbs.twimg.com/profile_images/1234567890/face_normal.jpg";

  it("sets one of the generated avatars", async () => {
    const me = await signedIn();
    expect(await updateProfile({ avatarSeed: "k3j9x0a1bz" })).toEqual({ ok: true, data: undefined });
    expect((await row(me.userId))?.avatarSeed).toBe("k3j9x0a1bz");
  });

  it("clears it with null, which goes back to the photo", async () => {
    const me = await signedIn({ avatarSeed: "k3j9x0a1bz", avatarUrl: PHOTO });
    expect(await updateProfile({ avatarSeed: null })).toEqual({ ok: true, data: undefined });
    const saved = await row(me.userId);
    expect(saved?.avatarSeed).toBeNull();
    expect(saved?.avatarUrl).toBe(PHOTO);
  });

  it("leaves it alone when the save does not mention it", async () => {
    const me = await signedIn({ avatarSeed: "k3j9x0a1bz" });
    expect((await updateProfile({ bio: "Only the bio." })).ok).toBe(true);
    expect((await row(me.userId))?.avatarSeed).toBe("k3j9x0a1bz");
  });

  it("refuses anything that is not a seed the picker makes", async () => {
    const me = await signedIn({ avatarSeed: "k3j9x0a1bz" });
    const typed = ["", "short", "UPPERCASE1", "eleven_char", "abcdefghijk", "hello world", "https://example.com/a.png", me.handle];
    for (const avatarSeed of typed) {
      expect(await updateProfile({ avatarSeed }), avatarSeed).toEqual(REFUSAL);
    }
    // Not a string at all: what a hand-made request could send.
    for (const avatarSeed of [42, { seed: "k3j9x0a1bz" }, ["k3j9x0a1bz"]]) {
      expect(await updateProfile({ avatarSeed: avatarSeed as unknown as string })).toEqual(REFUSAL);
    }
    expect((await row(me.userId))?.avatarSeed).toBe("k3j9x0a1bz");
  });

  it("writes nothing else when the avatar is refused", async () => {
    const me = await signedIn();
    expect(await updateProfile({ bio: "Not saved.", avatarSeed: "nope" })).toEqual(REFUSAL);
    expect((await row(me.userId))?.bio).toBeNull();
  });

  it("ignores a photo link: nobody can point their avatar at an address of their choosing", async () => {
    const me = await signedIn({ avatarUrl: PHOTO });
    const sent = { bio: "With a link.", avatarUrl: "https://example.com/tracker.gif" } as unknown as Parameters<typeof updateProfile>[0];
    expect(await updateProfile(sent)).toEqual({ ok: true, data: undefined });
    const saved = await row(me.userId);
    expect(saved?.avatarUrl).toBe(PHOTO);
    expect(saved?.bio).toBe("With a link.");

    const none = await signedIn();
    expect((await updateProfile(sent)).ok).toBe(true);
    expect((await row(none.userId))?.avatarUrl).toBeNull();
  });
});
