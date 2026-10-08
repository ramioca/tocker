/**
 * The links into an agent's settings, decided without a browser: the address of each
 * spot, the step and control it lands on, and that every hash the rest of the app still
 * hands out is one the page knows.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SETTINGS_STEPS, type SettingsStepId } from "@/components/agents/builder/contract";
import { stopFix } from "@/components/agents/thinking";
import { INFERENCE_STOPS, type InferenceStopReason } from "@/lib/x402/inference-types";
import {
  ANCHOR_PLACE,
  agentSettingsHref,
  parseAnchor,
  placeOfAnchor,
  type SettingsAnchor,
} from "./settings-href";

const ANCHORS = Object.keys(ANCHOR_PLACE) as SettingsAnchor[];

/** The sections of the Manage step, the only step that has any. */
const MANAGE_SECTIONS = ["wallets", "withdraw", "live", "delete"];

describe("ANCHOR_PLACE", () => {
  it("lands every anchor on its step, its control and, on Manage, its section", () => {
    expect(ANCHOR_PLACE).toEqual({
      status: { step: "name", focusIds: ["agent-status-toggle"] },
      strategy: { step: "strategy", focusIds: ["strategy-prompt"] },
      brain: { step: "brain", focusIds: ["llm-key", "llm-key-add", "builder-think-key"] },
      thinking: { step: "brain", focusIds: ["builder-usdc-model"] },
      universe: { step: "hunts" },
      data: { step: "data" },
      execution: { step: "schedule", focusIds: ["builder-execution-approve"] },
      risk: { step: "limits" },
      exits: { step: "limits", focusIds: ["risk-exits"] },
      wallets: { step: "manage", sub: "wallets", focusIds: ["manage-wallets"] },
      withdraw: { step: "manage", sub: "withdraw", focusIds: ["manage-withdraw"] },
      budget: { step: "manage", sub: "live", focusIds: ["budget-per-tx"] },
      mode: { step: "manage", sub: "live", focusIds: ["manage-live"] },
      delete: { step: "manage", sub: "delete", focusIds: ["manage-delete"] },
    });
  });

  it("only names steps the settings page has", () => {
    for (const anchor of ANCHORS) expect(SETTINGS_STEPS, anchor).toContain(ANCHOR_PLACE[anchor].step);
    // The builder's last step holds the Create button, which a saved agent has no use for.
    expect(ANCHORS.map((anchor) => ANCHOR_PLACE[anchor].step as string)).not.toContain("create");
  });

  it("names a section for every Manage anchor, and for no other", () => {
    for (const anchor of ANCHORS) {
      const place = ANCHOR_PLACE[anchor];
      if (place.step === "manage") expect(MANAGE_SECTIONS, anchor).toContain(place.sub);
      else expect(place.sub, anchor).toBeUndefined();
    }
  });

  it("reaches every Manage section", () => {
    const reached = new Set(ANCHORS.map((anchor) => ANCHOR_PLACE[anchor].sub).filter(Boolean));
    expect([...reached].sort()).toEqual([...MANAGE_SECTIONS].sort());
  });

  it("is a place and nothing more", () => {
    for (const anchor of ANCHORS) {
      const place = ANCHOR_PLACE[anchor];
      expect(Object.keys(place).filter((key) => !["step", "focusIds", "sub"].includes(key)), anchor).toEqual([]);
      // A focus list that is present has something in it; no list means the step's heading.
      if (place.focusIds) expect(place.focusIds.length, anchor).toBeGreaterThan(0);
    }
  });
});

describe("agentSettingsHref", () => {
  it("is the settings page itself when no spot is named", () => {
    expect(agentSettingsHref("a")).toBe("/agents/a/settings");
    expect(agentSettingsHref("momentum-fox")).toBe("/agents/momentum-fox/settings");
  });

  it("names the step and the spot", () => {
    expect(agentSettingsHref("a", "risk")).toBe("/agents/a/settings?step=limits#risk");
    expect(agentSettingsHref("a", "brain")).toBe("/agents/a/settings?step=brain#brain");
    expect(agentSettingsHref("a", "thinking")).toBe("/agents/a/settings?step=brain#thinking");
    expect(agentSettingsHref("a", "universe")).toBe("/agents/a/settings?step=hunts#universe");
    expect(agentSettingsHref("a", "wallets")).toBe("/agents/a/settings?step=manage#wallets");
    expect(agentSettingsHref("a", "budget")).toBe("/agents/a/settings?step=manage#budget");
    expect(agentSettingsHref("a", "withdraw")).toBe("/agents/a/settings?step=manage#withdraw");
  });

  it("keeps a link to the status button on the first step", () => {
    expect(agentSettingsHref("a", "status")).toBe("/agents/a/settings?step=name#status");
  });

  it("writes an address that reads back as the same place", () => {
    for (const anchor of ANCHORS) {
      const url = new URL(agentSettingsHref("a", anchor), "https://example.test");
      expect(url.pathname, anchor).toBe("/agents/a/settings");
      expect([...url.searchParams.keys()], anchor).toEqual(["step"]);
      expect(url.searchParams.get("step"), anchor).toBe(ANCHOR_PLACE[anchor].step);
      expect(url.hash, anchor).toBe(`#${anchor}`);
      expect(placeOfAnchor(url.hash), anchor).toEqual(ANCHOR_PLACE[anchor]);
    }
  });
});

describe("placeOfAnchor", () => {
  it("still lands every hash the one-page settings had", () => {
    const old: Record<string, SettingsStepId> = {
      "#strategy": "strategy",
      "#brain": "brain",
      "#thinking": "brain",
      "#universe": "hunts",
      "#data": "data",
      "#execution": "schedule",
      "#risk": "limits",
      "#wallets": "manage",
      "#budget": "manage",
      "#mode": "manage",
      "#withdraw": "manage",
    };
    for (const [hash, step] of Object.entries(old)) expect(placeOfAnchor(hash)?.step, hash).toBe(step);
  });

  it("lands the anchors the stepped page adds", () => {
    expect(placeOfAnchor("#exits")).toEqual({ step: "limits", focusIds: ["risk-exits"] });
    expect(placeOfAnchor("#delete")).toEqual({ step: "manage", sub: "delete", focusIds: ["manage-delete"] });
    expect(placeOfAnchor("#status")).toEqual({ step: "name", focusIds: ["agent-status-toggle"] });
  });

  it("reads a hash with or without its #", () => {
    expect(placeOfAnchor("risk")).toEqual(placeOfAnchor("#risk"));
    expect(parseAnchor("#wallets")).toBe("wallets");
    expect(parseAnchor("wallets")).toBe("wallets");
  });

  it("answers null for anything that is not an anchor", () => {
    for (const hash of [
      "",
      "#",
      "#nonsense",
      "#Risk",
      "#RISK",
      "##risk",
      "# risk",
      "#risk ",
      "#risk?step=limits",
      // A step id is not an anchor unless a section happened to carry the same name.
      "#limits",
      "#hunts",
      "#manage",
      "#name",
      // A focus id is not an anchor either.
      "#budget-per-tx",
      "#manage-wallets",
      // Names every object has must not pass as one.
      "#toString",
      "#constructor",
      "#__proto__",
      "#hasOwnProperty",
    ]) {
      expect(placeOfAnchor(hash), JSON.stringify(hash)).toBeNull();
      expect(parseAnchor(hash), JSON.stringify(hash)).toBeNull();
    }
  });

  it("hands out a copy, so a caller cannot change where a link lands", () => {
    const place = placeOfAnchor("#brain");
    expect(place).not.toBe(ANCHOR_PLACE.brain);
    place?.focusIds?.push("somewhere-else");
    if (place) place.step = "name";
    expect(ANCHOR_PLACE.brain).toEqual({ step: "brain", focusIds: ["llm-key", "llm-key-add", "builder-think-key"] });
    expect(placeOfAnchor("#brain")).toEqual(ANCHOR_PLACE.brain);
    // A place with nothing to focus stays without a list.
    expect(placeOfAnchor("#risk")).toEqual({ step: "limits" });
    expect(placeOfAnchor("#risk")).not.toHaveProperty("focusIds");
  });
});

describe("the hashes the rest of the app hands out", () => {
  it("knows the fix for every reason an agent stops thinking", () => {
    const reasons = Object.keys(INFERENCE_STOPS) as InferenceStopReason[];
    // A reason this build does not know gets the fallback, which is a settings hash too.
    const fixes = [...reasons, "a_reason_from_the_future" as InferenceStopReason].map((reason) => ({
      reason,
      fix: stopFix(reason),
    }));
    const hashes = fixes.flatMap(({ fix }) => ("hash" in fix ? [fix.hash] : []));
    expect(hashes.length).toBeGreaterThan(0);
    for (const { reason, fix } of fixes) {
      if (!("hash" in fix)) continue;
      const anchor = parseAnchor(fix.hash);
      expect(anchor, `${reason}: ${fix.hash}`).not.toBeNull();
      // The link keeps the hash it has always had; only the step in front of it is new.
      if (anchor) expect(agentSettingsHref("a", anchor).endsWith(fix.hash), reason).toBe(true);
    }
  });

  it("knows every settings section a refused buy points at", () => {
    // `REFUSAL_COPY` is private to the status query, so its hashes are read from the source.
    const source = readFileSync(new URL("../../../server/queries/agent-status.ts", import.meta.url), "utf8");
    const block = /const REFUSAL_COPY\b[\s\S]*?=\s*\{\n([\s\S]*?)\n\};/.exec(source)?.[1] ?? "";
    const hashes = [...block.matchAll(/\bhash:\s*"([^"]*)"/g)].map(([, hash]) => hash);
    expect(hashes.length, "no hash found in REFUSAL_COPY").toBeGreaterThan(0);
    for (const hash of hashes) expect(placeOfAnchor(hash), hash).not.toBeNull();
  });
});
