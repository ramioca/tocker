/**
 * What sign-up stores for a new account, from the sign-in provider's record of it.
 *
 * Everything in that row is public the moment it is written, before the person has
 * chosen anything: the handle is an address, the display name is printed above it in the
 * feed, and the photo is fetched by every viewer's browser. So the cases are what is
 * left out: Google's name (nobody was asked), and the photo of an account that arrived
 * dressed as the product or its staff. And every new account, an X sign-in included,
 * starts with nothing chosen (`onboarded_at` null), which is what opens the first-run
 * screen once.
 *
 * `getSession` is the real code against in-memory PGlite. The cookie and Privy are
 * stand-ins: the token is the account's id, and the record is whatever the test set.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { LinkedAccount } from "@privy-io/node";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { setupTestDb } from "@/lib/agent/test-support";

const provider = vi.hoisted(() => ({
  token: null as string | null,
  accounts: new Map<string, unknown[]>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "privy-token" && provider.token ? { value: provider.token } : undefined),
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/privy", () => ({
  isPrivyConfigured: () => true,
  privy: () => ({
    users: () => ({ _get: async (id: string) => ({ linked_accounts: provider.accounts.get(id) ?? [] }) }),
    utils: () => ({ auth: () => ({ verifyAccessToken: async (token: string) => ({ user_id: token }) }) }),
  }),
}));

const { getSession, handleCandidate, identityToStore, profileHints } = await import("./auth");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "test-app");
  // No verification key, so the token goes to the stand-in above.
  vi.stubEnv("PRIVY_VERIFICATION_KEY", "");
}, 120_000);

afterEach(() => {
  provider.token = null;
  provider.accounts.clear();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const PHOTO = "https://pbs.twimg.com/profile_images/1234567890/face_normal.jpg";

const email = (address: string) => ({ type: "email", address });
const google = (address: string, name: string) => ({ type: "google_oauth", email: address, name, subject: "g-1" });
const x = (username: string, name: string, photo: string | null = PHOTO) => ({
  type: "twitter_oauth",
  username,
  name,
  profile_picture_url: photo,
  subject: "x-1",
});
const wallet = (address: string) => ({ type: "wallet", address, chain_type: "ethereum" });

/** A name no other test has used, as an X username would be typed. */
function freshName(): string {
  return `x${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
}

/** Sign in for the first time with these linked accounts; the session and the row it wrote. */
async function signUp(accounts: unknown[]) {
  const userId = `did:privy:${nanoid(12)}`;
  provider.accounts.set(userId, accounts);
  provider.token = userId;
  const session = await getSession();
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!session || !row) throw new Error("sign-up wrote no row");
  return { userId, session, row };
}

describe("a new account", () => {
  it("starts with nothing chosen, so it is asked once", async () => {
    const { session, row } = await signUp([email("jane.doe1987@example.com")]);
    expect(row.onboardedAt).toBeNull();
    expect(row.avatarSeed).toBeNull();
    // Strictly null, not absent: that is what opens the first-run screen.
    expect(session.onboardedAt).toBeNull();
    expect(session.avatarSeed).toBeNull();
    expect(row.handle).toMatch(/^user[a-z0-9]{6}$/);
    expect(row.displayName).toBeNull();
    expect(row.avatarUrl).toBeNull();
    expect(row.email).toBe("jane.doe1987@example.com");
  });

  it("is asked once even when it arrives from X with a name and a photo", async () => {
    const username = freshName();
    const { session, row } = await signUp([x(username.toUpperCase(), "Dex Trades")]);
    expect(row.handle).toBe(username);
    expect(row.displayName).toBe("Dex Trades");
    expect(row.avatarUrl).toBe(PHOTO);
    expect(row.avatarSeed).toBeNull();
    expect(row.onboardedAt).toBeNull();
    expect(session).toMatchObject({ handle: username, avatarUrl: PHOTO, avatarSeed: null, onboardedAt: null });
  });

  it("does not store the name on a Google account", async () => {
    const { userId, session, row } = await signUp([google("jane.doe1987@example.com", "Jane Doe")]);
    expect(row.displayName).toBeNull();
    expect(session.displayName).toBeNull();
    expect(row.bio).toBeNull();
    expect(row.email).toBe("jane.doe1987@example.com");
    // The handle is made from the account's id alone, so it says nothing of the name either.
    expect(row.handle).toBe(handleCandidate({ userId }));
  });

  it("keeps the X name when the account has Google linked as well", async () => {
    const username = freshName();
    const { row } = await signUp([google("jane@example.com", "Jane Doe"), x(username, "jd")]);
    expect(row.handle).toBe(username);
    expect(row.displayName).toBe("jd");
    expect(row.avatarUrl).toBe(PHOTO);
  });

  it("stores no name and no photo when the X name reads as staff", async () => {
    const username = freshName();
    const { row } = await signUp([x(username, "Tocker Support")]);
    expect(row.handle).toBe(username);
    expect(row.displayName).toBeNull();
    expect(row.avatarUrl).toBeNull();
  });

  it("stores no photo when the X username is one nobody may take", async () => {
    for (const username of ["Tocker_Help", "support", "admin1"]) {
      const { row } = await signUp([x(username, "Jane")]);
      expect(row.handle.startsWith("trader"), `${username} became ${row.handle}`).toBe(true);
      expect(row.avatarUrl, username).toBeNull();
      // The name is not one of the refused words, so it stays.
      expect(row.displayName, username).toBe("Jane");
    }
  });

  it("is not given a name somebody gave up in a rename", async () => {
    const username = freshName();
    const holder = await signUp([email("holder@example.com")]);
    await db.insert(schema.retiredHandles).values({ handle: username, userId: holder.userId });
    const { row } = await signUp([x(username, "Newcomer")]);
    expect(row.handle).toBe(`${username}1`);
  });

  it("is read back as it is on every later request, never written again", async () => {
    const { userId, row } = await signUp([wallet("0x8f3c2a9b41d7e6f05a12c3d4e5f60718293a4b5c")]);
    expect(row.handle).toMatch(/^user[a-z0-9]{6}$/);
    const chosen = new Date("2026-10-09T10:00:00.000Z");
    await db.update(schema.users).set({ handle: `c${row.handle}`, avatarSeed: "k3j9x0a1bz", onboardedAt: chosen }).where(eq(schema.users.id, userId));

    // The provider's record has changed since; it is only read at sign-up.
    provider.accounts.set(userId, [x(freshName(), "Someone Else")]);
    provider.token = userId;
    expect(await getSession()).toEqual({
      userId,
      handle: `c${row.handle}`,
      displayName: null,
      avatarUrl: null,
      avatarSeed: "k3j9x0a1bz",
      onboardedAt: chosen.toISOString(),
      email: null,
    });
  });

  it("has no session without a token", async () => {
    expect(await getSession()).toBeNull();
  });
});

describe("profileHints", () => {
  const hints = (accounts: unknown[]) => profileHints(accounts as LinkedAccount[]);

  it("reads the email from Google and nothing else", () => {
    expect(hints([google("jane@example.com", "Jane Doe")])).toEqual({
      email: "jane@example.com",
      username: null,
      displayName: null,
      avatarUrl: null,
      walletAddress: null,
    });
  });

  it("reads the username, the name and the photo from X", () => {
    expect(hints([x("Dex_Trades", "Dex", PHOTO), email("dex@example.com")])).toEqual({
      email: "dex@example.com",
      username: "Dex_Trades",
      displayName: "Dex",
      avatarUrl: PHOTO,
      walletAddress: null,
    });
  });

  it("keeps the first of each, and answers all nulls for an empty record", () => {
    expect(hints([email("first@example.com"), google("second@example.com", "Second")]).email).toBe("first@example.com");
    expect(hints([])).toEqual({ email: null, username: null, displayName: null, avatarUrl: null, walletAddress: null });
  });
});

describe("identityToStore", () => {
  it("keeps an ordinary X name and photo", () => {
    expect(identityToStore({ username: "dex_trades", displayName: "Dex", avatarUrl: PHOTO })).toEqual({
      displayName: "Dex",
      avatarUrl: PHOTO,
    });
  });

  it("drops the name and the photo together when the name reads as staff", () => {
    for (const displayName of ["Tocker Support", "Official Tocker", "site ADMIN"]) {
      expect(identityToStore({ username: "dex_trades", displayName, avatarUrl: PHOTO }), displayName).toEqual({
        displayName: null,
        avatarUrl: null,
      });
    }
  });

  it("drops the photo, and only the photo, when the username is reserved", () => {
    for (const username of ["tocker", "Tocker_HQ", "_support_", "admin1"]) {
      expect(identityToStore({ username, displayName: "Jane", avatarUrl: PHOTO }), username).toEqual({
        displayName: "Jane",
        avatarUrl: null,
      });
    }
  });

  it("stores null, not an empty string, when there is nothing", () => {
    expect(identityToStore({ username: null, displayName: null, avatarUrl: null })).toEqual({ displayName: null, avatarUrl: null });
    expect(identityToStore({ username: "dex", displayName: "", avatarUrl: "" })).toEqual({ displayName: null, avatarUrl: null });
  });
});
