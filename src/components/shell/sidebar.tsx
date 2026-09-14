"use client";

import { PetriMark } from "@/components/brand/petri-mark";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { LoginButton } from "@/components/auth/login-button";
import { NAV_ITEMS, isActivePath } from "./nav-items";

/**
 * Navigation is a hot path — five links a user hits dozens of times an hour.
 * Nothing here animates on click; the active state is a plain class swap and
 * only the hover tint transitions, at a duration nobody will ever notice.
 */
export function Sidebar({ unreadCount }: { unreadCount: number }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-14 items-center gap-2 px-4">
        <Link
          href="/feed"
          className="flex items-center gap-2 rounded-md px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PetriMark size={22} />
          <span className="text-sm font-semibold tracking-tight">tocker</span>
        </Link>
      </div>

      <nav aria-label="Primary" className="flex flex-col gap-0.5 px-2">
        {NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
              )}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
              {item.href === "/notifications" && unreadCount > 0 ? (
                <span className="tnum ml-auto rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="px-2 pt-3">
        <Link
          href="/agents/new"
          className={cn(
            "flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-medium text-primary-foreground",
            "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
            "hover:bg-primary/90 active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
          )}
        >
          <Plus aria-hidden className="size-4" />
          New agent
        </Link>
      </div>

      <div className="mt-auto border-t border-sidebar-border p-3">
        <LoginButton className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background/40 px-3 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </div>
    </aside>
  );
}
