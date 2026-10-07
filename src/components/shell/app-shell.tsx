"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleStop } from "lucide-react";
import { RelativeTime } from "@/components/common/relative-time";
import { useRunStatus } from "@/components/providers/run-status";
import { CommandMenu } from "./command-menu";
import { MobileTabBar } from "./mobile-tab-bar";
import { isApplePlatform } from "./platform";
import { RunIsland } from "./run-island";
import { TopBar } from "./top-bar";
import type { CommandIndex } from "./command-index";

export function AppShell({
  unreadCount,
  index,
  ownedSlugs,
  tradingPaused = false,
  pausedAt = null,
  children,
}: {
  unreadCount: number;
  index: CommandIndex;
  /** The viewer's agent slugs, so "My agents" is only lit on agents they own. */
  ownedSlugs?: string[];
  /** The account-wide kill switch (Settings → Security). */
  tradingPaused?: boolean;
  pausedAt?: string | null;
  children: ReactNode;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const owned = useMemo(() => (ownedSlugs ? new Set(ownedSlugs) : undefined), [ownedSlugs]);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  // Read by the key listener below, which is bound once and so cannot close over state.
  const paletteOpenRef = useRef(paletteOpen);
  useEffect(() => {
    paletteOpenRef.current = paletteOpen;
  }, [paletteOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k") return;
      // ⌘K on Apple keyboards and Ctrl+K elsewhere — never Ctrl+K on a Mac, where it is
      // "delete to end of line" in every text field, the strategy prompt included.
      if (!(isApplePlatform() ? event.metaKey : event.ctrlKey)) return;
      // Another modal (onboarding, Withdraw, a sheet) owns the screen: the palette would
      // open underneath it and take the focus with it. Popovers are dialogs too, but
      // non-modal ones — the Cash panel should not stop ⌘K. ⌘K still closes the palette.
      if (
        !paletteOpenRef.current &&
        document.querySelector('[role="dialog"][data-open]:not([data-slot="popover-content"])')
      ) {
        return;
      }
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The layout reads the unread count once and is not re-rendered by navigation, so the
  // bell is fed by the 15s poll instead; the server's number covers the first paint.
  // When a refresh brings a new server number, the poll is re-read so the two agree.
  const { unreadNotifications: liveUnread, refreshProposals } = useRunStatus();
  const badge = liveUnread ?? unreadCount;
  const serverUnread = useRef(unreadCount);
  useEffect(() => {
    if (serverUnread.current === unreadCount) return;
    serverUnread.current = unreadCount;
    refreshProposals();
  }, [unreadCount, refreshProposals]);

  // Notification days are grouped on the server, which only knows the viewer's zone if
  // the browser says so. Written on every app load; it changes when the traveller does.
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return;
    document.cookie = `tz=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  return (
    <div className="flex min-h-dvh w-full flex-col">
      {/*
        The first thing a keyboard reaches on every page. Hidden until focused,
        then it lands in the glass so it reads as chrome rather than an artefact.
      */}
      <a
        href="#main"
        // `!` on the padding: `not-sr-only` resets it to 0 at the same specificity. Opaque
        // on focus, because the glass let the wordmark and Search read through the text.
        className="glass-heavy focus-ring sr-only rounded-lg px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:!px-3 focus:!py-2 focus:bg-background focus:shadow-lg"
      >
        Skip to content
      </a>

      <TopBar unreadCount={badge} onOpenSearch={() => setPaletteOpen(true)} ownedSlugs={owned} />
      {tradingPaused ? <TradingPausedBanner pausedAt={pausedAt} /> : null}
      {/* While the approvals island is docked at the bottom, the end of every page scrolls
          clear of it. The run island is at the top and takes no room. */}
      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 flex-1 pb-24 outline-none md:pb-0 [body:has([data-run-island])_&]:pb-32 md:[body:has([data-run-island])_&]:pb-20"
      >
        {children}
      </main>

      <MobileTabBar unreadCount={badge} ownedSlugs={owned} />
      <RunIsland />
      <CommandMenu open={paletteOpen} onClose={closePalette} index={index} />
    </div>
  );
}

/**
 * The kill switch, visible from everywhere. Pausing is rare and forgetting it is the
 * failure: every agent page keeps looking healthy while nothing trades. So it is a
 * static strip under the bar on every page — no motion, it is a state, not an event —
 * with the way back one click away.
 */
function TradingPausedBanner({ pausedAt }: { pausedAt: string | null }) {
  return (
    <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <CircleStop aria-hidden className="size-4 shrink-0 text-destructive" />
        <p className="min-w-0 flex-1">
          <span className="font-medium">All trading is paused.</span>{" "}
          {/* One line on a phone: the state and the way back; the detail is on the card. */}
          <span className="text-muted-foreground max-sm:sr-only">
            No agent runs until you resume; exits still fire.
            {pausedAt ? (
              <>
                {" "}
                Paused <RelativeTime iso={pausedAt} className="tnum" />.
              </>
            ) : null}
          </span>
        </p>
        <Link
          href="/settings/security#kill-switch"
          className="shrink-0 rounded-md font-medium text-foreground underline decoration-destructive/50 underline-offset-4 transition-colors duration-150 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Resume in Security
        </Link>
      </div>
    </div>
  );
}
