/**
 * The avatar picker's tiles and its shuffle, as plain values: which avatars are offered,
 * what a shuffle replaces and what it leaves, what each tile is called, and where the
 * arrow keys go.
 */
import { describe, expect, it } from "vitest";
import { AVATAR_SEED_RE, type AvatarChoice } from "@/lib/avatar";
import {
  PHOTO_TILE_NAME,
  PICKER_ROW,
  SHUFFLED,
  SHUFFLE_NAME,
  arrowTarget,
  pickerTiles,
  sameChoice,
  seedCount,
  seedsShowing,
  selectedIndex,
  shuffleSeeds,
  startSeeds,
  tabStop,
  tileNames,
} from "./avatar-picker-model";

/** A repeatable `rand`: a fixed sequence in [0, 1), started again by each call. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const never = () => {
  throw new Error("nothing random may be drawn here");
};

const GIVEN = ["aaaaaaaaa1", "aaaaaaaaa2", "aaaaaaaaa3", "aaaaaaaaa4", "aaaaaaaaa5"];
const seed = (value: string): AvatarChoice => ({ kind: "seed", seed: value });
const PHOTO: AvatarChoice = { kind: "photo" };

describe("the row", () => {
  it("is six circles: the photo if any, the generated ones, shuffle", () => {
    expect(PICKER_ROW).toBe(6);
    expect(seedCount(true)).toBe(4);
    expect(seedCount(false)).toBe(5);
    expect(pickerTiles(true, startSeeds({ pinned: null, hasPhoto: true })).length + 1).toBe(PICKER_ROW);
    expect(pickerTiles(false, startSeeds({ pinned: null, hasPhoto: false })).length + 1).toBe(PICKER_ROW);
  });

  it("puts the account's own photo first", () => {
    expect(pickerTiles(true, ["aaaaaaaaa1", "aaaaaaaaa2"])).toEqual([PHOTO, seed("aaaaaaaaa1"), seed("aaaaaaaaa2")]);
    expect(pickerTiles(false, ["aaaaaaaaa1"])).toEqual([seed("aaaaaaaaa1")]);
    expect(pickerTiles(false, [])).toEqual([]);
  });
});

describe("the tiles a picker opens with", () => {
  it("makes its own when none are given: the pinned one first, the rest new", () => {
    const seeds = startSeeds({ pinned: "pinnedseed", hasPhoto: false }, sequence(3));
    expect(seeds).toHaveLength(5);
    expect(seeds[0]).toBe("pinnedseed");
    for (const made of seeds.slice(1)) expect(made).toMatch(AVATAR_SEED_RE);
    expect(new Set(seeds).size).toBe(5);
    expect(startSeeds({ pinned: "pinnedseed", hasPhoto: true }, sequence(3))).toHaveLength(4);
    // Repeatable with an injected rand.
    expect(startSeeds({ pinned: null, hasPhoto: false }, sequence(9))).toEqual(
      startSeeds({ pinned: null, hasPhoto: false }, sequence(9)),
    );
  });

  it("draws nothing random when a server page gave them", () => {
    expect(startSeeds({ pinned: null, given: GIVEN, hasPhoto: false }, never)).toEqual(GIVEN);
    // Beside a photo the row holds one fewer.
    expect(startSeeds({ pinned: null, given: GIVEN, hasPhoto: true }, never)).toEqual(GIVEN.slice(0, 4));
    // Too few given is fewer tiles, never a random one: the server's render must match.
    expect(startSeeds({ pinned: null, given: GIVEN.slice(0, 2), hasPhoto: false }, never)).toEqual(GIVEN.slice(0, 2));
    expect(startSeeds({ pinned: null, given: [], hasPhoto: false }, never)).toEqual([]);
  });

  it("keeps the saved avatar first among the given ones, once", () => {
    expect(startSeeds({ pinned: "savedseed1", given: GIVEN, hasPhoto: false }, never)).toEqual([
      "savedseed1",
      ...GIVEN.slice(0, 4),
    ]);
    // The saved one happens to be among those given.
    expect(startSeeds({ pinned: GIVEN[2], given: GIVEN, hasPhoto: true }, never)).toEqual([
      GIVEN[2],
      GIVEN[0],
      GIVEN[1],
      GIVEN[3],
    ]);
  });

  it("leaves out anything given that is not a seed, and a repeat", () => {
    const given = ["aaaaaaaaa1", "Not A Seed", "aaaaaaaaa1", "", "user5a5ppx!", "aaaaaaaaa2"];
    expect(startSeeds({ pinned: null, given, hasPhoto: false }, never)).toEqual(["aaaaaaaaa1", "aaaaaaaaa2"]);
  });
});

describe("shuffle", () => {
  it("replaces every generated avatar but the selected one, which stays where it is", () => {
    const before = ["aaaaaaaaa1", "aaaaaaaaa2", "aaaaaaaaa3", "aaaaaaaaa4", "aaaaaaaaa5"];
    const after = shuffleSeeds(before, "aaaaaaaaa3", sequence(5));
    expect(after).toHaveLength(5);
    expect(after[2]).toBe("aaaaaaaaa3");
    for (const [index, made] of after.entries()) {
      if (index === 2) continue;
      expect(made).toMatch(AVATAR_SEED_RE);
      // Never one that was just on screen.
      expect(before).not.toContain(made);
    }
    expect(new Set(after).size).toBe(5);
    // The tiles it was given are not changed in place.
    expect(before[0]).toBe("aaaaaaaaa1");
  });

  it("replaces all of them when the photo, or nothing, is selected", () => {
    const before = ["aaaaaaaaa1", "aaaaaaaaa2", "aaaaaaaaa3", "aaaaaaaaa4"];
    const after = shuffleSeeds(before, null, sequence(2));
    expect(after).toHaveLength(4);
    for (const made of after) expect(before).not.toContain(made);
    expect(new Set(after).size).toBe(4);
  });

  it("is repeatable with an injected rand, and different each time without one", () => {
    const before = ["aaaaaaaaa1", "aaaaaaaaa2", "aaaaaaaaa3"];
    expect(shuffleSeeds(before, "aaaaaaaaa1", sequence(8))).toEqual(shuffleSeeds(before, "aaaaaaaaa1", sequence(8)));
    expect(shuffleSeeds(before, null)).not.toEqual(shuffleSeeds(before, null));
  });

  it("leaves a tile as it was, rather than loop or repeat, on a rand that is stuck", () => {
    // A stuck rand makes one seed over and over: the first tile takes it, the rest stay.
    expect(shuffleSeeds(["bbbbbbbbb1", "bbbbbbbbb2", "bbbbbbbbb3"], null, () => 0)).toEqual([
      "aaaaaaaaaa",
      "bbbbbbbbb2",
      "bbbbbbbbb3",
    ]);
    expect(shuffleSeeds([], null, () => 0)).toEqual([]);
  });
});

describe("an avatar selected somewhere else", () => {
  const row = ["aaaaaaaaa1", "aaaaaaaaa2", "aaaaaaaaa3", "aaaaaaaaa4", "aaaaaaaaa5"];
  const elsewhere: AvatarChoice = { kind: "seed", seed: "k3j9x0a1bz" };

  it("takes the first generated tile, so what is selected can be seen", () => {
    const shown = seedsShowing(row, elsewhere);
    expect(shown).toEqual(["k3j9x0a1bz", ...row.slice(1)]);
    expect(selectedIndex(pickerTiles(false, shown), elsewhere)).toBe(0);
    // Beside a photo it is the first generated one, after the photo.
    expect(selectedIndex(pickerTiles(true, seedsShowing(row.slice(0, 4), elsewhere)), elsewhere)).toBe(1);
  });

  it("hands back the very same list when there is nothing to add", () => {
    expect(seedsShowing(row, null)).toBe(row);
    expect(seedsShowing(row, { kind: "photo" })).toBe(row);
    expect(seedsShowing(row, { kind: "seed", seed: row[3] })).toBe(row);
    const none: string[] = [];
    expect(seedsShowing(none, elsewhere)).toBe(none);
  });

  it("stays put through a shuffle, like any selected tile", () => {
    const shown = seedsShowing(row, elsewhere);
    expect(shuffleSeeds(shown, elsewhere.seed, sequence(7))[0]).toBe(elsewhere.seed);
  });
});

describe("which tile is selected", () => {
  it("compares choices by what they are", () => {
    expect(sameChoice(PHOTO, { kind: "photo" })).toBe(true);
    expect(sameChoice(seed("aaaaaaaaa1"), seed("aaaaaaaaa1"))).toBe(true);
    expect(sameChoice(seed("aaaaaaaaa1"), seed("aaaaaaaaa2"))).toBe(false);
    expect(sameChoice(PHOTO, seed("aaaaaaaaa1"))).toBe(false);
    expect(sameChoice(seed("aaaaaaaaa1"), PHOTO)).toBe(false);
    expect(sameChoice(null, null)).toBe(true);
    expect(sameChoice(null, PHOTO)).toBe(false);
    expect(sameChoice(seed("aaaaaaaaa1"), null)).toBe(false);
  });

  it("finds it in the row, and stops Tab on it, or on the first tile when none is", () => {
    const tiles = pickerTiles(true, ["aaaaaaaaa1", "aaaaaaaaa2"]);
    expect(selectedIndex(tiles, PHOTO)).toBe(0);
    expect(selectedIndex(tiles, seed("aaaaaaaaa2"))).toBe(2);
    expect(tabStop(tiles, seed("aaaaaaaaa2"))).toBe(2);
    // Nothing picked yet (Settings, on an account with neither a picked avatar nor a photo).
    expect(selectedIndex(tiles, null)).toBe(-1);
    expect(tabStop(tiles, null)).toBe(0);
    // A choice that is not in the row selects no tile.
    expect(selectedIndex(tiles, seed("zzzzzzzzz9"))).toBe(-1);
    expect(tabStop(tiles, seed("zzzzzzzzz9"))).toBe(0);
  });
});

describe("what a screen reader hears", () => {
  it("names the photo, and numbers the generated ones from 1", () => {
    expect(tileNames(pickerTiles(true, ["aaaaaaaaa1", "aaaaaaaaa2"]))).toEqual([PHOTO_TILE_NAME, "Avatar 1", "Avatar 2"]);
    expect(tileNames(pickerTiles(false, ["aaaaaaaaa1", "aaaaaaaaa2"]))).toEqual(["Avatar 1", "Avatar 2"]);
  });

  it("uses the design's words", () => {
    expect(PHOTO_TILE_NAME).toBe("Your photo");
    expect(SHUFFLE_NAME).toBe("Show other avatars");
    expect(SHUFFLED).toBe("New avatars");
  });
});

describe("the arrow keys", () => {
  it("move one tile and wrap at both ends", () => {
    expect(arrowTarget("ArrowRight", 0, 5)).toBe(1);
    expect(arrowTarget("ArrowDown", 3, 5)).toBe(4);
    expect(arrowTarget("ArrowRight", 4, 5)).toBe(0);
    expect(arrowTarget("ArrowLeft", 2, 5)).toBe(1);
    expect(arrowTarget("ArrowUp", 0, 5)).toBe(4);
  });

  it("jump to either end with Home and End", () => {
    expect(arrowTarget("Home", 3, 5)).toBe(0);
    expect(arrowTarget("End", 1, 5)).toBe(4);
  });

  it("leave every other key alone", () => {
    for (const key of ["Enter", " ", "Tab", "Escape", "a"]) expect(arrowTarget(key, 2, 5), key).toBeNull();
    expect(arrowTarget("ArrowRight", 0, 0)).toBeNull();
  });
});
