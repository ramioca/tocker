"use client";

import { PetriMark } from "@/components/brand/petri-mark";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { NotificationBell } from "@/components/spectrumui/notification-bell";
import { cn } from "@/lib/utils";
import { LiquidMetal } from "@/components/common/liquid-metal";
import { AccountMenu } from "./account-menu";
import { NAV_ITEMS, isActivePath } from "./nav-items";
import { WalletChip } from "./wallet-chip";

/** The links that live in the bar itself; the rest hang off the avatar menu. */
const BAR_NAV = NAV_ITEMS.filter((item) =>
  ["/home", "/feed", "/discover", "/agents"].includes(item.href),
);

/**
 * The whole app frame in one bar, fomo-style: brand and primary links on the
 * left, search in the middle, money-and-me on the right. Navigation is a hot
 * path — the active state is a plain class swap, nothing animates on click.
 */
export function TopBar({
  unreadCount,
  onOpenSearch,
}: {
  unreadCount: number;
  onOpenSearch: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <header className="glass-bar sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border/60 px-4">
      <Link
        href="/home"
        className="flex shrink-0 items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label="Tocker home"
      >
        <PetriMark size={22} />
        <span className="hidden text-sm font-semibold tracking-tight lg:inline">tocker</span>
      </Link>

      <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 md:flex">
        {BAR_NAV.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors duration-100",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
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
        className={cn(
          "ml-auto flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 text-sm text-muted-foreground sm:max-w-56",
          "transition-colors duration-150 hover:bg-muted/60 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="truncate">Search</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-border bg-background px-1 font-mono text-[10px] text-muted-foreground sm:inline">
          ⌘K
        </kbd>
      </button>

      {/* Visibility lives on this wrapper, not on the MetalFx root: the library's own
          display rules (inline style on the fallback, an injected stylesheet on the live
          root) outrank Tailwind's `hidden`, so at phone widths the button showed anyway. */}
      <div className="hidden shrink-0 md:block">
      <LiquidMetal preset="chromatic" theme="dark" strength={0.85}>
        <Link
          href="/agents/new"
          className={cn(
            // Dark interior; the MetalFx chrome ring carries the shine.
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-background/60 px-3 text-sm font-medium text-foreground",
            "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted/60 active:scale-[0.97]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
          "inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-foreground md:hidden",
          "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted/60 active:scale-[0.97]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Plus aria-hidden className="size-4.5" />
      </Link>

      <WalletChip />

      <NotificationBell
        count={unreadCount}
        size="sm"
        onClick={() => router.push("/notifications")}
        className="shrink-0"
      />

      <AccountMenu />
    </header>
  );
}
