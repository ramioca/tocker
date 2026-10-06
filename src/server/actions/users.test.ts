/**
 * `updateProfile` and the names it refuses.
 *
 * A handle is the name on a comment notification in someone else's inbox, so the
 * interesting cases are the refusals: nobody renames themselves to the product, its
 * staff or its founder, and nobody carries those words in a display name. The other
 * half is that the rule only bites on a change, so an account that already holds such a
 * name is not locked out of its own profile form.
 *
 * `getSession` and `next/cache` are mocked because this is a server action; the rows
 * are real, against in-memory PGlite.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { setupTestDb } from "@/lib/agent/test-support";
import { FOUNDER_X } from "@/lib/contact";
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
  vi.unstubAllEnvs();
});

/** A user row, signed in as that user. */
async function signedIn(overrides: { handle?: string; displayName?: string | null; email?: string | null } = {}) {
  const userId = `did:privy:${nanoid(8)}`;
  const handle = overrides.handle ?? `u${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
  const displayName = overrides.displayName ?? null;
  const email = overrides.email ?? null;
  await db.insert(schema.users).values({ id: userId, handle, displayName, email });
  session = { userId, handle, displayName, avatarUrl: null, email };
  return { userId, handle };
}

async function row(userId: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return user;
}

describe("updateProfile: reserved handles", () => {
  it("refuses a rename to the product, staff words or the founder, in any case", async () => {
    const me = await signedIn();
    for (const handle of ["support", "Support", "ADMIN", "tocker", "Tocker_Team", "tockerhq", "_help_", "security1", "privy", FOUNDER_X.handle]) {
      const result = await updateProfile({ handle });
      expect(result, handle).toEqual({ ok: false, error: "That handle is reserved" });
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
    // The form sends the handle on every save, changed or not.
    const me = await signedIn({ handle: "staff" });
    expect(await updateProfile({ handle: "staff", bio: "Still here." })).toEqual({ ok: true, data: undefined });
    const saved = await row(me.userId);
    expect(saved?.handle).toBe("staff");
    expect(saved?.bio).toBe("Still here.");
  });

  it("does not let that account move to a different reserved handle", async () => {
    await signedIn({ handle: "moderator" });
    expect(await updateProfile({ handle: "root" })).toEqual({ ok: false, error: "That handle is reserved" });
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
    expect(await updateProfile({ handle: "tocker" })).toEqual({ ok: false, error: "That handle is reserved" });
  });
});
