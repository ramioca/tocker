/**
 * The mark: a soft watch, after Dalí. Time melting off the edge of the dial — an agent
 * that trades while you sleep, on a market where the clock never means what it says.
 *
 * Two densities on purpose. `PetriClock` is the full dial for hero and marketing sizes
 * (~48px and up): four cardinal ticks, a rim highlight, both hands. `PetriMark` is the
 * favicon density — below ~24px the ticks and the highlight turn to mud, so it keeps a
 * heavier outline, two straight hands and the pivot, and nothing else.
 *
 * Geometry notes, because this is hand-drawn Bézier work and it is easy to undo:
 *   - The dial is near-circular (x 10–50, y 7–43). Flatten it and the silhouette stops
 *     reading as a watch.
 *   - The melt is the lower-RIGHT quadrant: the right rim slumps from y≈37 and the drip
 *     hangs to y≈47. The drip must stay SHORT and THICK (≈7 wide, ≈9 tall). Lengthen or
 *     narrow it and the whole thing reads as a speech bubble with a tail.
 *   - The hour hand points up-left and the minute hand droops down-right, sagging with
 *     the melt. In the clock the minute hand stops short of the rim so it does not merge
 *     with the drip into one comma-shaped stroke.
 *
 * `ink` is the dial outline, ticks and hands; it defaults to a near-black rather than
 * `currentColor` on purpose — the dial is porcelain (`--petri-face`) in both themes, so
 * a light `currentColor` on a dark page makes the hands vanish into the face. The pivot
 * is always the brand violet. Both marks are decorative and static: they render on
 * every screen, and a logo that moves is a logo you stop trusting.
 */

/** Dial + melt silhouette, full-detail density. */
const CLOCK_DIAL =
  "M30 7 C41.5 7 50 15.3 50 25.8 C50 30.6 49.4 34.2 48.6 37.6 C47.8 41 48.6 44 47.4 46.6 " +
  "C46.2 49.2 42 48.8 41.4 45.6 C40.9 43 41.4 41.4 40.8 39.8 C36.8 42.6 31.6 43.8 26.6 43.2 " +
  "C17 42 10 34.6 10 25.8 C10 15.3 18.5 7 30 7 Z";

/** The same silhouette, opened up a little so a 3.4px outline still leaves a face at 20px. */
const MARK_DIAL =
  "M30 6 C42.2 6 51 14.8 51 25.8 C51 30.8 50.4 34.6 49.6 38.2 C48.8 41.8 49.6 45 48.2 47.8 " +
  "C46.8 50.6 41.8 50.2 41.2 46.6 C40.7 43.8 41.2 42.2 40.6 40.4 C36.4 43.4 31.2 44.6 26 44 " +
  "C16 42.8 9 35 9 25.8 C9 14.8 17.8 6 30 6 Z";

const DEFAULT_INK = "#17151d";

type MarkProps = {
  size?: number;
  className?: string;
  face?: string;
  ink?: string;
};

export function PetriMark({
  size = 20,
  className,
  face = "var(--petri-face, #ede9fb)",
  ink = DEFAULT_INK,
}: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d={MARK_DIAL} fill={face} stroke={ink} strokeWidth="3.4" strokeLinejoin="round" />
      {/* Two straight hands, no ticks: at 20px a curve and a tick are the same smudge. */}
      <path d="M29.8 25.6 L21.6 17.2" stroke={ink} strokeWidth="4.8" strokeLinecap="round" />
      <path d="M29.8 25.6 L36.4 34.6" stroke={ink} strokeWidth="4.8" strokeLinecap="round" />
      <circle cx="29.8" cy="25.6" r="3.8" fill="var(--primary)" />
    </svg>
  );
}

/** The full dial, for hero and marketing sizes (roughly 48px and up). */
export function PetriClock({
  size = 96,
  className,
  face = "var(--petri-face, #ede9fb)",
  ink = DEFAULT_INK,
}: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d={CLOCK_DIAL} fill={face} stroke={ink} strokeWidth="2.6" strokeLinejoin="round" />
      {/* Rim highlight: the porcelain catching light from the upper left. */}
      <path
        d="M16 19 C18.6 13.2 23.8 10 29.4 10"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.1"
        strokeLinecap="round"
        opacity="0.75"
      />
      {/* Four cardinal ticks. The 6 sits inside the sag, which is what sells the melt. */}
      <g stroke={ink} strokeWidth="2.4" strokeLinecap="round">
        <path d="M29.8 11.2 V14.8" />
        <path d="M44.8 25.4 H41.2" />
        <path d="M14.8 25.4 H18.4" />
        <path d="M28.6 36.2 L28.4 39.4" />
      </g>
      <path d="M29.8 25.6 L22.4 18" stroke={ink} strokeWidth="3.2" strokeLinecap="round" />
      <path
        d="M29.8 25.6 C33.2 27.2 35.4 30 36.2 33.6"
        fill="none"
        stroke={ink}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="29.8" cy="25.6" r="2.7" fill="var(--primary)" />
    </svg>
  );
}

/** Mark plus wordmark, for headers and the sidebar. */
export function PetriLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <PetriMark size={size} />
      <span className="text-sm font-semibold tracking-tight">tocker</span>
    </span>
  );
}
