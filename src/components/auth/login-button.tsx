"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { signInHref } from "./login-helpers";

function initials(handle: string, displayName: string | null): string {
  const source = (displayName ?? handle).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2);
  return letters.toUpperCase();
}

/** Sends the visitor to Tocker's sign-in page; shows an avatar menu when logged in. */
export function LoginButton({ className }: { className?: string }) {
  const { ready, session, logout } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!ready) {
    return <div className={cn("h-8 w-24 motion-safe:animate-pulse rounded-lg bg-muted", className)} aria-hidden />;
  }

  if (!session) {
    // A link, not a handler: sign-in is a page now, so it should be openable in a new
    // tab, prefetchable, and announced as a link. `next` carries the visitor back to
    // whatever they were looking at when they pressed it. `nativeButton={false}` so Base UI
    // leaves it one: no `type="button"` and no button role on the anchor.
    return (
      <Button nativeButton={false} className={className} render={<Link href={signInHref(pathname)} />}>
        Sign in
      </Button>
    );
  }

  return (
    <div ref={menuRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border px-2 py-1 text-sm transition-colors hover:bg-muted"
      >
        {session.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.avatarUrl} alt="" className="size-6 rounded-full object-cover" />
        ) : (
          <span className="grid size-6 place-items-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
            {initials(session.handle, session.displayName)}
          </span>
        )}
        <span className="max-w-28 truncate">@{session.handle}</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-lg border border-border bg-popover p-1 text-sm shadow-lg"
        >
          <Link
            role="menuitem"
            href={`/u/${session.handle}`}
            className="block rounded-md px-2 py-1.5 hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            Profile
          </Link>
          <Link
            role="menuitem"
            href="/settings"
            className="block rounded-md px-2 py-1.5 hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
          <button
            role="menuitem"
            type="button"
            className="block w-full rounded-md px-2 py-1.5 text-left text-destructive hover:bg-muted"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
