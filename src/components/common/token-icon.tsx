"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { logoCandidates } from "@/lib/tokens/logo";
import { avatarGradient } from "./agent-avatar";
import type { TokenRef } from "@/server/types";

const SIZES = {
  xs: "size-4 text-[8px]",
  sm: "size-6 text-[9px]",
  md: "size-8 text-[10px]",
} as const;

/**
 * Token marks come from a registry we do not control, so the logo may be missing, or
 * hosted on an IPFS gateway that refuses to serve it. Each candidate URL is tried in
 * turn (see `logoCandidates`), and when every one fails the mark falls back to the
 * symbol on a hue derived from the token id — recognisable and never a broken image.
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
  const candidates = token.logoUrl ? logoCandidates(token.logoUrl) : [];
  const [attempt, setAttempt] = useState(0);
  const src = candidates[attempt];
  // Moves on from *this* attempt only, so a failure reported twice (the check below and
  // `onError`) never skips a candidate.
  const fail = (at: number) => setAttempt((current) => (current === at ? current + 1 : current));

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- token art comes from arbitrary remote hosts
      <img
        src={src}
        alt=""
        aria-hidden
        loading="lazy"
        referrerPolicy="no-referrer"
        // The server renders this <img>, and a host that 404s can fail it before React
        // attaches `onError` — the browser's broken-image glyph then stays for good. So
        // check once per src on mount. `naturalWidth` is also 0 for an SVG with no
        // intrinsic size, so `decode()` has the last word: it rejects only when broken.
        ref={(el) => {
          if (!el || el.dataset.checked === src) return;
          el.dataset.checked = src;
          if (el.complete && el.naturalWidth === 0) el.decode().catch(() => fail(attempt));
        }}
        onError={() => fail(attempt)}
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
