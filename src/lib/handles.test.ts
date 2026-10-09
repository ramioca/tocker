/**
 * The rule every place that takes a username applies, and the sentences they say.
 *
 * The sentences are checked for length because the first-run screen shows each on one
 * line of a phone's card, and for the word "username" because the Settings form sorts a
 * server error under its field by that word.
 */
import { describe, expect, it } from "vitest";
import { FOUNDER_X } from "@/lib/contact";
import { HANDLE_RESERVED } from "@/lib/reserved-handles";
import { HANDLE_INVALID, HANDLE_RE, HANDLE_TAKEN, handleProblem, handleProblemSentence, normalizeHandle } from "./handles";

describe("normalizeHandle", () => {
  it("trims and lowercases, and changes nothing else", () => {
    expect(normalizeHandle("  Dex_Trades \n")).toBe("dex_trades");
    expect(normalizeHandle("a b")).toBe("a b");
  });
});

describe("handleProblem", () => {
  it("accepts two to twenty letters, digits or underscores", () => {
    for (const handle of ["ab", "dex_trades", "a1", "_x", "x".repeat(20)]) {
      expect(handleProblem(handle, "someone"), handle).toBeNull();
      expect(HANDLE_RE.test(handle), handle).toBe(true);
    }
  });

  it("calls anything else invalid", () => {
    for (const handle of ["", "a", "x".repeat(21), "Dex", "my-name", "a b", "dot.name", "émile", "@dex"]) {
      expect(handleProblem(handle, "someone"), handle).toBe("invalid");
    }
  });

  it("calls the product, staff words and the founder reserved", () => {
    for (const handle of ["support", "admin", "tocker", "tocker_team", "_help_", "security1", "privy", FOUNDER_X.handle.toLowerCase()]) {
      expect(handleProblem(handle, "someone"), handle).toBe("reserved");
    }
  });

  it("never finds a problem with the account's own username", () => {
    // A save may carry it unchanged, so a name the rules would now refuse still saves.
    expect(handleProblem("staff", "staff")).toBeNull();
    expect(handleProblem("x", "x")).toBeNull();
    // A different reserved name is a change, and is refused.
    expect(handleProblem("root", "staff")).toBe("reserved");
  });

  it("has no account to excuse at sign-up", () => {
    expect(handleProblem("support", null)).toBe("reserved");
    expect(handleProblem("fine_name", null)).toBeNull();
  });
});

describe("the sentences", () => {
  it("fit one line of the first-run card and say username", () => {
    for (const sentence of [HANDLE_INVALID, HANDLE_TAKEN, HANDLE_RESERVED]) {
      expect(sentence.length, sentence).toBeLessThanOrEqual(44);
      expect(sentence.toLowerCase(), sentence).toContain("username");
    }
  });

  it("are the ones the screens were written around", () => {
    expect(HANDLE_INVALID).toBe("Usernames are 2–20 letters, numbers or _");
    expect(HANDLE_TAKEN).toBe("That username is taken");
    expect(HANDLE_RESERVED).toBe("That username is reserved");
  });

  it("are picked by the problem, the same way everywhere", () => {
    expect(handleProblemSentence("invalid")).toBe(HANDLE_INVALID);
    expect(handleProblemSentence("reserved")).toBe(HANDLE_RESERVED);
  });
});
