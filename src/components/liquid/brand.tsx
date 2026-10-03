/**
 * The Tocker brand, v2: the neon "T" (electric blue to magenta on black glass)
 * and the "tocker" wordmark set in Geist 650. Both are plain markup, so they
 * render on the server and cost nothing to hydrate.
 *
 * - `BrandMark` uses the heavy-edge drawing made for 16–64px.
 * - `BrandHeroMark` uses the large drawing with light streaks, for art at 120px and up.
 * - `BrandLockup` is mark + wordmark, for the nav and the footer.
 */

const SM_SRC = "/brand/tocker/v2/tocker-mark-neon-sm.svg";
const LG_SRC = "/brand/tocker/v2/tocker-mark-neon.svg";
/** viewBox ratios of the two drawings (width / height). */
const SM_RATIO = 1180 / 970;
const LG_RATIO = 1180 / 990;

export function BrandMark({ size = 28, className, alt = "" }: { size?: number; className?: string; alt?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a 2KB vector; next/image adds nothing here
    <img
      src={SM_SRC}
      alt={alt}
      width={Math.round(size * SM_RATIO)}
      height={size}
      className={className ? `lp-brand-mark ${className}` : "lp-brand-mark"}
      draggable={false}
    />
  );
}

/**
 * The large mark, as art. It sits below the fold (the footer close), so it loads
 * lazily and never competes with the hero for bandwidth.
 */
export function BrandHeroMark({ width = 360, className, alt = "" }: { width?: number; className?: string; alt?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- vector art; next/image adds nothing here
    <img
      src={LG_SRC}
      alt={alt}
      width={width}
      height={Math.round(width / LG_RATIO)}
      className={className}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

/** Mark + "tocker" wordmark. `size` is the mark's height in px; the word scales with it. */
export function BrandLockup({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <span
      className={className ? `lp-lockup ${className}` : "lp-lockup"}
      style={{ fontSize: `${Math.round(size * 0.86)}px` }}
      aria-label="Tocker"
      role="img"
    >
      <BrandMark size={size} />
      <span className="lp-lockup-word" aria-hidden>
        tocker
      </span>
    </span>
  );
}
