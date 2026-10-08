import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearEditStashes, dropStash, keepStash, offerFrom, resumeKeeping, takeStash } from "./use-edit-stash";

interface Copy {
  name: string;
  cap: number;
}

const same = (a: Copy, b: Copy) => a.name === b.name && a.cap === b.cap;
const saved: Copy = { name: "Aileen", cap: 100 };
const edited: Copy = { name: "Aileen", cap: 250 };

describe("the stash of unsaved edits", () => {
  // The stashes are the module's own, so every test starts from none, with a page open.
  beforeEach(() => {
    clearEditStashes();
    resumeKeeping();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is kept for one owner and one agent, and handed to no other", () => {
    keepStash("owner_1", "a1", { base: saved, working: edited });
    // Another account on the same agent, and the same account on another agent.
    expect(takeStash<Copy>("owner_2", "a1")).toBeNull();
    expect(takeStash<Copy>("owner_1", "a2")).toBeNull();
    expect(takeStash<Copy>("owner_1", "a1")).toEqual({ base: saved, working: edited });
  });

  it("does not take two ids that run into each other for one", () => {
    keepStash("did:privy:a", "b:c", { base: saved, working: edited });
    expect(takeStash<Copy>("did:privy:a:b", "c")).toBeNull();
    expect(takeStash<Copy>("did:privy", "a:b:c")).toBeNull();
    expect(takeStash<Copy>("did:privy:a", "b:c")).not.toBeNull();
  });

  it("is handed back once", () => {
    keepStash("owner_1", "a1", { base: saved, working: edited });
    expect(takeStash<Copy>("owner_1", "a1")).not.toBeNull();
    expect(takeStash<Copy>("owner_1", "a1")).toBeNull();
  });

  it("is the copies themselves, as they were when the page went away", () => {
    keepStash("owner_1", "a1", { base: saved, working: edited });
    const stash = takeStash<Copy>("owner_1", "a1");
    expect(stash?.base).toBe(saved);
    expect(stash?.working).toBe(edited);
  });

  it("is replaced by a later one for the same owner and agent", () => {
    keepStash("owner_1", "a1", { base: saved, working: edited });
    keepStash("owner_1", "a1", { base: saved, working: { name: "Aileen", cap: 500 } });
    expect(takeStash<Copy>("owner_1", "a1")?.working.cap).toBe(500);
  });

  it("is gone once dropped, and the others stay", () => {
    keepStash("owner_1", "a1", { base: saved, working: edited });
    keepStash("owner_1", "a2", { base: saved, working: edited });
    dropStash("owner_1", "a1");
    expect(takeStash<Copy>("owner_1", "a1")).toBeNull();
    expect(takeStash<Copy>("owner_1", "a2")).not.toBeNull();
    expect(() => dropStash("owner_1", "never kept")).not.toThrow();
  });

  it("is forgotten on sign-out, whoever left it", () => {
    keepStash("owner_1", "a1", { base: saved, working: edited });
    keepStash("owner_1", "a2", { base: saved, working: edited });
    keepStash("owner_2", "a3", { base: saved, working: edited });
    clearEditStashes();
    expect(takeStash<Copy>("owner_1", "a1")).toBeNull();
    expect(takeStash<Copy>("owner_1", "a2")).toBeNull();
    expect(takeStash<Copy>("owner_2", "a3")).toBeNull();
  });

  it("is not kept by a page that leaves after the sign-out, until a settings page opens again", () => {
    clearEditStashes();
    // The page that was open leaves with the account, a moment after the clear.
    keepStash("owner_1", "a1", { base: saved, working: edited });
    expect(takeStash<Copy>("owner_1", "a1")).toBeNull();
    resumeKeeping();
    keepStash("owner_1", "a1", { base: saved, working: edited });
    expect(takeStash<Copy>("owner_1", "a1")).toEqual({ base: saved, working: edited });
  });

  it("never reaches the browser's storage, which could outlast a sign-out made from another tab", () => {
    const touched: string[] = [];
    const storage = (name: string) =>
      new Proxy(
        {},
        {
          get: (_target, property) => {
            touched.push(`${name}.${String(property)}`);
            return () => null;
          },
        },
      );
    vi.stubGlobal("window", { sessionStorage: storage("sessionStorage"), localStorage: storage("localStorage") });
    vi.stubGlobal("sessionStorage", storage("sessionStorage"));
    vi.stubGlobal("localStorage", storage("localStorage"));

    keepStash("owner_1", "a1", { base: saved, working: edited });
    keepStash("owner_1", "a2", { base: saved, working: edited });
    takeStash<Copy>("owner_1", "a1");
    dropStash("owner_1", "a2");
    clearEditStashes();
    resumeKeeping();
    expect(touched).toEqual([]);
  });
});

describe("what is offered back", () => {
  it("is the working copy, when it was made from what is saved now and differs from it", () => {
    expect(offerFrom({ base: saved, working: edited }, saved, same)).toBe(edited);
  });

  it("is nothing when there is no stash", () => {
    expect(offerFrom(null, saved, same)).toBeNull();
  });

  it("is nothing when the agent was changed since the edits were made", () => {
    expect(offerFrom({ base: saved, working: edited }, { name: "Aileen", cap: 50 }, same)).toBeNull();
  });

  it("is nothing when the edits were saved after all", () => {
    // The edits and the base both differ from what is saved now, and nothing is left to restore.
    expect(offerFrom({ base: saved, working: edited }, edited, same)).toBeNull();
    // Kept with nothing unsaved in it.
    expect(offerFrom({ base: saved, working: { ...saved } }, saved, same)).toBeNull();
  });

  it("is nothing when the stash cannot be compared", () => {
    const throws = () => {
      throw new Error("not comparable");
    };
    expect(offerFrom({ base: saved, working: edited }, saved, throws)).toBeNull();
  });
});
