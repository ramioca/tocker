/**
 * The avatar picker's tiles, outside the component so they can be tested: which avatars
 * are offered, what shuffle replaces, what each tile is called and where an arrow key
 * goes. No React. The seeds themselves are made by `src/lib/avatar.ts`.
 */
import { AVATAR_SEED_RE, avatarTiles, randomSeed, type AvatarChoice } from "@/lib/avatar";

/** Circles in the row: the tiles, then shuffle. */
export const PICKER_ROW = 6;
/** The size a tile is drawn at, in CSS pixels. */
export const TILE_PX = 44;

export const PHOTO_TILE_NAME = "Your photo";
export const SHUFFLE_NAME = "Show other avatars";
/** Said to a screen reader after each shuffle. */
export const SHUFFLED = "New avatars";

/** How many generated avatars are offered: the row, less shuffle, less the photo when there is one. */
export function seedCount(hasPhoto: boolean): number {
  return PICKER_ROW - 1 - (hasPhoto ? 1 : 0);
}

/**
 * The generated avatars the picker opens with. `pinned` (the saved one, or the one the
 * caller preselected) comes first and is kept as it is.
 *
 * With `given`, nothing random is drawn here: those are seeds a server page made, and a
 * form the server also renders must open with the same tiles in the browser. Anything in
 * them that is not a seed is left out, and so is a repeat.
 */
export function startSeeds(
  input: { pinned: string | null; given?: readonly string[]; hasPhoto: boolean },
  rand: () => number = Math.random,
): string[] {
  const count = seedCount(input.hasPhoto);
  if (!input.given) return avatarTiles(input.pinned, count, rand);
  const seeds: string[] = input.pinned !== null ? [input.pinned] : [];
  for (const seed of input.given) {
    if (seeds.length >= count) break;
    if (AVATAR_SEED_RE.test(seed) && !seeds.includes(seed)) seeds.push(seed);
  }
  return seeds;
}

/**
 * Shuffle: every generated avatar but the selected one is replaced, and the selected one
 * stays where it is. A new seed is never one that was just on screen.
 */
export function shuffleSeeds(
  seeds: readonly string[],
  keep: string | null,
  rand: () => number = Math.random,
): string[] {
  const seen = new Set(seeds);
  return seeds.map((seed) => {
    if (seed === keep) return seed;
    // A repeat is one chance in 36^10 per draw. The bound is for a `rand` that is stuck,
    // which leaves the tile as it was.
    for (let tries = 0; tries < 20; tries += 1) {
      const next = randomSeed(rand);
      if (!seen.has(next)) {
        seen.add(next);
        return next;
      }
    }
    return seed;
  });
}

/**
 * The row's generated avatars with the selected one among them. A selection the row did
 * not make (the first-run card saving an avatar while the Settings form is on screen)
 * takes the first place, so what is selected can be seen. The same list is handed back
 * when there is nothing to add, which is how the picker knows to leave its tiles alone.
 */
export function seedsShowing(seeds: readonly string[], value: AvatarChoice | null): readonly string[] {
  if (value?.kind !== "seed" || seeds.length === 0 || seeds.includes(value.seed)) return seeds;
  return [value.seed, ...seeds.slice(1)];
}

/** The tiles in the order they are drawn: the account's own photo first, when it has one. */
export function pickerTiles(hasPhoto: boolean, seeds: readonly string[]): AvatarChoice[] {
  const photo: AvatarChoice[] = hasPhoto ? [{ kind: "photo" }] : [];
  return [...photo, ...seeds.map((seed): AvatarChoice => ({ kind: "seed", seed }))];
}

export function sameChoice(a: AvatarChoice | null, b: AvatarChoice | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "photo" || b.kind === "photo") return a.kind === b.kind;
  return a.seed === b.seed;
}

/** What a screen reader calls each tile: "Your photo", then "Avatar 1", "Avatar 2"… */
export function tileNames(tiles: readonly AvatarChoice[]): string[] {
  let n = 0;
  return tiles.map((tile) => {
    if (tile.kind === "photo") return PHOTO_TILE_NAME;
    n += 1;
    return `Avatar ${n}`;
  });
}

/** The selected tile's place in the row, or -1 when none is selected. */
export function selectedIndex(tiles: readonly AvatarChoice[], value: AvatarChoice | null): number {
  return tiles.findIndex((tile) => sameChoice(tile, value));
}

/** The one tile Tab stops on, as in any radio group: the selected one, or the first when none is. */
export function tabStop(tiles: readonly AvatarChoice[], value: AvatarChoice | null): number {
  return Math.max(0, selectedIndex(tiles, value));
}

/** Where a key moves from tile `from`, wrapping at both ends; null for a key that moves nothing. */
export function arrowTarget(key: string, from: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (from + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (from - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
