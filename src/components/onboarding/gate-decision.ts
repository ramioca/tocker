/**
 * What the onboarding gate starts, outside the component so it can be tested: the
 * first-run screens (choose a username and avatar, then build an agent), a preview of
 * them, the separate "your agents have no key" prompt, or nothing. No React.
 *
 * The server decides the first-run flow (`users.onboarded_at`, read by the app layout),
 * so it is the same answer on every device and it is in the first paint. The key prompt
 * is still decided in the browser, as it always was.
 */

/** What the gate knows on one render. */
export interface GateView {
  /** The server rendered this page for a signed-in account. */
  signedIn: boolean;
  /** That account has never chosen its username and avatar (`onboarded_at` is null). */
  needsOnboarding: boolean;
  /** How many agents it owns, from the same server render. */
  ownedAgentCount: number;
  /** `?onboarding=1` is on the address. */
  forced: boolean;
  /**
   * What this gate has already started since it mounted. Whatever it is stays started
   * until the next full page load, and nothing else starts beside it or after it.
   */
  started: "nothing" | "first-run" | "key-prompt";
  /** This page holds the key prompt back (`./suppress`): the builder asks for the key itself. */
  heldBack: boolean;
  /** The browser's own session query has answered, with a session. */
  sessionReady: boolean;
  /** The key prompt was dismissed on this device. */
  dismissed: boolean;
}

export type GateDecision = "nothing" | "first-run" | "preview" | "key-prompt";

/**
 * What to start now.
 *
 * The first-run flow opens on every page, the builder included: the landing's "Create
 * your agent" lands a new account there, and held back it would build and post under a
 * name nobody chose. A preview is the same two screens for an account that is already
 * through them, and saves nothing. The key prompt is for an account with agents and no
 * key; whether it has a key is the prompt's own question to ask.
 */
export function gateDecision(view: GateView): GateDecision {
  if (view.started !== "nothing") return "nothing";
  if (view.signedIn && view.needsOnboarding) return "first-run";
  // Signed out there is no name or avatar to show, so there is nothing to preview.
  if (view.forced) return view.signedIn ? "preview" : "nothing";
  if (view.heldBack || !view.sessionReady || view.dismissed) return "nothing";
  return view.ownedAgentCount > 0 ? "key-prompt" : "nothing";
}

/**
 * Whether a key press is kept from the page while the ground is up and the card has not
 * opened. The ground hides the app from a pointer, not from a keyboard: Tab would walk
 * links nobody can see and Enter would follow one. A key held with ⌘, Ctrl or Alt, and a
 * function key, is the browser's own (reload, the address bar) and is left to it.
 */
export function keptFromPage(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return !/^F\d{1,2}$/.test(event.key);
}

export type FirstRunMode = "real" | "preview";

/** Who a first-run is about: the account as the server saw it when the flow opened. */
export interface FirstRunProfile {
  handle: string;
  avatarUrl: string | null;
  avatarSeed: string | null;
}

/** The shape of one first-run: which screens, and whether the first can be put off. */
export interface FirstRunPlan {
  /** Two screens for an account with no agent yet; an owner is only asked who they are. */
  screens: 1 | 2;
  /**
   * Screen 1 has no way out but Continue. Only for a real account with no agent: an
   * owner may have a proposal to answer or trading to pause, and gets "Not now".
   */
  required: boolean;
  /** Continue writes to the account. A preview moves on without a request. */
  saves: boolean;
}

/**
 * `ownsAgent` is the layout's count at the time the flow opened. The save answers the
 * same question again, and its answer is the one that decides whether screen 2 follows.
 */
export function firstRunPlan(mode: FirstRunMode, ownsAgent: boolean): FirstRunPlan {
  if (mode === "preview") return { screens: 2, required: false, saves: false };
  return ownsAgent ? { screens: 1, required: false, saves: true } : { screens: 2, required: true, saves: true };
}
