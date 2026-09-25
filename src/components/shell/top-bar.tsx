"use client";

import { PetriMark } from "@/components/brand/petri-mark";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { NotificationBell } from "@/components/spectrumui/notification-bell";
import { cn } from "@/lib/utils";
import { LiquidMetal } from "@/components/common/liquid-metal";
import { useSession } from "@/hooks/use-session";
import { AccountMenu } from "./account-menu";
import { NAV_ITEMS, isActivePath } from "./nav-items";
import { isApplePlatform } from "./platform";
import { WalletChip } from "./wallet-chip";

/**
 * The links that live in the bar itself; the rest hang off the avatar menu. Money is
 * here because it is a primary tab on the phone — on desktop the bar is the only
 * place a primary destination can live.
 */
const BAR_NAV = NAV_ITEMS.filter((item) =>
  ["/home", "/feed", "/discover", "/agents", "/money"].includes(item.href),
);

const noSubscribe = () => () => {};

/**
 * How long the "New agent" chrome runs after the bar mounts before it rests. Long
 * enough for the ring to paint and be seen once; after that it is persistent chrome
 * on every page, and a shader that never stops is motion nobody asked for, a busy
 * main thread and a warm laptop. It wakes again under the pointer or keyboard focus.
 */
const METAL_WAKE_MS = 1_500;

/**
 * The whole app frame in one bar, fomo-style: brand and primary links on the
 * left, search in the middle, money-and-me on the right. Navigation is a hot
 * path — the active state is a plain class swap, nothing animates on click.
 */
export function TopBar({
  unreadCount,
  onOpenSearch,
  ownedSlugs,
}: {
  unreadCount: number;
  onOpenSearch: () => void;
  ownedSlugs?: ReadonlySet<string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // The palette opens on ⌘K or Ctrl+K; the hint names the one this keyboard has. Server
  // and first client render agree on ⌘K; a non-Apple keyboard swaps after hydration.
  const apple = useSyncExternalStore(noSubscribe, isApplePlatform, () => true);
  // A visitor from a shared agent link: every owner destination (Home, My agents, Money,
  // the builder, the bell) is a sign-in wall, so the bar offers only what they can open,
  // and the logo goes to the page that explains Tocker. Until the session is known the
  // signed-in bar stays — that is almost everyone, and it must not flash.
  const { ready, session } = useSession();
  const signedOut = ready && !session;
  const nav = signedOut ? BAR_NAV.filter((item) => item.public) : BAR_NAV;
  const onNotifications = isActivePath(pathname, "/notifications");

  const [metalWaking, setMetalWaking] = useState(true);
  const [metalHovered, setMetalHovered] = useState(false);
  const [metalFocused, setMetalFocused] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setMetalWaking(false), METAL_WAKE_MS);
    return () => window.clearTimeout(id);
  }, []);

  // The bell is a button (the registry component takes no href), so it gets the
  // prefetch a nav link would: the page is warm by the time it is pressed.
  useEffect(() => {
    router.prefetch("/notifications");
  }, [router]);

  return (
    <header className="glass-bar sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border/60 px-4">
      <Link
        href={signedOut ? "/" : "/home"}
        className="flex shrink-0 items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        aria-label="Tocker home"
      >
        <PetriMark size={22} />
        <span className="hidden text-sm font-semibold tracking-tight lg:inline">tocker</span>
      </Link>

      <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 md:flex">
        {nav.map((item) => {
          const active = isActivePath(pathname, item.href, ownedSlugs);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors duration-100",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
                active
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="Search"
        aria-keyshortcuts={apple ? "Meta+K" : "Control+K"}
        className={cn(
          "ml-auto flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 text-sm text-muted-foreground sm:h-8 sm:max-w-56",
          "transition-colors duration-150 hover:bg-muted/60 hover:text-foreground",
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Search aria-hidden className="size-4 shrink-0" />
        {/* md–lg is where the five links, the button and the chip all compete; the
            magnifier alone still reads as search there. */}
        <span className="truncate md:hidden lg:inline">Search</span>
        <kbd
          aria-hidden
          className="ml-auto hidden shrink-0 rounded border border-border bg-background px-1 font-mono text-[10px] text-muted-foreground sm:inline md:hidden lg:inline"
        >
          {apple ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      {/* Building an agent needs an account; signed out, the builder is only a wall. */}
      {signedOut ? null : (
        <>
          {/* Visibility lives on this wrapper, not on the MetalFx root: the library's own
              display rules (inline style on the fallback, an injected stylesheet on the live
              root) outrank Tailwind's `hidden`, so at phone widths the button showed anyway. */}
          <div
            className="hidden shrink-0 lg:block"
            onPointerEnter={() => setMetalHovered(true)}
            onPointerLeave={() => setMetalHovered(false)}
            // Keyboard focus only: a click also focuses the link, and the ring would then run
            // on the builder page for as long as nothing else took the focus.
            onFocus={(event) => setMetalFocused(event.target.matches(":focus-visible"))}
            onBlur={() => setMetalFocused(false)}
          >
          {/* Paused keeps the last frame on screen: at rest the ring is still chrome, just still. */}
          <LiquidMetal
            preset="chromatic"
            theme="dark"
            strength={0.85}
            paused={!(metalWaking || metalHovered || metalFocused)}
          >
            <Link
              href="/agents/new"
              className={cn(
                // Dark interior; the MetalFx chrome ring carries the shine.
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-background/60 px-3 text-sm font-medium text-foreground",
                "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted/60 active:scale-[0.97]",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <Plus aria-hidden className="size-4" />
              New agent
            </Link>
          </LiquidMetal>
          </div>

          <Link
            href="/agents/new"
            aria-label="New agent"
            className={cn(
              "inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-foreground lg:hidden",
              "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted/60 active:scale-[0.97]",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Plus aria-hidden className="size-4.5" />
          </Link>
        </>
      )}

      <WalletChip />

      {/* The bell is Notifications' only entry in the bar, so it carries the "you are
          here" the nav links do. Its own button takes no aria-current, hence the span. */}
      {signedOut ? null : (
        <span aria-current={onNotifications ? "page" : undefined} className="flex shrink-0">
          <NotificationBell
            count={unreadCount}
            size="sm"
            onClick={() => router.push("/notifications")}
            className={cn(
              // The bar's focus ring, not the registry's 1px grey: tailwind-merge in the
              // bell's own `cn` lets these replace its ring width and colours.
              "shrink-0 focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:ring-ring",
              // The row's height: 36px beside the phone's "+", 32px beside the desktop's
              // Search and New agent. The registry's sm is a flat 36px.
              "size-9 sm:size-8",
              onNotifications &&
                "border-primary/40 bg-accent text-accent-foreground dark:border-primary/40 dark:bg-accent dark:text-accent-foreground",
            )}
          />
        </span>
      )}

      <AccountMenu />
    </header>
  );
}
