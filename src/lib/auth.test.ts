/**
 * The handle a new account is given.
 *
 * Two rules, both about what a stranger can learn or pretend. The handle must not be
 * derived from the email address or the wallet (it is public before the person has
 * chosen anything), and it must never be a name that reads as the product, its staff or
 * its founder. Token verification is not exercised here: `handleCandidate` is pure and
 * `uniqueHandle` only reads `users` and the names held after a rename, against
 * in-memory PGlite. What the whole of sign-up stores is in `auth-signup.test.ts`.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { setupTestDb } from "@/lib/agent/test-support";
import { FOUNDER_X } from "@/lib/contact";
import { isReservedHandle } from "@/lib/reserved-handles";
import { handleCandidate, uniqueHandle } from "./auth";

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

async function takeHandle(handle: string): Promise<void> {
  await db.insert(schema.users).values({ id: `did:privy:${nanoid(8)}`, handle });
}

/** An account that used to be called `handle`, renamed, and so still holds the name. */
async function holdHandle(handle: string): Promise<void> {
  const userId = `did:privy:${nanoid(8)}`;
  await db.insert(schema.users).values({ id: userId, handle: `r${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}` });
  await db.insert(schema.retiredHandles).values({ handle, userId });
}

describe("handleCandidate", () => {
  it("never uses the email address", () => {
    const handle = handleCandidate({ email: "jane.doe1987@example.com", userId: "did:privy:cm3abc9x7k2q" });
    expect(handle).toBe("user9x7k2q");
    expect(handle).not.toContain("jane");
    expect(handle).not.toContain("doe");
    expect(handle).not.toContain("1987");
  });

  it("never uses the wallet address", () => {
    const evm = handleCandidate({ walletAddress: "0x8f3c2a9b41d7e6f05a12c3d4e5f60718293a4b5c", userId: "did:privy:cm3abc9x7k2q" });
    expect(evm).toBe("user9x7k2q");
    expect(evm).not.toContain("8f3c2a");
    const solana = handleCandidate({ walletAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", userId: "did:privy:cm3abc9x7k2q" });
    expect(solana).toBe("user9x7k2q");
    expect(solana).not.toContain("dezxaz");
  });

  it("gives the same answer whatever the email is, so a handle says nothing about one", () => {
    const userId = "did:privy:cm3abc9x7k2q";
    expect(handleCandidate({ email: "support@example.com", userId })).toBe(handleCandidate({ email: null, userId }));
  });

  it("reuses an X username, which its owner already made public", () => {
    expect(handleCandidate({ username: "Dex_Trades", email: "someone@example.com", userId: "did:privy:abc" })).toBe("dex_trades");
  });

  it("still returns a usable handle with nothing to go on", () => {
    expect(handleCandidate({})).toMatch(/^user[a-z0-9]{1,6}$/);
  });
});

describe("uniqueHandle", () => {
  it("returns a free handle unchanged and suffixes a taken one", async () => {
    const base = `h${nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
    expect(await uniqueHandle(base)).toBe(base);
    await takeHandle(base);
    expect(await uniqueHandle(base)).toBe(`${base}1`);
  });

  it("skips a name somebody gave up in a rename and still holds", async () => {
    // Links in other people's notifications still point at it, so a new account
    // arriving with that X username must not become it.
    const base = `h${nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
    await holdHandle(base);
    expect(await uniqueHandle(base)).toBe(`${base}1`);
    // Held and taken names are skipped alike, in one run of suffixes.
    await holdHandle(`${base}1`);
    await takeHandle(`${base}2`);
    expect(await uniqueHandle(base)).toBe(`${base}3`);
  });

  it("never hands out a reserved name, whatever the X username was", async () => {
    for (const base of ["support", "Admin", "tocker", "tocker_team", "TockerHQ", "_help_", "security1", FOUNDER_X.handle]) {
      const handle = await uniqueHandle(base);
      expect(isReservedHandle(handle), `${base} became ${handle}`).toBe(false);
      expect(handle.startsWith("trader"), `${base} became ${handle}`).toBe(true);
      // Taken, so the next reserved base has to move on to a suffix.
      await takeHandle(handle);
    }
  });

  it("does not leave a reserved word behind when it cuts a long root for the suffix", async () => {
    // 18 characters, not reserved as a whole; its first 17 are `support` and underscores,
    // which is what a taken root would be cut to before the number goes on.
    const base = "support__________x";
    expect(isReservedHandle(base)).toBe(false);
    const handle = await uniqueHandle(base);
    expect(handle.startsWith("trader")).toBe(true);
    expect(isReservedHandle(handle)).toBe(false);
  });
});
