"use client";

import { PetriMark } from "@/components/brand/petri-mark";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { NotificationBell } from "@/components/spectrumui/notification-bell";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./account-menu";
import { NAV_ITEMS, isActivePath } from "./nav-items";
import { WalletChip } from "./wallet-chip";

/** The links that live in the bar itself; the rest hang off the avatar menu. */
const BAR_NAV = NAV_ITEMS.filter((item) =>
  ["/feed", "/discover", "/agents"].includes(item.href),
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
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border/80 bg-background/85 px-4 backdrop-blur-md">
      <Link
        href="/feed"
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

      <Link
        href="/agents/new"
        className={cn(
          "hidden h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground md:inline-flex",
          "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.97]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Plus aria-hidden className="size-4" />
        New agent
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
