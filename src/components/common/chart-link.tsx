"use client";

import { ExternalLink } from "lucide-react";
import { geckoTerminalUrl } from "@/lib/tokens/links";
import { cn } from "@/lib/utils";
import type { Chain } from "@/server/types";

/**
 * Out to the token's GeckoTerminal page, from anywhere a token is shown. Icon-only by
 * default so it sits after a symbol without stealing the row; `label` for a headline
 * placement. Stops propagation so a clickable row underneath does not also fire.
 */
export function GeckoTerminalLink({
  chain,
  address,
  symbol,
  label,
  size = "sm",
  roomy = false,
  className,
}: {
  chain: Chain;
  address: string;
  symbol: string;
  /** Render as a text link with this label instead of an icon. */
  label?: string;
  size?: "xs" | "sm";
  /**
   * Icon only: a tap target larger than the 12 to 14px glyph, for a table row on a
   * phone. Opt-in, because the extra area is invisible and belongs only where the row
   * has the height for it: in a dense list it would overlap the next line's icon.
   */
  roomy?: boolean;
  className?: string;
}) {
  return (
    <a
      href={geckoTerminalUrl(chain, address)}
      target="_blank"
      rel="noopener noreferrer"
      title={`${symbol} on GeckoTerminal`}
      aria-label={`Open ${symbol} on GeckoTerminal`}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded text-muted-foreground transition-colors duration-150 hover:text-foreground focus-ring",
        label ? "text-[11px]" : "",
        // Up, down and to the right, and barely to the left: the token's own name sits a
        // few pixels that way, and a tap meant for it must not leave the app instead.
        roomy && !label && "relative after:absolute after:-inset-y-2.5 after:-right-3 after:-left-1 after:content-['']",
        className,
      )}
    >
      {label ? <span>{label}</span> : null}
      <ExternalLink aria-hidden className={size === "xs" ? "size-3" : "size-3.5"} />
    </a>
  );
}
