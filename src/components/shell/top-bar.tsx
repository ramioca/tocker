"use client";

import { PetriMark } from "@/components/brand/petri-mark";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { NotificationBell } from "@/components/spectrumui/notification-bell";
import { cn } from "@/lib/utils";

export function TopBar({
  unreadCount,
  onOpenSearch,
  title,
}: {
  unreadCount: number;
  onOpenSearch: () => void;
  title?: string;
}) {
  const router = useRouter();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/80 bg-background/85 px-4 backdrop-blur-md">
      <Link
        href="/feed"
        className="flex items-center gap-2 md:hidden"
        aria-label="Tocker home"
      >
        <PetriMark size={22} />
      </Link>

      {title ? (
        <h1 className="hidden truncate text-sm font-medium md:block">{title}</h1>
      ) : null}

      <button
        type="button"
        onClick={onOpenSearch}
        className={cn(
          "ml-auto flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 text-sm text-muted-foreground sm:max-w-xs",
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

      <NotificationBell
        count={unreadCount}
        size="sm"
        onClick={() => router.push("/notifications")}
        className="shrink-0"
      />

      <Link
        href="/agents/new"
        aria-label="New agent"
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground md:hidden",
          "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.95]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Plus aria-hidden className="size-4" />
      </Link>
    </header>
  );
}
