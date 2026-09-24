import { describe, expect, it } from "vitest";
import { clip, reinsert } from "./key-removal";

const a = { id: "a" };
const b = { id: "b" };
const c = { id: "c" };

describe("reinsert", () => {
  it("puts a row back where it was", () => {
    expect(reinsert([a, c], b, 1)).toEqual([a, b, c]);
  });

  it("clamps an index the list has since outgrown or lost", () => {
    // Removing a second key while the first is still pending shortens the list.
    expect(reinsert([a], c, 2)).toEqual([a, c]);
    expect(reinsert([a], c, -1)).toEqual([c, a]);
  });

  it("never duplicates a row that is already back", () => {
    const list = [a, b];
    expect(reinsert(list, b, 0)).toBe(list);
  });
});

describe("clip", () => {
  it("leaves short text alone", () => {
    expect(clip("Personal key", 24)).toBe("Personal key");
    expect(clip("x".repeat(24), 24)).toBe("x".repeat(24));
  });

  it("cuts long text to the limit, ellipsis included", () => {
    const clipped = clip("My very long OpenRouter production key", 24);
    expect(clipped).toHaveLength(24);
    expect(clipped.endsWith("…")).toBe(true);
  });

  it("does not leave a space before the ellipsis", () => {
    expect(clip("Anthropic key for agents", 11)).toBe("Anthropic…");
  });
});
