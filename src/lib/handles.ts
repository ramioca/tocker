/**
 * What a username may be, and the sentences said when it may not.
 *
 * A leaf module like `reserved-handles` (its one import): no React and nothing from the
 * server, so the first-run screen, the Settings form, `updateProfile`, the onboarding
 * actions and sign-up all apply one rule and say one sentence.
 *
 * It is "username" wherever a person reads it and "handle" in code.
 */
import { HANDLE_RESERVED, isReservedHandle } from "@/lib/reserved-handles";

/** Two to twenty lowercase letters, digits or underscores. */
export const HANDLE_RE = /^[a-z0-9_]{2,20}$/;

export const HANDLE_INVALID = "Usernames are 2–20 letters, numbers or _";
export const HANDLE_TAKEN = "That username is taken";

/** What the rules alone can say against a name, without asking the database. */
export type HandleProblem = "invalid" | "reserved";

/** What the live check answers about a name as it is typed (`checkHandle`). */
export type HandleStatus = "available" | "taken" | HandleProblem;

/** A username as it is stored: no surrounding space, lowercase. */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Why a normalised username cannot be saved, before anyone asks the database, or null.
 *
 * `current` is the account's own username, which is never a problem: the first-run
 * screen sends it when it is kept, and a save may carry it unchanged, so an account that
 * already holds a reserved name must still be able to keep it and save the rest.
 */
export function handleProblem(handle: string, current: string | null): HandleProblem | null {
  if (current !== null && handle === current) return null;
  if (!HANDLE_RE.test(handle)) return "invalid";
  return isReservedHandle(handle) ? "reserved" : null;
}

/** The sentence for a problem, the same under every field that takes a username. */
export function handleProblemSentence(problem: HandleProblem): string {
  return problem === "reserved" ? HANDLE_RESERVED : HANDLE_INVALID;
}
