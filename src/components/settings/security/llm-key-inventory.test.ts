/**
 * The "agents have no key" notice on the Security tab. What it offers is decided by
 * `keylessOffer`, which is pure; the promise it makes has to match what
 * `attachKeyToKeylessAgents` does, which attaches a key only to agents set to that
 * key's provider.
 */
import { describe, expect, it } from "vitest";
import { keylessOffer } from "./llm-key-inventory";

const one = { keyCount: 1, onlyKeyLast4: "9f3a" };

describe("keylessOffer", () => {
  it("says nothing when every agent has a key", () => {
    expect(keylessOffer({ keylessAgents: 0, attachable: 0, ...one })).toEqual({ kind: "none" });
  });

  it("asks for a key when there is none to attach", () => {
    expect(keylessOffer({ keylessAgents: 2, attachable: 0, keyCount: 0, onlyKeyLast4: null })).toEqual({ kind: "add" });
  });

  it("offers the only key to the agents it fits, in the words it always used when it fits them all", () => {
    expect(keylessOffer({ keylessAgents: 1, attachable: 1, ...one })).toEqual({
      kind: "attach",
      label: "Attach the key ending 9f3a to it",
    });
    expect(keylessOffer({ keylessAgents: 3, attachable: 3, ...one })).toEqual({
      kind: "attach",
      label: "Attach the key ending 9f3a to them",
    });
  });

  it("quotes how many it fits when some agents are set to another provider", () => {
    expect(keylessOffer({ keylessAgents: 3, attachable: 2, ...one })).toEqual({
      kind: "attach",
      label: "Attach the key ending 9f3a to the 2 agents it fits",
    });
    expect(keylessOffer({ keylessAgents: 3, attachable: 1, ...one })).toEqual({
      kind: "attach",
      label: "Attach the key ending 9f3a to the 1 agent it fits",
    });
  });

  it("does not offer a key that fits none of them", () => {
    // Three agents set to Anthropic and one Groq key: attaching would change nothing.
    expect(keylessOffer({ keylessAgents: 3, attachable: 0, ...one })).toEqual({ kind: "pick" });
  });

  it("leaves the choice to each agent when there are several keys", () => {
    expect(keylessOffer({ keylessAgents: 2, attachable: 2, keyCount: 2, onlyKeyLast4: null })).toEqual({ kind: "pick" });
  });
});
