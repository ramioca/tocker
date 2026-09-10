import { cn } from "@/lib/utils";
import { avatarGradient } from "./agent-avatar";
import type { TokenRef } from "@/server/types";

const SIZES = {
  xs: "size-4 text-[8px]",
  sm: "size-6 text-[9px]",
  md: "size-8 text-[10px]",
} as const;

/**
 * Token marks come from a registry we do not control, so the logo may be
 * missing. Rather than a broken image or a grey circle, fall back to the
 * symbol on a hue derived from the token id — recognisable and never empty.
 */
export function TokenIcon({
  token,
  size = "sm",
  className,
}: {
  token: Pick<TokenRef, "id" | "symbol" | "logoUrl">;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  if (token.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- token art comes from arbitrary remote hosts
      <img
        src={token.logoUrl}
        alt=""
        aria-hidden
        className={cn("shrink-0 rounded-full object-cover", SIZES[size], className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-semibold text-white/90 ring-1 ring-inset ring-white/10",
        SIZES[size],
        className,
      )}
      style={{ backgroundImage: avatarGradient(`token:${token.id}`) }}
    >
      {token.symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}
