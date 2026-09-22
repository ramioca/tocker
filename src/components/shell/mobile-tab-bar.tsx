"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActivePath } from "./nav-items";

/**
 * The phone's primary navigation.
 *
 * `.glass-bar` is the lightest weight in the material system on purpose: this
 * sits directly on top of a scrolling feed, and you should be able to see that
 * the content is still moving underneath it. It is one of only two blurred
 * surfaces the phone viewport is allowed (this and an open overlay).
 *
 * Tapped dozens of times a session, so there is no motion beyond a 100ms colour
 * change and the press scale — anything longer reads as lag, not polish.
 *
 * The tabs are whatever `NAV_ITEMS` marks `mobile`, and five is the ceiling —
 * see the note there for why Money holds a slot and Notifications does not. The
 * unread badge below stays wired to `/notifications` rather than being deleted:
 * the tab list is data, and the day it comes back the count comes back with it.
 */
export function MobileTabBar({ unreadCount }: { unreadCount: number }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => item.mobile);

  return (
    <nav
      aria-label="Primary"
      className="glass-bar fixed inset-x-0 bottom-0 z-40 flex border-t border-border/60 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map((item) => {
        const active = isActivePath(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-ring-inset relative flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium",
              "transition-[color,transform] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96]",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            {/* The active marker is the top edge lighting up, so the bar reads as
                one piece of material with a lit segment rather than five buttons. */}
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-4 top-0 h-px transition-opacity duration-100",
                active ? "bg-primary opacity-100" : "opacity-0",
              )}
            />
            <span className="relative">
              <Icon aria-hidden className="size-5" />
              {item.href === "/notifications" && unreadCount > 0 ? (
                <span className="tnum absolute -right-1.5 -top-1 grid min-w-3.5 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold leading-[14px] text-primary-foreground">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              ) : null}
            </span>
            {/* Five tabs on a 390px screen: "My agents" is the only label that
                does not fit, and "Agents" says the same thing. */}
            {item.label === "My agents" ? "Agents" : item.label}
          </Link>
        );
      })}
    </nav>
  );
}
