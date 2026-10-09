import { describe, expect, it } from "vitest";
import { AVATAR_REFUSED } from "@/lib/avatar";
import { HANDLE_TAKEN } from "@/lib/handles";
import type { OnboardingResult } from "@/server/actions/onboarding";
import { SAVE_FAILED, pageAfterRename, previewOutcome, saveOutcome, signInAgainHref } from "./save-outcome";

const saved = (over: Partial<Extract<OnboardingResult, { ok: true }>["data"]> = {}): OnboardingResult => ({
  ok: true,
  data: { handle: "rami", avatarSeed: "k3v9x0q2ab", hasAgents: false, already: false, ...over },
});
const refused = (kind: Extract<OnboardingResult, { ok: false }>["kind"], error: string): OnboardingResult => ({
  ok: false,
  error,
  kind,
});

describe("a save that went through", () => {
  it("goes on to the second screen for an account with no agent", () => {
    expect(saveOutcome(saved())).toEqual({
      kind: "saved",
      identity: { handle: "rami", avatarSeed: "k3v9x0q2ab" },
      then: "screen-2",
    });
  });

  it("carries a null seed when the account kept its photo", () => {
    expect(saveOutcome(saved({ avatarSeed: null }))).toMatchObject({ identity: { handle: "rami", avatarSeed: null } });
  });

  it("closes for an account that owns an agent: the server's answer, not the card's guess", () => {
    expect(saveOutcome(saved({ hasAgents: true }))).toMatchObject({ kind: "saved", then: "close" });
  });

  it("closes when another tab got there first, and shows what that tab saved", () => {
    const outcome = saveOutcome(saved({ handle: "first_tab", avatarSeed: null, already: true }));
    expect(outcome).toEqual({ kind: "saved", identity: { handle: "first_tab", avatarSeed: null }, then: "close" });
    // Even with no agent: this tab's screen 2 would follow a choice it did not make.
    expect(saveOutcome(saved({ already: true, hasAgents: false }))).toMatchObject({ then: "close" });
  });
});

describe("a save that was refused", () => {
  it("a refused name is said under the field, and the keyboard goes back into it", () => {
    for (const sentence of [HANDLE_TAKEN, "Someone just took that name. Try another."]) {
      expect(saveOutcome(refused("handle", sentence))).toEqual({
        kind: "refused",
        under: "field",
        sentence,
        focus: "field",
        wayOut: false,
      });
    }
  });

  it("a refused avatar is said under the avatars", () => {
    expect(saveOutcome(refused("avatar", AVATAR_REFUSED))).toEqual({
      kind: "refused",
      under: "tiles",
      sentence: AVATAR_REFUSED,
      focus: "field",
      wayOut: false,
    });
  });

  it("too many saves says the limiter's own sentence under the avatars, with the button ready again", () => {
    const sentence = "Slow down — try again in 40 seconds.";
    expect(saveOutcome(refused("limited", sentence))).toEqual({
      kind: "refused",
      under: "tiles",
      sentence,
      focus: "button",
      wayOut: false,
    });
  });

  it("a signed-out save goes to sign-in, and shows no sentence", () => {
    expect(saveOutcome(refused("signed-out", "Sign in first"))).toEqual({ kind: "sign-in" });
  });
});

describe("a save that failed", () => {
  it("says so under the avatars and opens a way out", () => {
    expect(saveOutcome(refused("failed", "Could not save. Try again."))).toEqual({
      kind: "refused",
      under: "tiles",
      sentence: "Could not save. Try again.",
      focus: "button",
      wayOut: true,
    });
  });

  it("a call that never answered says the same sentence, in the card's own copy", () => {
    expect(SAVE_FAILED).toBe("Could not save. Try again.");
    expect(saveOutcome("threw")).toEqual({
      kind: "refused",
      under: "tiles",
      sentence: SAVE_FAILED,
      focus: "button",
      wayOut: true,
    });
  });

  it("is the only kind of answer that opens a way out", () => {
    const kinds = ["handle", "avatar", "limited"] as const;
    for (const kind of kinds) expect(saveOutcome(refused(kind, "x"))).toMatchObject({ wayOut: false });
  });
});

describe("a preview's Continue", () => {
  it("moves on to the second screen with what was chosen, and nothing is sent", () => {
    expect(previewOutcome("rami", { kind: "seed", seed: "k3v9x0q2ab" })).toEqual({
      kind: "saved",
      identity: { handle: "rami", avatarSeed: "k3v9x0q2ab" },
      then: "screen-2",
    });
    expect(previewOutcome("rami", { kind: "photo" })).toMatchObject({ identity: { avatarSeed: null } });
  });
});

describe("the page behind the card after a rename", () => {
  it("moves a person off their own old profile, which is a not-found page now", () => {
    expect(pageAfterRename("/u/user5a5ppx", "user5a5ppx", "rami")).toBe("/u/rami");
  });

  it("stays put everywhere else", () => {
    expect(pageAfterRename("/home", "user5a5ppx", "rami")).toBeNull();
    expect(pageAfterRename("/agents/new", "user5a5ppx", "rami")).toBeNull();
    // Someone else's profile, and a name that only starts the same way.
    expect(pageAfterRename("/u/nova", "user5a5ppx", "rami")).toBeNull();
    expect(pageAfterRename("/u/user5a5ppx2", "user5a5ppx", "rami")).toBeNull();
    expect(pageAfterRename("/u/user5a5ppx/extra", "user5a5ppx", "rami")).toBeNull();
  });

  it("stays put when the name was kept", () => {
    expect(pageAfterRename("/u/rami", "rami", "rami")).toBeNull();
  });
});

describe("signing in again", () => {
  it("comes back to the page the card was open over, query string and all", () => {
    expect(signInAgainHref("/agents/new", "")).toBe("/login?next=%2Fagents%2Fnew");
    expect(signInAgainHref("/feed", "?tab=people")).toBe("/login?next=%2Ffeed%3Ftab%3Dpeople");
  });
});
