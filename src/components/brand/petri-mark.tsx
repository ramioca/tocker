/**
 * The Petri mark: a soft watch, after Dalí. Time melting off the edge of the dial —
 * an agent that trades while you sleep, and a market where the clock never means
 * what it says.
 *
 * Two densities on purpose. Below ~24px the minor ticks and the rim highlight turn
 * to mud, and a bare silhouette reads as a speech bubble, so `PetriMark` keeps bold
 * hands and three cardinal ticks and nothing else. `PetriClock` is the full dial for
 * hero sizes. Both are decorative and static: they render on every screen.
 *
 * `ink` is the dial outline and hands, `face` the dial fill, and the pivot is always
 * the brand violet. The defaults inherit the surrounding text colour so the mark
 * works on either theme.
 */
export function PetriMark({
  size = 20,
  className,
  face = "var(--petri-face, #ede9fb)",
  ink = "currentColor",
}: {
  size?: number;
  className?: string;
  face?: string;
  ink?: string;
}) {
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
      <path
        d="M32 8 C44 8 52 17 52 27.5 C52 32.6 51 36.2 50 39.6 C48.8 43.6 49.2 47.6 48.4 51 C47.6 54.2 44 54.4 43.2 51.2 C42.5 48 43.8 44.4 42.2 41.8 C40.4 39 36.6 38.2 32 38.2 C21 38.2 12 31.6 12 23.4 C12 15.2 20.4 8 32 8 Z"
        fill={face}
        stroke={ink}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <g stroke={ink} strokeWidth="3" strokeLinecap="round">
        <path d="M32 13.5 V17" />
        <path d="M46 23.5 H42.5" />
        <path d="M18 23.5 H21.5" />
        <path d="M32 25 L39.5 20.5" />
        <path d="M32 25 C32.5 29 33.4 31.6 34.6 34.4" />
      </g>
      <circle cx="32" cy="25" r="3.4" fill="var(--primary)" />
    </svg>
  );
}

/** The full dial, for hero and marketing sizes (roughly 48px and up). */
export function PetriClock({
  size = 96,
  className,
  face = "var(--petri-face, #ede9fb)",
  ink = "currentColor",
}: {
  size?: number;
  className?: string;
  face?: string;
  ink?: string;
}) {
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
      <path
        d="M32 9 C43 9 51 17.5 51 28 C51 33 50 36.5 49 40 C47.8 44 48.2 48 47.4 51.4 C46.7 54.4 43.6 54.6 42.9 51.6 C42.2 48.6 43.6 45 42 42.4 C40.3 39.7 36.6 38.9 32 38.9 C21.5 38.9 13 32.3 13 24 C13 15.7 21 9 32 9 Z"
        fill={face}
        stroke={ink}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path d="M19.5 20.5 C21.5 15 26.5 12 32 12" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
      <g stroke={ink} strokeWidth="2.2" strokeLinecap="round">
        <path d="M32 14.5 V17.6" />
        <path d="M45.6 24.2 L42.5 24.6" />
        <path d="M18.6 24.2 L21.7 24.6" />
        <path d="M24.5 33.5 L26.3 31.4" />
      </g>
      <path d="M32 24.5 L39 20.6" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M32 24.5 C32.4 28.5 33.2 31.5 34.4 34.6" fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="32" cy="24.5" r="2.4" fill="var(--primary)" />
    </svg>
  );
}

/** Mark plus wordmark, for headers and the sidebar. */
export function PetriLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <PetriMark size={size} />
      <span className="text-sm font-semibold tracking-tight">petri</span>
    </span>
  );
}
