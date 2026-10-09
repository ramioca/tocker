"use server";
/**
 * The first-run screen's two calls: is this username free, and save the choice.
 *
 * Neither calls `revalidatePath` or `refresh`, or touches a cookie. Each of those makes
 * Next re-render the current route inside the action's own response: on every keystroke
 * for the check, and for the whole of "Saving…" for the save. The screen refreshes the
 * page itself once it has the answer, without waiting for it.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { agents, getDb, users, type Db } from "@/db";
import { getSession } from "@/lib/auth";
import { AVATAR_REFUSED, AVATAR_SEED_RE, photoAt, type AvatarChoice } from "@/lib/avatar";
import { HANDLE_INVALID, HANDLE_TAKEN, handleProblem, handleProblemSentence, normalizeHandle, type HandleStatus } from "@/lib/handles";
import { dbErrorForLog } from "@/lib/security/redact";
import { holdRetiredHandle, isHandleTaken } from "@/server/queries/handles";
import type { ActionResult } from "@/server/types";
import { slowDown } from "./_shared";

/** The check runs as the person types, a third of a second after each pause. */
const CHECK_LIMIT = { limit: 40, windowMs: 60_000 } as const;
/** A save that reaches the database. Ten a minute is more than a person choosing a name makes. */
const SAVE_LIMIT = { limit: 10, windowMs: 60_000 } as const;
/** Longer than any username, short enough that nothing below reads a megabyte. */
const MAX_INPUT = 64;

const RACED = "Someone just took that name. Try another.";
const SAVE_FAILED = "Could not save. Try again.";

/**
 * What a save answers. `kind` says where the sentence belongs and what the screen does
 * next: under the field, under the tiles, wait, sign in again, or offer a way out.
 */
export type OnboardingResult =
  | { ok: true; data: { handle: string; avatarSeed: string | null; hasAgents: boolean; already: boolean } }
  | { ok: false; error: string; kind: "handle" | "avatar" | "limited" | "signed-out" | "failed" };

const avatarSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("photo") }),
  z.object({ kind: z.literal("seed"), seed: z.string().max(MAX_INPUT) }),
]);
const inputSchema = z.object({ handle: z.string().max(MAX_INPUT), avatar: z.unknown() });

/** Postgres's code for a unique index refusing a row. Drizzle wraps the driver's error. */
function isUniqueViolation(err: unknown): boolean {
  const code = (value: unknown) => (value as { code?: unknown } | null | undefined)?.code;
  return code(err) === "23505" || code((err as { cause?: unknown } | null | undefined)?.cause) === "23505";
}

/**
 * Does this account own an agent? The server's answer decides whether the second screen
 * ("Build your first agent") is shown. Asked after the save has been written, so a failed
 * read answers no rather than telling someone their saved name was not saved.
 */
async function ownsAgent(db: Db, userId: string): Promise<boolean> {
  try {
    const [owned] = await db.select({ id: agents.id }).from(agents).where(eq(agents.ownerId, userId)).limit(1);
    return Boolean(owned);
  } catch (err) {
    console.error("[completeOnboarding] could not count agents", dbErrorForLog(err));
    return false;
  }
}

/**
 * Can this account have this username? Asked as the person types.
 *
 * The answer echoes the name it is about, normalised, so the field can drop an answer
 * for a name that is no longer in it. A name the rules refuse, and the caller's own,
 * are answered without the database or the limiter. Out of allowance it answers
 * `ok: false`, which the field shows as "Could not check": the save checks again.
 */
export async function checkHandle(handle: string): Promise<ActionResult<{ handle: string; status: HandleStatus }>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first" };

  const parsed = z.string().max(MAX_INPUT).safeParse(handle);
  if (!parsed.success) return { ok: true, data: { handle: "", status: "invalid" } };
  const name = normalizeHandle(parsed.data);
  const problem = handleProblem(name, session.handle);
  if (problem) return { ok: true, data: { handle: name, status: problem } };
  if (name === session.handle) return { ok: true, data: { handle: name, status: "available" } };

  const limited = slowDown("handle-check", session.userId, CHECK_LIMIT);
  if (limited) return { ok: false, error: limited };

  try {
    const taken = await isHandleTaken(await getDb(), name, session.userId);
    return { ok: true, data: { handle: name, status: taken ? "taken" : "available" } };
  } catch (err) {
    console.error("[checkHandle]", dbErrorForLog(err));
    return { ok: false, error: "Could not check" };
  }
}

/**
 * Save the first-run screen: the username, the avatar, and the fact that it was done.
 *
 * Once per account. The update is guarded on `onboarded_at IS NULL`, so a second tab's
 * Continue, sent with whatever that tab was prefilled with, writes nothing and is told
 * `already`: the first choice stands. `avatar_url` and `display_name` are never
 * changed here. The screen acts on `kind`, never on the sentence.
 */
export async function completeOnboarding(input: { handle: string; avatar: AvatarChoice }): Promise<OnboardingResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first", kind: "signed-out" };

  // Everything that can be refused without the database, first: none of it uses the
  // limiter, so ten mistyped names do not lock anyone out of the eleventh.
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: HANDLE_INVALID, kind: "handle" };
  const handle = normalizeHandle(parsed.data.handle);
  const problem = handleProblem(handle, session.handle);
  if (problem) return { ok: false, error: handleProblemSentence(problem), kind: "handle" };
  const avatar = avatarSchema.safeParse(parsed.data.avatar);
  if (!avatar.success) return { ok: false, error: AVATAR_REFUSED, kind: "avatar" };
  // "Your photo" is only a choice for an account that has one the app will show.
  const usable =
    avatar.data.kind === "photo" ? photoAt(session.avatarUrl, 96) !== null : AVATAR_SEED_RE.test(avatar.data.seed);
  if (!usable) return { ok: false, error: AVATAR_REFUSED, kind: "avatar" };
  const avatarSeed = avatar.data.kind === "seed" ? avatar.data.seed : null;

  const limited = slowDown("onboarding", session.userId, SAVE_LIMIT);
  if (limited) return { ok: false, error: limited, kind: "limited" };

  try {
    const db = await getDb();
    // Asked only of a change. The name the account already has is its own to keep, even
    // when a hold on it was left under someone else by a rename that crossed with its own.
    if (handle !== session.handle && (await isHandleTaken(db, handle, session.userId))) {
      return { ok: false, error: HANDLE_TAKEN, kind: "handle" };
    }

    const now = new Date();
    let saved: { handle: string } | undefined;
    try {
      [saved] = await db
        .update(users)
        .set({ handle, avatarSeed, onboardedAt: now, updatedAt: now })
        .where(and(eq(users.id, session.userId), isNull(users.onboardedAt)))
        .returning({ handle: users.handle });
    } catch (err) {
      // Free when it was checked a moment ago, and taken by the time of the write.
      if (isUniqueViolation(err)) return { ok: false, error: RACED, kind: "handle" };
      throw err;
    }

    if (!saved) {
      // Already onboarded, in another tab or on another device. Nothing is written.
      const [row] = await db
        .select({ handle: users.handle, avatarSeed: users.avatarSeed })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);
      if (!row) return { ok: false, error: SAVE_FAILED, kind: "failed" };
      return {
        ok: true,
        data: { handle: row.handle, avatarSeed: row.avatarSeed, hasAgents: await ownsAgent(db, session.userId), already: true },
      };
    }

    if (saved.handle !== session.handle) {
      try {
        await holdRetiredHandle(db, session.userId, session.handle, saved.handle);
      } catch (err) {
        // The save stands. The old name is merely free, as a rename left it before names were held.
        console.error("[completeOnboarding] could not hold the old name", dbErrorForLog(err));
      }
    }

    return {
      ok: true,
      data: { handle: saved.handle, avatarSeed, hasAgents: await ownsAgent(db, session.userId), already: false },
    };
  } catch (err) {
    console.error("[completeOnboarding]", dbErrorForLog(err));
    return { ok: false, error: SAVE_FAILED, kind: "failed" };
  }
}
