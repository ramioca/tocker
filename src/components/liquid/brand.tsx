/**
 * The Tocker brand, v3: the 3D blue "T" and the "tocker" wordmark set in Geist 650.
 * Both are plain markup, so they render on the server and cost nothing to hydrate.
 *
 * The image paths and the ratio come from `components/brand/tocker-mark`, the one
 * place they are written down. The components and their class names stay here
 * because landing.css sizes the lockup through them.
 *
 * - `BrandMark` uses the 160px file, for the nav and the footer.
 * - `BrandHeroMark` uses the 720px file, for art at 120px and up.
 * - `BrandLockup` is mark + wordmark, for the nav and the footer.
 */

import { TOCKER_MARK_LG_SRC, TOCKER_MARK_RATIO, TOCKER_MARK_SM_SRC } from "@/components/brand/tocker-mark";

export function BrandMark({ size = 28, className, alt = "" }: { size?: number; className?: string; alt?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a 4KB WebP, already cut to size; next/image adds nothing here
    <img
      src={TOCKER_MARK_SM_SRC}
      alt={alt}
      width={Math.round(size * TOCKER_MARK_RATIO)}
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
    // eslint-disable-next-line @next/next/no-img-element -- a 22KB WebP, already cut to size; next/image adds nothing here
    <img
      src={TOCKER_MARK_LG_SRC}
      alt={alt}
      width={width}
      height={Math.round(width / TOCKER_MARK_RATIO)}
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
