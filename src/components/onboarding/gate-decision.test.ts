import { describe, expect, it } from "vitest";
import { firstRunPlan, gateDecision, keptFromPage, type GateView } from "./gate-decision";
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

  it("gets both screens, and cannot put the first one off", () => {
    expect(firstRunPlan("real", false)).toEqual({ screens: 2, required: true, saves: true });
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

  it("is both screens, closable, and saves nothing, whether or not the account owns an agent", () => {
    expect(firstRunPlan("preview", false)).toEqual({ screens: 2, required: false, saves: false });
    expect(firstRunPlan("preview", true)).toEqual({ screens: 2, required: false, saves: false });
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

describe("a key pressed before the card has opened", () => {
  const key = (name: string, held: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
    key: name,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...held,
  });

  it("is kept from the page when it would move, press or type into what the ground hides", () => {
    for (const name of ["Tab", "Enter", " ", "Escape", "ArrowDown", "PageDown", "a", "K", "/", "f", "F"]) {
      expect(keptFromPage(key(name)), name).toBe(true);
    }
  });

  it("is left to the browser when it is one of the browser's own", () => {
    expect(keptFromPage(key("r", { metaKey: true }))).toBe(false);
    expect(keptFromPage(key("r", { ctrlKey: true }))).toBe(false);
    expect(keptFromPage(key("l", { metaKey: true }))).toBe(false);
    expect(keptFromPage(key("ArrowLeft", { altKey: true }))).toBe(false);
    for (const name of ["F1", "F5", "F11", "F12"]) expect(keptFromPage(key(name)), name).toBe(false);
  });
});
