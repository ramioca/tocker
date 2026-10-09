import "server-only";
import { and, desc, eq, ne, notInArray } from "drizzle-orm";
import { retiredHandles, users, type Db } from "@/db";

/**
 * How many given-up names one account holds: the newest. Enough to keep the links in
 * other people's notifications from being taken over after a rename or two. Without a
 * bound, an account renaming in a loop could put any number of names out of everyone
 * else's reach, and nothing would ever give them back.
 */
export const HELD_NAMES_MAX = 3;

/**
 * Is this username somebody else's?
 *
 * The one meaning of "taken", wherever a name is checked: the first-run screen, the
 * Settings form, the live check as someone types, and sign-up. A name is taken when
 * another account has it now, or gave it up in a rename and so still holds it
 * (`retired_handles`). `userId` is the account asking, whose own names are never taken
 * from it; null at sign-up, where there is no account yet.
 *
 * Two reads, each on a unique index.
 */
export async function isHandleTaken(db: Db, handle: string, userId: string | null): Promise<boolean> {
  const [used] = await db
    .select({ id: users.id })
    .from(users)
    .where(userId === null ? eq(users.handle, handle) : and(eq(users.handle, handle), ne(users.id, userId)))
    .limit(1);
  if (used) return true;
  const [held] = await db
    .select({ handle: retiredHandles.handle })
    .from(retiredHandles)
    .where(
      userId === null
        ? eq(retiredHandles.handle, handle)
        : and(eq(retiredHandles.handle, handle), ne(retiredHandles.userId, userId)),
    )
    .limit(1);
  return Boolean(held);
}

/**
 * After a rename: hold the name that was given up, stop holding the new one if this
 * account had held it (someone going back to a name they used before), and let go of
 * all but the newest `HELD_NAMES_MAX` it holds. A name let go is free for anyone.
 *
 * The caller logs and ignores a failure. The old name is then merely free, which is
 * what a rename did before names were held.
 */
export async function holdRetiredHandle(db: Db, userId: string, from: string, to: string): Promise<void> {
  if (from === to) return;
  // One clock for every row, the app's, so "newest" below means the same for all of them.
  const retiredAt = new Date();
  await db
    .insert(retiredHandles)
    .values({ handle: from, userId, retiredAt })
    .onConflictDoUpdate({ target: retiredHandles.handle, set: { userId, retiredAt } });
  await db.delete(retiredHandles).where(and(eq(retiredHandles.handle, to), eq(retiredHandles.userId, userId)));

  // The name just given up always stays, whatever the clock says of the others.
  const others = and(eq(retiredHandles.userId, userId), ne(retiredHandles.handle, from));
  const newestOthers = db
    .select({ handle: retiredHandles.handle })
    .from(retiredHandles)
    .where(others)
    .orderBy(desc(retiredHandles.retiredAt), retiredHandles.handle)
    .limit(HELD_NAMES_MAX - 1);
  await db.delete(retiredHandles).where(and(others, notInArray(retiredHandles.handle, newestOthers)));
}
