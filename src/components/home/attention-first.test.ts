import { describe, expect, it } from "vitest";
import { attentionFirst } from "./attention-first";

const agents = ["a7", "a6", "a5", "a4", "a3", "a2", "a1"].map((id) => ({ id }));

describe("attentionFirst", () => {
  it("lifts blocked agents into the first six, keeping newest-first within each group", () => {
    const ordered = attentionFirst(agents, new Set(["a1", "a5"]));
    expect(ordered.map((a) => a.id)).toEqual(["a5", "a1", "a7", "a6", "a4", "a3", "a2"]);
    expect(ordered.slice(0, 6).map((a) => a.id)).toContain("a1");
  });

  it("leaves the order alone when nothing is blocked", () => {
    expect(attentionFirst(agents, new Map())).toEqual(agents);
    expect(attentionFirst(agents)).toBe(agents);
  });

  it("does not reorder the caller's array", () => {
    const input = [...agents];
    attentionFirst(input, new Set(["a1"]));
    expect(input).toEqual(agents);
  });
});
