import Avatar from "boring-avatars";
import { cn } from "@/lib/utils";

/**
 * A deterministic identity mark for an agent. No image fetch, no layout shift:
 * the seed string hashes into a marble blob (boring-avatars, MIT) coloured from
 * a fixed Tocker palette, which is enough for an agent to stay recognisable in
 * a feed of forty cards. Plain SVG, so it renders in server components.
 */

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Still used by token icons that fall back to a hue when the registry has no logo. */
export function avatarGradient(seed: string): string {
  const h = hash(seed);
  const hueA = h % 360;
  const hueB = (hueA + 40 + ((h >> 9) % 90)) % 360;
  const angle = (h >> 3) % 360;
  return `linear-gradient(${angle}deg, oklch(0.62 0.19 ${hueA}), oklch(0.48 0.16 ${hueB}))`;
}

/**
 * Deep grounds and bright accents, kept apart on purpose: marble draws two
 * blurred blobs (the second in overlay blend) over a flat ground, so a light
 * ground washes out on the dark theme and two dark accents vanish into it.
 */
const GROUNDS = ["#7155D9", "#312E81", "#0E7490", "#BE123C", "#1D4ED8", "#17151D", "#0F766E"] as const;
const ACCENTS = ["#A78BFA", "#F4F4F1", "#2DD4BF", "#FB7185", "#38BDF8", "#FDE68A"] as const;

/** boring-avatars' own string hash, replicated so we can place colours where marble reads them. */
function marbleHash(name: string): number {
  let r = 0;
  for (let i = 0; i < name.length; i += 1) {
    r = (r << 5) - r + name.charCodeAt(i);
    r &= r;
  }
  return Math.abs(r);
}

/**
 * Marble reads colours[(marbleHash + t) % 3] for t = 0 (ground), 1 (blob),
 * 2 (overlay blob). Picking ground and accents from our own hash and placing
 * them at those indices gives 210 combinations instead of the seven
 * consecutive triples a flat palette allows. The bit offsets were chosen so
 * the twelve builder presets never share a ground-and-accents combination.
 */
export function agentPalette(seed: string): [string, string, string] {
  const h = hash(seed);
  const ground = GROUNDS[h % GROUNDS.length];
  const first = (h >>> 16) % ACCENTS.length;
  let second = (h >>> 22) % ACCENTS.length;
  if (second === first) second = (second + 1) % ACCENTS.length;
  const offset = marbleHash(seed) % 3;
  const out: [string, string, string] = ["", "", ""];
  out[offset] = ground;
  out[(offset + 1) % 3] = ACCENTS[first];
  out[(offset + 2) % 3] = ACCENTS[second];
  return out;
}

const SIZES = {
  xs: "size-5",
  sm: "size-7",
  md: "size-9",
  lg: "size-12",
  xl: "size-16",
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

  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-grid shrink-0 overflow-hidden rounded-lg",
        "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-inset after:ring-white/10",
        SIZES[size],
        className,
      )}
    >
      <Avatar
        variant="marble"
        name={resolved}
        colors={agentPalette(resolved)}
        square
        size="100%"
        className="block size-full"
      />
    </span>
  );
}
