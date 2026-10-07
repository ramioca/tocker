import { describe, expect, it } from "vitest";
import { rowsToTint } from "./tint";

const ids = ["strategy", "hunts", "data", "limits"];
const before = ["prompt", "Solana", "2 sources", "$25 a trade"];

describe("rowsToTint", () => {
  it("tints nothing when nothing changed", () => {
    expect(rowsToTint(ids, before, [...before], false)).toEqual([]);
  });

  it("tints nothing for one row: that is typing, or a slider", () => {
    expect(rowsToTint(ids, before, ["a new prompt", "Solana", "2 sources", "$25 a trade"], false)).toEqual([]);
  });

  it("tints every row one choice rewrote, and only those", () => {
    expect(rowsToTint(ids, before, ["a preset", "Solana", "3 sources", "$2 a trade"], false)).toEqual([
      "strategy",
      "data",
      "limits",
    ]);
  });

  it("tints nothing when the whole draft was swapped, however much changed", () => {
    expect(rowsToTint(ids, before, ["restored", "Base", "5 sources", "$5 a trade"], true)).toEqual([]);
  });
});
