import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVATAR_REFUSED } from "@/lib/avatar";
import { HANDLE_INVALID, HANDLE_TAKEN, type HandleStatus } from "@/lib/handles";
import { HANDLE_RESERVED } from "@/lib/reserved-handles";
import { SAVE_FAILED } from "./save-outcome";
import {
  ADDRESS_PREFIX,
  CHECK_DELAY_MS,
  STATUS,
  USERNAME_MAX,
  addressName,
  answered,
  continueLabel,
  fieldView,
  refusedSave,
  scheduleCheck,
  startField,
  typed,
  wantsCheck,
  type CheckAnswer,
  type UsernameField,
} from "./username-field";

/** The account's name when the screen opened: one sign-up assigned. */
const CURRENT = "user5a5ppx";
const open = () => startField(CURRENT);
/** Type `raw` into a freshly opened field. */
const type = (raw: string, from: UsernameField = open()) => typed(from, raw);
const answer = (handle: string, status: CheckAnswer["status"]): CheckAnswer => ({ handle, status });
const label = (field: UsernameField, preview = false, saving = false) =>
  continueLabel(field, fieldView(field, preview), saving);

describe("as the screen opens", () => {
  const field = open();

  it("holds the account's own username", () => {
    expect(field.value).toBe(CURRENT);
    expect(addressName(field)).toBe(CURRENT);
    expect(ADDRESS_PREFIX).toBe("tocker.xyz/u/");
  });

  it("says the name was picked for them, and lets them keep it with one press", () => {
    const view = fieldView(field);
    expect(view).toMatchObject({ kind: "untouched", text: "Picked for you. Keep it or type your own.", tone: "muted" });
    expect(view).toMatchObject({ glyph: "none", said: "quiet", invalid: false, canContinue: true });
    expect(label(field)).toBe(`Continue as @${CURRENT}`);
  });

  it("does not say it was picked for them in a preview, whose account chose it long ago", () => {
    expect(fieldView(field, true).text).toBe("Keep it or type your own.");
    expect(fieldView(field, true).canContinue).toBe(true);
  });

  it("asks the server nothing about the name the account already has", () => {
    expect(wantsCheck(field)).toBe(false);
  });

  it("keeps a name today's rules would refuse, because it is already theirs", () => {
    // Reserved, and one character too short: both were this account's before the rules.
    for (const own of ["admin", "x"]) {
      const kept = startField(own);
      expect(fieldView(kept)).toMatchObject({ kind: "untouched", canContinue: true, invalid: false });
      expect(wantsCheck(kept)).toBe(false);
      expect(label(kept)).toBe(`Continue as @${own}`);
    }
  });
});

describe("typing", () => {
  it("drops a leading @ without a word", () => {
    const field = type("@rami");
    expect(field).toMatchObject({ value: "rami", dropped: false });
    expect(type("@@rami").value).toBe("rami");
  });

  it("lowercases without a word", () => {
    expect(type("RaMi_99")).toMatchObject({ value: "rami_99", dropped: false });
  });

  it("drops what a username cannot hold, and says so until the next keystroke", () => {
    const field = type("rami-d");
    expect(field).toMatchObject({ value: "ramid", dropped: true });
    const view = fieldView(field);
    expect(view).toMatchObject({ text: "Letters, numbers and _ only", tone: "muted", said: "status" });
    // The name itself is fine: the check goes on and Continue stays open.
    expect(view).toMatchObject({ kind: "checking", canContinue: true });

    const next = typed(field, "ramid2");
    expect(next.dropped).toBe(false);
    expect(fieldView(next).text).toBe(STATUS.checking);
  });

  it("says a character was dropped in place of a verdict that arrives meanwhile", () => {
    const field = answered(type("ra.mi"), answer("rami", "available"));
    expect(fieldView(field)).toMatchObject({ kind: "available", text: STATUS.dropped, glyph: "ok", canContinue: true });
  });

  it("does not hide a reason Continue is closed behind the dropped-character note", () => {
    const reserved = type("ad-min");
    expect(reserved).toMatchObject({ value: "admin", dropped: true });
    expect(fieldView(reserved)).toMatchObject({ text: HANDLE_RESERVED, tone: "destructive", canContinue: false });
    const taken = answered(type("ra mi"), answer("rami", "taken"));
    expect(fieldView(taken)).toMatchObject({ text: HANDLE_TAKEN, tone: "destructive", canContinue: false });
  });

  it("an @ in the middle is a dropped character like any other", () => {
    expect(type("ra@mi")).toMatchObject({ value: "rami", dropped: true });
  });

  it("holds twenty characters at most", () => {
    expect(USERNAME_MAX).toBe(20);
    expect(type("a".repeat(30)).value).toBe("a".repeat(20));
    // The @ is not one of the twenty.
    expect(type(`@${"b".repeat(20)}`).value).toBe("b".repeat(20));
  });

  it("back to the account's own name is the untouched field again", () => {
    const field = type(CURRENT, type("rami"));
    expect(fieldView(field).kind).toBe("untouched");
    expect(wantsCheck(field)).toBe(false);
  });
});

describe("a name too short to be one", () => {
  it.each(["", "r"])("%j: says how long, closes Continue, asks nothing", (raw) => {
    const field = type(raw);
    const view = fieldView(field);
    expect(view).toMatchObject({ kind: "short", text: "At least 2 characters", tone: "muted", glyph: "none" });
    // A hint, not an error: nothing is marked invalid and nothing is read out.
    expect(view).toMatchObject({ said: "quiet", invalid: false, canContinue: false });
    expect(wantsCheck(field)).toBe(false);
    expect(label(field)).toBe("Continue");
  });

  it("shows an ellipsis where the name will go while the field is empty", () => {
    expect(addressName(type(""))).toBe("…");
    expect(addressName(type("r"))).toBe("r");
  });
});

describe("a reserved name", () => {
  it.each(["admin", "support", "tocker_team", "_support1"])("%s is refused before anyone asks the server", (name) => {
    const field = type(name);
    const view = fieldView(field);
    expect(view).toMatchObject({ kind: "reserved", text: HANDLE_RESERVED, tone: "destructive", glyph: "error" });
    expect(view).toMatchObject({ said: "status", invalid: true, canContinue: false });
    expect(wantsCheck(field)).toBe(false);
    expect(label(field)).toBe("Continue");
  });
});

describe("a name the server has to be asked about", () => {
  const field = type("rami");

  it("is checking until an answer about it arrives, with Continue open", () => {
    const view = fieldView(field);
    expect(view).toMatchObject({ kind: "checking", text: "Checking…", tone: "muted", glyph: "checking" });
    // Drawn outside the live region, or every keystroke would be narrated.
    expect(view).toMatchObject({ said: "quiet", invalid: false, canContinue: true });
    expect(wantsCheck(field)).toBe(true);
    expect(label(field)).toBe("Continue as @rami");
  });

  it("available", () => {
    const free = answered(field, answer("rami", "available"));
    const view = fieldView(free);
    expect(view).toMatchObject({ kind: "available", text: "Available", tone: "positive", glyph: "ok" });
    expect(view).toMatchObject({ said: "status", invalid: false, canContinue: true });
    expect(wantsCheck(free)).toBe(false);
    expect(label(free)).toBe("Continue as @rami");
  });

  it("taken", () => {
    const taken = answered(field, answer("rami", "taken"));
    const view = fieldView(taken);
    expect(view).toMatchObject({ kind: "taken", text: HANDLE_TAKEN, tone: "destructive", glyph: "error" });
    expect(view).toMatchObject({ said: "status", invalid: true, canContinue: false });
    expect(wantsCheck(taken)).toBe(false);
    expect(label(taken)).toBe("Continue");
  });

  it.each([
    ["reserved", HANDLE_RESERVED],
    ["invalid", HANDLE_INVALID],
  ] as Array<[HandleStatus, string]>)("the server's own %s says the sentence Settings says", (status, sentence) => {
    // The lists are the same on both sides; this is the server having the last word.
    const view = fieldView(answered(field, answer("rami", status)));
    expect(view).toMatchObject({ kind: status, text: sentence, tone: "destructive", invalid: true, canContinue: false });
  });

  it("could not check: says so, and Continue stays open because the save checks again", () => {
    const unknown = answered(field, answer("rami", "unknown"));
    const view = fieldView(unknown);
    expect(view).toMatchObject({ kind: "unknown", text: "Could not check. You can still continue.", tone: "muted" });
    expect(view).toMatchObject({ glyph: "none", invalid: false, canContinue: true });
    expect(label(unknown)).toBe("Continue as @rami");
    // Still worth asking: the hook asks again the next time the field or a save changes it.
    expect(wantsCheck(unknown)).toBe(true);
  });
});

describe("a stale answer", () => {
  it("about a name no longer in the field is dropped", () => {
    const field = type("ramid", type("rami"));
    const after = answered(field, answer("rami", "taken"));
    expect(after).toBe(field);
    expect(fieldView(after)).toMatchObject({ kind: "checking", canContinue: true });
  });

  it("does not turn a name the person typed past into the verdict on the next one", () => {
    // "rami" is taken; they type on to "rami_d" before a second answer is back.
    let field = answered(type("rami"), answer("rami", "taken"));
    expect(fieldView(field).kind).toBe("taken");
    field = typed(field, "rami_d");
    expect(fieldView(field)).toMatchObject({ kind: "checking", canContinue: true });
    expect(wantsCheck(field)).toBe(true);
    // The late duplicate of the old answer changes nothing.
    expect(answered(field, answer("rami", "taken"))).toBe(field);
    field = answered(field, answer("rami_d", "available"));
    expect(fieldView(field).kind).toBe("available");
  });

  it("the last answer is remembered if the person types back to its name", () => {
    let field = answered(type("rami"), answer("rami", "taken"));
    field = typed(field, "ram");
    expect(fieldView(field).kind).toBe("checking");
    field = typed(field, "rami");
    expect(fieldView(field).kind).toBe("taken");
    expect(wantsCheck(field)).toBe(false);
  });

  it("the server's answer is matched on the name it echoes, not on when it arrives", () => {
    const field = type("rami");
    expect(answered(field, answer("RAMI", "available"))).toBe(field);
    expect(answered(field, answer("", "invalid"))).toBe(field);
  });
});

describe("a save that refused the name", () => {
  const RACED = "Someone just took that name. Try another.";
  const refused = refusedSave(answered(type("rami"), answer("rami", "available")), RACED);

  it("says the save's own sentence as an alert, and closes Continue", () => {
    const view = fieldView(refused);
    expect(view).toMatchObject({ kind: "refused", text: RACED, tone: "destructive", glyph: "error" });
    expect(view).toMatchObject({ said: "alert", invalid: true, canContinue: false });
    expect(label(refused)).toBe("Continue");
  });

  it("is not asked about again until the name changes", () => {
    expect(wantsCheck(refused)).toBe(false);
  });

  it("is forgotten on the next keystroke", () => {
    const next = typed(refused, "rami2");
    expect(next.refused).toBeNull();
    expect(fieldView(next)).toMatchObject({ kind: "checking", canContinue: true });
  });

  it("wins over the account's own name, which a save can refuse too", () => {
    // Another tab renamed the account, and someone took the name it gave up.
    const own = refusedSave(open(), HANDLE_TAKEN);
    expect(fieldView(own)).toMatchObject({ kind: "refused", text: HANDLE_TAKEN, canContinue: false });
  });

  it("takes the old Available with it: typed back in, the name is asked about again", () => {
    // One more letter, then deleted before a check of the longer name could answer.
    const back = typed(typed(refused, "ramix"), "rami");
    expect(back.answer).toBeNull();
    expect(fieldView(back)).toMatchObject({ kind: "checking", glyph: "checking" });
    expect(wantsCheck(back)).toBe(true);
    // And the new answer is the one shown.
    expect(fieldView(answered(back, answer("rami", "taken")))).toMatchObject({ kind: "taken", canContinue: false });
  });

  it("is asked about again after a keystroke that changed nothing, too", () => {
    // A character the field drops leaves the same name in it, and clears the refusal.
    const same = typed(refused, "rami!");
    expect(same.value).toBe("rami");
    expect(fieldView(same).kind).toBe("checking");
    expect(wantsCheck(same)).toBe(true);
  });

  it("forgets only the answer about the refused name", () => {
    // The answer kept is about another name: the refusal says nothing of it.
    const other = refusedSave(typed(answered(type("rami"), answer("rami", "taken")), "ramid"), RACED);
    const back = typed(typed(other, "rami_"), "rami");
    expect(fieldView(back)).toMatchObject({ kind: "taken", canContinue: false });
  });

  it("without a refusal, an answer is still remembered when the name is typed back", () => {
    const back = typed(typed(answered(type("rami"), answer("rami", "available")), "ramix"), "rami");
    expect(fieldView(back).kind).toBe("available");
    expect(wantsCheck(back)).toBe(false);
  });
});

describe("the button", () => {
  it("names the account it is about to make public", () => {
    expect(label(type("rami"))).toBe("Continue as @rami");
  });

  it("reads Saving… while the save is on its way, whatever the field says", () => {
    expect(label(open(), false, true)).toBe("Saving…");
    expect(label(type("r"), false, true)).toBe("Saving…");
  });
});

describe("every line under the field", () => {
  it("is one line on a phone: 44 characters at most", () => {
    const lines = [
      ...Object.values(STATUS),
      HANDLE_TAKEN,
      HANDLE_RESERVED,
      HANDLE_INVALID,
      "Someone just took that name. Try another.",
      SAVE_FAILED,
      AVATAR_REFUSED,
      // The limiter's own sentence, at its longest: the window is a minute.
      "Slow down — try again in 60 seconds.",
    ];
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(44);
  });

  it("says what the design says, word for word", () => {
    expect(STATUS).toEqual({
      picked: "Picked for you. Keep it or type your own.",
      pickedPreview: "Keep it or type your own.",
      short: "At least 2 characters",
      checking: "Checking…",
      available: "Available",
      dropped: "Letters, numbers and _ only",
      unknown: "Could not check. You can still continue.",
    });
  });
});

describe("scheduleCheck", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A server that answers when the test says so. */
  function server() {
    const asked: string[] = [];
    const waiting: Array<{ name: string; say: (status: HandleStatus | null) => void; fail: () => void }> = [];
    const ask = (name: string) => {
      asked.push(name);
      return new Promise<{ handle: string; status: HandleStatus } | null>((resolve, reject) => {
        waiting.push({
          name,
          say: (status) => resolve(status === null ? null : { handle: name, status }),
          fail: () => reject(new Error("offline")),
        });
      });
    };
    return { ask, asked, waiting };
  }
  /** Let the promise chain inside `scheduleCheck` run. */
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it("waits 350 ms after the keystroke before it asks", async () => {
    expect(CHECK_DELAY_MS).toBe(350);
    const { ask, asked, waiting } = server();
    const onAnswer = vi.fn();
    scheduleCheck("rami", ask, onAnswer);
    vi.advanceTimersByTime(349);
    expect(asked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(asked).toEqual(["rami"]);
    expect(onAnswer).not.toHaveBeenCalled();
    waiting[0].say("available");
    await settle();
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ handle: "rami", status: "available" });
  });

  it("called off before the delay is up, it never asks", async () => {
    const { ask, asked } = server();
    const onAnswer = vi.fn();
    const cancel = scheduleCheck("rami", ask, onAnswer);
    vi.advanceTimersByTime(200);
    cancel();
    vi.advanceTimersByTime(1_000);
    await settle();
    expect(asked).toEqual([]);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("called off while the answer is on its way, the answer goes to nobody", async () => {
    const { ask, waiting } = server();
    const onAnswer = vi.fn();
    const cancel = scheduleCheck("rami", ask, onAnswer);
    vi.advanceTimersByTime(CHECK_DELAY_MS);
    cancel();
    waiting[0].say("taken");
    await settle();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("a server that will not say is answered unknown, about the name that was asked", async () => {
    const { ask, waiting } = server();
    const onAnswer = vi.fn();
    scheduleCheck("rami", ask, onAnswer);
    vi.advanceTimersByTime(CHECK_DELAY_MS);
    waiting[0].say(null);
    await settle();
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ handle: "rami", status: "unknown" });
  });

  it("a call that fails is answered unknown too", async () => {
    const { ask, waiting } = server();
    const onAnswer = vi.fn();
    scheduleCheck("rami", ask, onAnswer);
    vi.advanceTimersByTime(CHECK_DELAY_MS);
    waiting[0].fail();
    await settle();
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ handle: "rami", status: "unknown" });
  });

  it("passes on the name the server echoes, which is what the field matches on", async () => {
    const onAnswer = vi.fn();
    scheduleCheck("rami", async () => ({ handle: "other", status: "taken" }), onAnswer);
    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ handle: "other", status: "taken" });
    // And the field then drops it.
    const field = type("rami");
    expect(answered(field, onAnswer.mock.calls[0][0] as CheckAnswer)).toBe(field);
  });

  it("typing r-a-m-i asks once, about the last name, however the answers race", async () => {
    // What the hook does: every keystroke calls off the check before it and starts one.
    const { ask, asked, waiting } = server();
    let field = open();
    const onAnswer = (said: CheckAnswer) => {
      field = answered(field, said);
    };
    let cancel = () => {};
    const press = (raw: string, waitMs: number) => {
      cancel();
      field = typed(field, raw);
      cancel = wantsCheck(field) ? scheduleCheck(field.value, ask, onAnswer) : () => {};
      vi.advanceTimersByTime(waitMs);
    };

    press("r", 100);
    press("ra", 100);
    press("ram", 400); // A pause: "ram" is asked about.
    expect(asked).toEqual(["ram"]);
    press("rami", 400); // Typed on before the answer: "rami" is asked about too.
    expect(asked).toEqual(["ram", "rami"]);

    // The newer answer lands first, then the older one.
    waiting[1].say("available");
    await settle();
    waiting[0].say("taken");
    await settle();
    expect(field.value).toBe("rami");
    expect(fieldView(field)).toMatchObject({ kind: "available", canContinue: true });
  });
});
