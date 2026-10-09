/**
 * What the first-run card does with the answer to its save, outside the component so it
 * can be tested. No React. The card acts on the answer's `kind`, never on its sentence:
 * the sentence is only ever shown.
 */
import { signInHref } from "@/components/auth/login-helpers";
import type { AvatarChoice } from "@/lib/avatar";
import type { OnboardingResult } from "@/server/actions/onboarding";

/** Said when the request itself failed and there is no answer to read a sentence from. */
export const SAVE_FAILED = "Could not save. Try again.";

/** Who the account is once the first screen is done: what the header shows from the second screen on. */
export interface Identity {
  handle: string;
  avatarSeed: string | null;
}

export type SaveOutcome =
  /** Saved. An account with no agent goes on to "How it works", the second screen; any other is done. */
  | { kind: "saved"; identity: Identity; then: "screen-2" | "close" }
  /**
   * Not saved, and why, under the field or under the avatars. `focus` is where the
   * keyboard goes back to: the field, with its text selected, when the choice itself was
   * refused; the button when the same choice is worth sending again. `wayOut` puts
   * "Not now" on the card: a request that keeps failing must not lock anyone out of the app.
   */
  | { kind: "refused"; under: "field" | "tiles"; sentence: string; focus: "field" | "button"; wayOut: boolean }
  /** The session ended while the card was open. */
  | { kind: "sign-in" };

/** `"threw"` is a call that never answered: offline, or the server fell over. */
export function saveOutcome(result: OnboardingResult | "threw"): SaveOutcome {
  if (result === "threw") {
    return { kind: "refused", under: "tiles", sentence: SAVE_FAILED, focus: "button", wayOut: true };
  }
  if (result.ok) {
    const { handle, avatarSeed, hasAgents, already } = result.data;
    // `already`: another tab got there first. This tab's choice was not written, so it
    // shows what was, and has nothing more to ask.
    return { kind: "saved", identity: { handle, avatarSeed }, then: hasAgents || already ? "close" : "screen-2" };
  }
  switch (result.kind) {
    case "handle":
      return { kind: "refused", under: "field", sentence: result.error, focus: "field", wayOut: false };
    case "avatar":
      return { kind: "refused", under: "tiles", sentence: result.error, focus: "field", wayOut: false };
    case "limited":
      // Nothing was wrong with the choice: the same press works once the minute is up.
      return { kind: "refused", under: "tiles", sentence: result.error, focus: "button", wayOut: false };
    case "signed-out":
      return { kind: "sign-in" };
    case "failed":
      return { kind: "refused", under: "tiles", sentence: result.error, focus: "button", wayOut: true };
  }
}

/** A preview's Continue: the same step forward, with nothing sent and nothing written. */
export function previewOutcome(handle: string, avatar: AvatarChoice): SaveOutcome {
  return {
    kind: "saved",
    identity: { handle, avatarSeed: avatar.kind === "seed" ? avatar.seed : null },
    then: "screen-2",
  };
}

/**
 * Where the page behind the card has to move after a rename, or null. A person's own
 * profile is the one page whose address is their username: left alone it would be a
 * "not found" page the moment the card closes.
 */
export function pageAfterRename(pathname: string, from: string, to: string): string | null {
  if (from === to) return null;
  return pathname === `/u/${from}` ? `/u/${to}` : null;
}

/** Sign-in, with the way back to the page the card was open over. */
export function signInAgainHref(pathname: string, search: string): string {
  return signInHref(`${pathname}${search}`);
}
