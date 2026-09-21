/**
 * Deterministic identicon-ish avatar for people (profile header, profile form):
 * initials on a hashed gradient. Agents use the marble blob in
 * `@/components/common/agent-avatar` — do not use this one for agents.
 */
import { cn } from "@/lib/utils";

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SIZES = { xs: "size-6 text-[10px]", sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-16 text-xl", xl: "size-24 text-3xl" } as const;

export function AgentAvatar({
  seed,
  label,
  size = "md",
  className,
  rounded = "rounded-xl",
}: {
  seed: string;
  label: string;
  size?: keyof typeof SIZES;
  className?: string;
  rounded?: string;
}) {
  const h = hash(seed);
  const hue = h % 360;
  const hue2 = (hue + 40 + (h % 60)) % 360;
  const initials = label
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center border border-white/10 font-semibold text-white/90 select-none",
        rounded,
        SIZES[size],
        className,
      )}
      style={{
        background: `linear-gradient(140deg, oklch(0.55 0.17 ${hue}), oklch(0.34 0.13 ${hue2}))`,
      }}
    >
      {initials || "?"}
    </span>
  );
}
