/**
 * What the onboarding gate starts, outside the component so it can be tested: the
 * first-run screens (choose a username and avatar, see how an agent works, then build
 * one), a preview of them, the separate "your agents have no key" prompt, or nothing. And
 * the shape of a first-run once it has started: which screens, in what order, and which
 * of them can be closed. No React.
 *
 * The server decides the first-run flow (`users.onboarded_at`, read by the app layout),
 * so it is the same answer on every device and no request made in the browser stands in
 * front of it. The key prompt is still decided in the browser, as it always was.
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
 * name nobody chose. A preview is the same three screens for an account that is already
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

export type FirstRunMode = "real" | "preview";

/** Who a first-run is about: the account as the server saw it when the flow opened. */
export interface FirstRunProfile {
  handle: string;
  avatarUrl: string | null;
  avatarSeed: string | null;
}

/**
 * A screen of the flow, numbered in the order they are shown: 1 choose a username and
 * avatar, 2 how it works, 3 build your first agent.
 */
export type FirstRunScreen = 1 | 2 | 3;

/** The shape of one first-run: which screens, and whether the first can be put off. */
export interface FirstRunPlan {
  /** Three screens for an account with no agent yet; an owner is only asked who they are. */
  screens: 1 | 3;
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
  if (mode === "preview") return { screens: 3, required: false, saves: false };
  return ownsAgent ? { screens: 1, required: false, saves: true } : { screens: 3, required: true, saves: true };
}

/** The screen that follows this one, or null when this is the last and the card closes. */
export function screenAfter(screens: FirstRunPlan["screens"], screen: FirstRunScreen): FirstRunScreen | null {
  return screen < screens ? ((screen + 1) as FirstRunScreen) : null;
}

/**
 * Whether the card can be closed from this screen without finishing it: by Escape, by a
 * press outside it, or by the quiet row under its button.
 *
 * Screen 1 cannot, for a new account, until a save has failed on it outright: a request
 * that keeps failing must not lock anyone out of the app. Screens 2 and 3 always can. By
 * then the username is saved and the account is through onboarding, so closing either is
 * the end of the flow, and it is not shown again.
 */
export function canClose(plan: FirstRunPlan, screen: FirstRunScreen, saveFailed: boolean): boolean {
  return screen > 1 || !plan.required || saveFailed;
}

/** The row above the title: one pip a screen, lit up to this one, and the count in words. */
export interface FirstRunProgress {
  pips: boolean[];
  /** As it is drawn: "2 of 3". */
  count: string;
  /** As a screen reader hears it: "Step 2 of 3". */
  said: string;
}

/** Where this screen is in the flow, or null for the one screen an owner sees, which has nothing to count. */
export function progress(screens: FirstRunPlan["screens"], screen: FirstRunScreen): FirstRunProgress | null {
  if (screens === 1) return null;
  return {
    pips: Array.from({ length: screens }, (_, index) => index < screen),
    count: `${screen} of ${screens}`,
    said: `Step ${screen} of ${screens}`,
  };
}
