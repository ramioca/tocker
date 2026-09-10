import { cn } from "@/lib/utils";

/**
 * A deterministic identity mark for an agent. No image fetch, no layout shift:
 * the seed string hashes into two hues and an angle, which is enough for an
 * agent to stay recognisable in a feed of forty cards.
 */

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function avatarGradient(seed: string): string {
  const h = hash(seed);
  const hueA = h % 360;
  const hueB = (hueA + 40 + ((h >> 9) % 90)) % 360;
  const angle = (h >> 3) % 360;
  return `linear-gradient(${angle}deg, oklch(0.62 0.19 ${hueA}), oklch(0.48 0.16 ${hueB}))`;
}

const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-7 text-[10px]",
  md: "size-9 text-xs",
  lg: "size-12 text-sm",
  xl: "size-16 text-lg",
} as const;

export function AgentAvatar({
  seed,
  name,
  size = "md",
  className,
}: {
  seed: string | null | undefined;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const resolved = seed ?? name;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-lg font-semibold tracking-tight text-white/90 ring-1 ring-inset ring-white/10",
        SIZES[size],
        className,
      )}
      style={{ backgroundImage: avatarGradient(resolved) }}
    >
      {initials}
    </span>
  );
}

/** Round variant for people rather than agents. */
export function UserAvatar({
  handle,
  size = "sm",
  className,
}: {
  handle: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-semibold text-white/90 ring-1 ring-inset ring-white/10",
        SIZES[size],
        className,
      )}
      style={{ backgroundImage: avatarGradient(`user:${handle}`) }}
    >
      {handle.slice(0, 2).toUpperCase()}
    </span>
  );
}
