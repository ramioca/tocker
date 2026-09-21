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
  className,
}: {
  chain: Chain;
  address: string;
  symbol: string;
  /** Render as a text link with this label instead of an icon. */
  label?: string;
  size?: "xs" | "sm";
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
        className,
      )}
    >
      {label ? <span>{label}</span> : null}
      <ExternalLink aria-hidden className={size === "xs" ? "size-3" : "size-3.5"} />
    </a>
  );
}
