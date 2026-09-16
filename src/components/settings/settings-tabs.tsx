"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings", label: "Account" },
  { href: "/settings/security", label: "Security" },
] as const;

/**
 * Two tabs, so no animation: a tab strip that slides an indicator on a hot path
 * is motion for its own sake. The active tab is a border and a weight change,
 * which reads instantly and costs nothing.
 */
export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections" className="mt-6 flex gap-1 border-b border-border/70">
      {TABS.map((tab) => {
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
