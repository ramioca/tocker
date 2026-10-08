import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const components = join(process.cwd(), "src", "components");
const read = (...path: string[]) => readFileSync(join(components, ...path), "utf8");

const island = read("shell", "run-island.tsx");
const shell = read("shell", "app-shell.tsx");
const toaster = read("providers", "toaster.tsx");

/** The classes a constant is given, with a string written over several lines joined up. */
function classesOf(source: string, name: string): string[] {
  const value = source.match(new RegExp(`const ${name} =([\\s\\S]*?);\\n`))?.[1] ?? "";
  return [...value.matchAll(/"([^"]*)"/g)]
    .map(([, part]) => part)
    .join("")
    .split(/\s+/)
    .filter(Boolean);
}

/** Every class in a source whose variant mentions `needle`. A comment's words are not classes. */
function classesWith(source: string, needle: string): string[] {
  return [...source.matchAll(/[^\s"'`]+/g)].map(([word]) => word).filter((word) => word.includes(needle) && word.includes("_&]:"));
}

/** The whole class list that `name` is written in. */
function listWith(source: string, name: string): string[] {
  const lists = [...source.matchAll(/"([^"]*)"/g)].map(([, value]) => value.split(/\s+/).filter(Boolean));
  return lists.find((list) => list.includes(name)) ?? [];
}

/** A class without its breakpoint. */
const bare = (name: string) => name.replace(/^(max-)?md:/, "");

/** A length written in rem, in pixels. */
const px = (rem: string | undefined) => Number(rem) * 16;

/** The flag a sticky action bar holds on <html> (src/hooks/root-flag.ts), as a variant. */
const WITH_BAR = "[html[data-sticky-actionbar]_&]:";
const WITHOUT_BAR = "[html:not([data-sticky-actionbar])_";

/**
 * Where the two islands dock, and what makes room for them. Both are fixed over the page,
 * so a dock in the wrong place lies on something: the run island on the top bar's nav, the
 * approvals island on a page's Back, Next and Save. Read from the sources, because a class
 * is the whole of the rule.
 */
describe("where the islands dock", () => {
  const run = classesOf(island, "RUN_DOCK");
  const approvals = classesOf(island, "APPROVALS_DOCK");
  const top = run.find((name) => name.startsWith("top-"));

  it("finds both docks", () => {
    expect(run).toContain("fixed");
    expect(approvals).toContain("fixed");
  });

  it("puts the run island at the top, under the top bar", () => {
    // 3.5rem is the top bar.
    expect(top).toBe("top-[calc(3.5rem+0.625rem)]");
    expect(run.filter((name) => bare(name).startsWith("bottom-"))).toEqual([]);
  });

  it("puts the approvals island at the bottom: above the tab bar on a phone, bottom-centre from md", () => {
    expect(approvals).toContain("bottom-[calc(4rem+env(safe-area-inset-bottom))]");
    expect(approvals).toContain("md:bottom-6");
    expect(approvals.filter((name) => name.startsWith("top-"))).toEqual([]);
  });

  it("puts it where the run island is on a page with a sticky action bar, at every width", () => {
    // No breakpoint in front of either: a phone's bar is covered as much as a desktop's.
    expect(approvals.filter((name) => name.includes("sticky-actionbar")).sort()).toEqual(
      [`${WITH_BAR}${top}`, `${WITH_BAR}bottom-auto`].sort(),
    );
  });
});

describe("the room made at the bottom for a docked island", () => {
  const padding = classesWith(shell, "[data-run-island]").filter((name) => name.includes(":pb-"));
  const lifts = classesWith(toaster, "[data-run-island]");

  it("finds the page's padding and the toasts' lift, on a phone and from md", () => {
    expect(padding.map((name) => name.startsWith("md:"))).toEqual([false, true]);
    expect(lifts.map((name) => name.slice(0, name.indexOf(":")))).toEqual(["max-md", "md"]);
  });

  it("is not made on a page where the island is at the top", () => {
    for (const name of [...padding, ...lifts]) expect(bare(name).startsWith(WITHOUT_BAR), name).toBe(true);
  });
});

describe("the room made at the top for an island docked there", () => {
  const room = classesWith(shell, "[data-run-island]").filter((name) => !name.includes(":pb-"));
  const [shown = ""] = room;

  it("is one gap, opened on a page with a sticky action bar while the island is up, at every width", () => {
    // No breakpoint, like the dock: the island is at the top on a phone too.
    expect(room).toEqual(["[html[data-sticky-actionbar]_body:has([data-run-island])_&]:block"]);
  });

  it("is closed everywhere else", () => {
    expect(listWith(shell, shown)).toContain("hidden");
  });

  it("is under the top bar, before the pause banner and the page", () => {
    const at = shell.indexOf(shown);
    expect(at).toBeGreaterThan(shell.indexOf("<TopBar"));
    expect(at).toBeLessThan(shell.indexOf("<TradingPausedBanner"));
    expect(at).toBeLessThan(shell.indexOf("<main"));
  });

  it("is as tall as the island and the gap above it", () => {
    const top = classesOf(island, "RUN_DOCK").find((name) => name.startsWith("top-")) ?? "";
    const [, bar, gap] = top.match(/^top-\[calc\(([\d.]+)rem\+([\d.]+)rem\)\]$/) ?? [];
    // The gap starts where the top bar ends.
    expect(px(bar)).toBe(56);
    // The island: its padding, a 13px and an 11px line at 1.25, and its border.
    const islandHeight = 20 + 13 * 1.25 + 11 * 1.25 + 2;
    const height = listWith(shell, shown).find((name) => /^h-\d+$/.test(name)) ?? "";
    // A spacing step is a quarter of a rem.
    expect(Number(height.slice(2)) * 4).toBeGreaterThanOrEqual(px(gap) + islandHeight);
  });
});

describe("toasts on a page with a sticky action bar", () => {
  const lifts = classesWith(toaster, "[data-sticky-actionbar]").filter((name) => bare(name).startsWith(WITH_BAR));

  it("are lifted past the bar on a phone and from md", () => {
    expect(lifts.map((name) => name.slice(0, name.indexOf(":"))).sort()).toEqual(["max-md", "md"]);
  });

  it("clear the bar from md where it rests at the end of a page, not only where it sticks", () => {
    const lift = lifts.find((name) => name.startsWith("md:")) ?? "";
    const rem = Number(lift.match(/\[--toast-bottom:([\d.]+)rem\]/)?.[1]);
    // The page's own padding under the bar, then the bar: its padding, the agent strip
    // (its tallest child, shown below lg) and its top border.
    const restingTop = 24 + 12 + 48 + 12 + 1;
    expect(rem * 16).toBeGreaterThan(restingTop);
  });
});
