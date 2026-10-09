import { describe, expect, it } from "vitest";
import {
  canClose,
  firstRunPlan,
  gateDecision,
  progress,
  screenAfter,
  type FirstRunScreen,
  type GateView,
} from "./gate-decision";
import { onboardingSuppressedOn } from "./suppress";

/**
 * An account that is through the first-run screens, owns nothing, on a page that holds
 * nothing back, in a browser whose session has answered and that never dismissed the key
 * prompt. Each test changes only what it is about.
 */
const view = (over: Partial<GateView> = {}): GateView => ({
  signedIn: true,
  needsOnboarding: false,
  ownedAgentCount: 0,
  forced: false,
  started: "nothing",
  heldBack: false,
  sessionReady: true,
  dismissed: false,
  ...over,
});

/** Every page the gate is mounted on is one of these two, as far as it can tell. */
const PAGES = [
  ["/home", onboardingSuppressedOn("/home")],
  ["/agents/new", onboardingSuppressedOn("/agents/new")],
] as const;

describe("signed out", () => {
  it("starts nothing", () => {
    expect(gateDecision(view({ signedIn: false, sessionReady: false }))).toBe("nothing");
  });

  it("starts nothing when ?onboarding=1 is on the address", () => {
    expect(gateDecision(view({ signedIn: false, sessionReady: false, forced: true }))).toBe("nothing");
  });

  it("starts nothing whatever else the view says", () => {
    // A server render with no session has no account to ask and none to preview.
    expect(gateDecision(view({ signedIn: false, needsOnboarding: true, sessionReady: false }))).toBe("nothing");
  });
});

describe("an account that has never chosen its username, and owns no agent", () => {
  it.each(PAGES)("gets the first-run screens on %s", (_page, heldBack) => {
    expect(gateDecision(view({ needsOnboarding: true, heldBack }))).toBe("first-run");
  });

  it("gets all three screens, and cannot put the first one off", () => {
    expect(firstRunPlan("real", false)).toEqual({ screens: 3, required: true, saves: true });
  });

  it("is decided by the server alone: nothing the browser knows holds it back", () => {
    // The session query has not answered and the key prompt was dismissed on this device.
    expect(gateDecision(view({ needsOnboarding: true, sessionReady: false, dismissed: true }))).toBe("first-run");
  });

  it("gets the real screens, not a preview, when ?onboarding=1 is on the address", () => {
    expect(gateDecision(view({ needsOnboarding: true, forced: true }))).toBe("first-run");
  });
});

describe("an account that has never chosen its username, and owns an agent", () => {
  it.each(PAGES)("gets the first-run screen on %s, never the key prompt", (_page, heldBack) => {
    expect(gateDecision(view({ needsOnboarding: true, ownedAgentCount: 2, heldBack }))).toBe("first-run");
  });

  it("gets the first screen only, with a way to put it off", () => {
    expect(firstRunPlan("real", true)).toEqual({ screens: 1, required: false, saves: true });
  });
});

describe("an account that is through the first-run screens", () => {
  it("gets nothing when it owns no agent", () => {
    expect(gateDecision(view())).toBe("nothing");
  });

  it("gets the key prompt when it owns an agent", () => {
    expect(gateDecision(view({ ownedAgentCount: 1 }))).toBe("key-prompt");
  });

  it("does not get the key prompt on the builder, which asks for the key itself", () => {
    expect(onboardingSuppressedOn("/agents/new")).toBe(true);
    expect(gateDecision(view({ ownedAgentCount: 1, heldBack: true }))).toBe("nothing");
  });

  it("does not get the key prompt once it was dismissed on this device", () => {
    expect(gateDecision(view({ ownedAgentCount: 1, dismissed: true }))).toBe("nothing");
  });

  it("does not get the key prompt before the browser's own session has answered", () => {
    expect(gateDecision(view({ ownedAgentCount: 1, sessionReady: false }))).toBe("nothing");
  });
});

describe("?onboarding=1", () => {
  it.each(PAGES)("previews the screens for an account that is through them, on %s", (_page, heldBack) => {
    expect(gateDecision(view({ forced: true, heldBack }))).toBe("preview");
  });

  it("previews them for an owner too, in place of the key prompt", () => {
    expect(gateDecision(view({ forced: true, ownedAgentCount: 3 }))).toBe("preview");
  });

  it("previews them for a mock account, whose session never says it needs onboarding", () => {
    // The layout passes `session?.onboardedAt === null`, which is false without the field.
    expect(gateDecision(view({ forced: true, needsOnboarding: false, sessionReady: false }))).toBe("preview");
  });

  it("is all three screens, closable, and saves nothing, whether or not the account owns an agent", () => {
    expect(firstRunPlan("preview", false)).toEqual({ screens: 3, required: false, saves: false });
    expect(firstRunPlan("preview", true)).toEqual({ screens: 3, required: false, saves: false });
  });
});

describe("one thing per page load", () => {
  /** Every combination of what can change after the gate has started something. */
  const LATER: Array<Partial<GateView>> = [
    {},
    { needsOnboarding: true },
    { forced: true },
    { ownedAgentCount: 1 },
    { ownedAgentCount: 1, forced: true },
    { needsOnboarding: true, ownedAgentCount: 1, forced: true },
  ];

  it("starts no key prompt once a first-run was latched, open or closed", () => {
    // The save refreshes the layout: the account is onboarded now and may own agents.
    expect(gateDecision(view({ started: "first-run", ownedAgentCount: 1 }))).toBe("nothing");
    for (const later of LATER) expect(gateDecision(view({ ...later, started: "first-run" }))).toBe("nothing");
  });

  it("starts no first-run or preview once the key prompt was mounted", () => {
    for (const later of LATER) expect(gateDecision(view({ ...later, started: "key-prompt" }))).toBe("nothing");
  });

  it("does not start the same thing twice", () => {
    const first = view({ needsOnboarding: true });
    expect(gateDecision(first)).toBe("first-run");
    expect(gateDecision({ ...first, started: "first-run" })).toBe("nothing");
    const key = view({ ownedAgentCount: 1 });
    expect(gateDecision(key)).toBe("key-prompt");
    expect(gateDecision({ ...key, started: "key-prompt" })).toBe("nothing");
  });
});

/** The three shapes a first-run takes. */
const NEW_ACCOUNT = firstRunPlan("real", false);
const OWNER = firstRunPlan("real", true);
const PREVIEW = firstRunPlan("preview", false);
const EVERY_SCREEN: FirstRunScreen[] = [1, 2, 3];

describe("the screens, in order", () => {
  it("go 1, 2, 3 for a new account and for a preview, and then the card closes", () => {
    for (const plan of [NEW_ACCOUNT, PREVIEW]) {
      expect(screenAfter(plan.screens, 1)).toBe(2);
      expect(screenAfter(plan.screens, 2)).toBe(3);
      expect(screenAfter(plan.screens, 3)).toBeNull();
    }
  });

  it("an owner's one screen has nothing after it", () => {
    expect(screenAfter(OWNER.screens, 1)).toBeNull();
  });
});

describe("closing the card without finishing it", () => {
  it("is refused on screen 1 for a new account: Escape and a press outside do nothing there", () => {
    expect(canClose(NEW_ACCOUNT, 1, false)).toBe(false);
  });

  it("is offered on screen 1 once a save has failed outright, so a broken request locks nobody out", () => {
    expect(canClose(NEW_ACCOUNT, 1, true)).toBe(true);
  });

  it("is always allowed on screens 2 and 3: the username is saved by then", () => {
    for (const plan of [NEW_ACCOUNT, PREVIEW]) {
      for (const saveFailed of [false, true]) {
        expect(canClose(plan, 2, saveFailed)).toBe(true);
        expect(canClose(plan, 3, saveFailed)).toBe(true);
      }
    }
  });

  it("is allowed from the start for an owner, who may have a proposal to answer", () => {
    expect(canClose(OWNER, 1, false)).toBe(true);
  });

  it("is allowed on every screen of a preview", () => {
    for (const screen of EVERY_SCREEN) expect(canClose(PREVIEW, screen, false)).toBe(true);
  });
});

describe("closing on screen 2, after the save", () => {
  it("opens nothing again before the next full page load, whatever the refresh brings", () => {
    // The gate keeps the run latched after the card has gone. The save's refresh says the
    // account is onboarded; a later one may say it owns an agent.
    for (const later of [{}, { ownedAgentCount: 1 }, { forced: true }, { needsOnboarding: true }]) {
      expect(gateDecision(view({ ...later, started: "first-run" }))).toBe("nothing");
    }
  });

  it("opens nothing on the next full page load either: the server says the account is through", () => {
    // `onboarded_at` was written by the save that led to screen 2, so the layout passes
    // `needsOnboarding` false from then on, on this device and every other.
    for (const [, heldBack] of PAGES) expect(gateDecision(view({ needsOnboarding: false, heldBack }))).toBe("nothing");
  });

  it("leaves the key prompt to its own rule, for the day the account owns an agent", () => {
    expect(gateDecision(view({ needsOnboarding: false, ownedAgentCount: 1 }))).toBe("key-prompt");
  });
});

describe("the count above the title", () => {
  it("is three pips, lit up to this screen, and the count in words", () => {
    expect(progress(3, 1)).toEqual({ pips: [true, false, false], count: "1 of 3", said: "Step 1 of 3" });
    expect(progress(3, 2)).toEqual({ pips: [true, true, false], count: "2 of 3", said: "Step 2 of 3" });
    expect(progress(3, 3)).toEqual({ pips: [true, true, true], count: "3 of 3", said: "Step 3 of 3" });
  });

  it("is absent on the one screen an owner sees: there is nothing to count", () => {
    expect(progress(OWNER.screens, 1)).toBeNull();
  });

  it("is the same for a preview as for a new account", () => {
    for (const screen of EVERY_SCREEN) {
      expect(progress(PREVIEW.screens, screen)).toEqual(progress(NEW_ACCOUNT.screens, screen));
    }
  });
});
