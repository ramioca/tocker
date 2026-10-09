import { describe, expect, it } from "vitest";
import { cleanHandle, removedNote } from "./handle-filter";

describe("cleanHandle", () => {
  it("drops what a handle can't hold and says which characters went", () => {
    expect(cleanHandle("my-name.X")).toEqual({ value: "mynamex", removed: ["-", "."] });
  });

  it("does not count lowercasing as a drop", () => {
    expect(cleanHandle("Momentum_Mike")).toEqual({ value: "momentum_mike", removed: [] });
  });

  it("lists each dropped character once, in the order typed", () => {
    expect(cleanHandle("a.b.c-d.")).toEqual({ value: "abcd", removed: [".", "-"] });
  });

  it("keeps a character outside the basic plane whole", () => {
    expect(cleanHandle("ab🚀")).toEqual({ value: "ab", removed: ["🚀"] });
  });
});

describe("removedNote", () => {
  it("says nothing when nothing was dropped", () => {
    expect(removedNote([])).toBeNull();
  });

  it("names punctuation a screen reader would skip", () => {
    expect(removedNote(["-", "."])).toBe("Hyphens and dots aren’t allowed in usernames");
    expect(removedNote([" "])).toBe("Spaces aren’t allowed in usernames");
    expect(removedNote(["\t", " "])).toBe("Spaces aren’t allowed in usernames");
  });

  it("quotes anything else, singular when it is one character", () => {
    expect(removedNote(["@"])).toBe("“@” isn’t allowed in usernames");
    expect(removedNote(["@", "-"])).toBe("“@” and hyphens aren’t allowed in usernames");
  });

  it("stops listing after three", () => {
    expect(removedNote([" ", "!", "#", "@"])).toBe("Spaces, “!” and other symbols aren’t allowed in usernames");
  });
});
