"use client";

import { useRef, useState } from "react";
import { Shuffle } from "lucide-react";
import { Mark } from "@/components/agents/builder/look";
import { UserAvatar } from "@/components/common/user-avatar";
import { photoAt, type AvatarChoice } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import {
  SHUFFLED,
  SHUFFLE_NAME,
  TILE_PX,
  arrowTarget,
  pickerTiles,
  sameChoice,
  seedsShowing,
  shuffleSeeds,
  startSeeds,
  tabStop,
  tileNames,
} from "./avatar-picker-model";

/**
 * The selection ring, drawn 2px outside the tile by a pseudo-element, so the gap shows
 * whatever the picker sits on (the first-run glass, a Settings card) with no ground
 * colour to keep in step. It is faded by opacity, so an unselected tile has no ring in
 * forced colours either, where a transparent outline would turn solid. Keyboard focus is
 * the same ring with the builder's 3px violet halo, and is not animated.
 */
const TILE_RING =
  "before:pointer-events-none before:absolute before:-inset-1 before:rounded-full before:border-2 " +
  "before:transition-[opacity,border-color] before:duration-150 " +
  "focus-visible:outline-none focus-visible:before:border-primary focus-visible:before:opacity-100 " +
  "focus-visible:before:shadow-[0_0_0_3px_rgb(122_92_255/0.3)]";

const PRESS =
  "transition-[scale,color,background-color] duration-150 ease-[var(--ease-out-strong)] " +
  "active:scale-[0.94] motion-reduce:active:scale-100";

/**
 * One row of avatars to pick from: the account's own photo when it has one, generated
 * ones, and shuffle. The first-run card and Settings both draw this.
 *
 * The row runs edge to edge of whatever holds it, so the caller sets its width. The
 * selected tile's ring reaches 4px outside the row, and 7px with keyboard focus: a
 * holder that clips must leave it that room.
 */
export function AvatarPicker({
  photoUrl,
  pinnedSeed,
  initialSeeds,
  value,
  onChange,
  disabled = false,
  handle = "",
  className,
}: {
  /** The account's own photo link. Offered first, when it is one the app will show. */
  photoUrl: string | null;
  /** The saved avatar, or the one the caller preselected: always the first generated tile. */
  pinnedSeed: string | null;
  /**
   * Generated avatars made by a server page. Without them the picker makes its own,
   * which is only right where the server does not render it too (a dialog): random tiles
   * made on both sides would differ.
   */
  initialSeeds?: readonly string[];
  /** Null while nothing is picked: no tile is selected. */
  value: AvatarChoice | null;
  onChange: (choice: AvatarChoice) => void;
  disabled?: boolean;
  /** Only for the avatar under the photo tile, which shows if the photo's link is dead. */
  handle?: string;
  className?: string;
}) {
  const hasPhoto = photoAt(photoUrl, TILE_PX) !== null;
  // Read once. A server page hands in new seeds every time it renders (after a save, for
  // one), and the tiles must not change under the person choosing.
  const [held, setHeld] = useState<readonly string[]>(() =>
    startSeeds({ pinned: pinnedSeed, given: initialSeeds, hasPhoto }),
  );
  const [shuffles, setShuffles] = useState(0);
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // The selected avatar is always one of the tiles, also when it was chosen somewhere
  // else. Kept from then on, so it is still there to go back to after trying another.
  const seeds = seedsShowing(held, value);
  if (seeds !== held) setHeld(seeds);
  const tiles = pickerTiles(hasPhoto, seeds);
  const names = tileNames(tiles);
  const stop = tabStop(tiles, value);

  return (
    <div className={cn("flex items-center", className)}>
      <div role="radiogroup" aria-label="Avatar" className="flex min-w-0 flex-1 items-center justify-between gap-1">
        {tiles.map((tile, index) => {
          const selected = sameChoice(tile, value);
          return (
            <button
              // A seed is its own key, so a re-rolled tile is a new node and plays its entrance.
              key={tile.kind === "photo" ? "photo" : tile.seed}
              ref={(node) => {
                tileRefs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={names[index]}
              tabIndex={index === stop ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(tile)}
              onKeyDown={(event) => {
                // As in any radio group: an arrow moves and selects at once.
                const to = arrowTarget(event.key, index, tiles.length);
                if (to === null) return;
                event.preventDefault();
                onChange(tiles[to]);
                tileRefs.current[to]?.focus();
              }}
              className={cn(
                // In a row too narrow for six 44px circles (a 320px phone), they shrink
                // and keep 4px between them rather than spill.
                "relative aspect-square w-11 min-w-0 shrink rounded-full",
                "disabled:pointer-events-none disabled:opacity-50",
                PRESS,
                TILE_RING,
                selected
                  ? "before:border-primary before:opacity-100"
                  : "before:border-foreground/20 before:opacity-0 hover:before:opacity-100",
              )}
            >
              <span
                className={cn(
                  "grid size-full rounded-full",
                  // Only tiles a shuffle brought in arrive with motion; the row a page
                  // opens with is simply there.
                  shuffles > 0 &&
                    "transition-[opacity,scale] duration-[180ms] ease-[var(--ease-out-strong)] starting:opacity-0 motion-safe:starting:scale-90",
                )}
                style={shuffles > 0 ? { transitionDelay: `${index * 30}ms` } : undefined}
              >
                <UserAvatar
                  user={
                    tile.kind === "photo"
                      ? { handle, avatarSeed: null, avatarUrl: photoUrl }
                      : { handle, avatarSeed: tile.seed }
                  }
                  px={TILE_PX}
                  className="size-full"
                />
              </span>
              {/* Shape as well as colour. The dark edge keeps it apart from an avatar that is itself violet. */}
              <Mark
                on={selected}
                className={cn(
                  "absolute -right-0.5 -bottom-0.5 size-4 shadow-[0_0_0_1.5px_rgb(0_0_0/0.5)]",
                  "transition-[opacity,background-color,border-color]",
                  selected ? "opacity-100" : "opacity-0",
                )}
              />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-label={SHUFFLE_NAME}
        disabled={disabled}
        onClick={() => {
          // From this render's tiles, not in an updater: the new seeds are random, and an
          // updater may be run twice.
          setHeld(shuffleSeeds(seeds, value?.kind === "seed" ? value.seed : null));
          setShuffles((n) => n + 1);
        }}
        // The same space as between two tiles, whatever the row's width: what is left
        // after every circle, shared among the gaps. And the same size as a tile, in a
        // row narrow enough to shrink them.
        style={
          tiles.length > 0
            ? {
                marginLeft: `max(4px, calc((100% - ${(tiles.length + 1) * TILE_PX}px) / ${tiles.length}))`,
                width: `min(${TILE_PX}px, calc((100% - ${tiles.length * 4}px) / ${tiles.length + 1}))`,
              }
            : undefined
        }
        className={cn(
          "focus-ring grid aspect-square w-11 shrink-0 place-items-center rounded-full",
          "border border-dashed border-border text-muted-foreground hover:bg-muted hover:text-foreground",
          "disabled:pointer-events-none disabled:opacity-50",
          PRESS,
        )}
      >
        <Shuffle aria-hidden className="size-4" />
      </button>

      {/* Keyed so each shuffle inserts a fresh node: identical text would not be read again. */}
      <span aria-live="polite" className="sr-only">
        {shuffles > 0 ? <span key={shuffles}>{SHUFFLED}</span> : null}
      </span>
    </div>
  );
}
