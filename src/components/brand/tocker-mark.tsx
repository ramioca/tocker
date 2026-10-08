/**
 * The Tocker mark, v3: the 3D blue "T".
 *
 * Every file named here is cut from one master render by
 * `scripts/brand/make-mark-assets.py`, so the paths and the ratio are written down
 * once, in this file. The landing, the app bar, the login and the sign-in provider's
 * modal read them from here. The share card takes the ratio and spells out its own
 * path on disk, where the build can see it; `tocker-mark.test.ts` holds the two together.
 *
 * Plain markup with no hooks: it renders on the server and inside client components.
 */

/** Transparent WebP, 160px wide: enough for 3x up to 53 CSS px wide (the nav, the app bar, the login). */
export const TOCKER_MARK_SM_SRC = "/brand/tocker/v3/tocker-mark-160.webp";
/** Transparent WebP, 720px wide, for large placements and the sign-in provider's modal. */
export const TOCKER_MARK_LG_SRC = "/brand/tocker/v3/tocker-mark-720.webp";
/** Transparent PNG, 512px wide, for the share-image renderer, which is not a browser and may not read WebP. Too heavy (95KB) to put on a page. */
export const TOCKER_MARK_PNG_SRC = "/brand/tocker/v3/tocker-mark-512.png";
/** Width / height of the cut-out T. Every transparent file keeps it. */
export const TOCKER_MARK_RATIO = 1169 / 964;

/** The widest the 160px file is drawn: past this a 3x screen would be stretching it. */
const SM_MAX_WIDTH = 53;

/**
 * The mark at `height` CSS px. Decorative unless given an `alt`: it sits beside the
 * word "tocker" or inside a link that already has a name.
 *
 * The width and height attributes reserve the box before the file arrives. The ratio is
 * also set in CSS because the app's base styles give every image `height: auto`: with
 * the attributes alone the box is measured from their whole-pixel ratio first and from
 * the file's own ratio once it loads, and whatever sits under the mark moves by that
 * fraction of a pixel. A class may still size either side; the other follows.
 */
export function TockerMark({ height, className, alt = "" }: { height: number; className?: string; alt?: string }) {
  const width = Math.round(height * TOCKER_MARK_RATIO);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a few KB, already cut to size; next/image would only re-encode it
    <img
      src={width <= SM_MAX_WIDTH ? TOCKER_MARK_SM_SRC : TOCKER_MARK_LG_SRC}
      alt={alt}
      width={width}
      height={height}
      className={className}
      style={{ aspectRatio: TOCKER_MARK_RATIO }}
      draggable={false}
    />
  );
}
