"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings", label: "Account" },
  { href: "/settings/security", label: "Security" },
] as const;

const ADMIN_TAB = { href: "/settings/admin", label: "Admin" } as const;

/**
 * Two or three tabs, so no animation: a tab strip that slides an indicator on a hot path
 * is motion for its own sake. The active tab is a border and a weight change, which reads
 * instantly and costs nothing.
 *
 * `isAdmin` is resolved on the server by `isAdminEmail(session.email)` and passed down as
 * a boolean. It is a *cosmetic* gate: the tab is hidden because showing a link to a 404
 * would be silly, not because hiding it protects anything. The route's own
 * `requireAdmin()` is the access control, and it holds whether or not this prop is right.
 */
export function SettingsTabs({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const tabs = isAdmin ? [...TABS, ADMIN_TAB] : TABS;

  return (
    <nav aria-label="Settings sections" className="mt-6 flex gap-1 border-b border-border/70">
      {tabs.map((tab) => {
        const active = tab.href === "/settings" ? pathname === "/settings" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
