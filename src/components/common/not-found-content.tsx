import Link from "next/link";
import { Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { viewerSession } from "@/components/common/data-access";

/**
 * "Nothing here", shared by the two 404s. The root one fills the screen, because an
 * unmatched URL has no shell around it; the one inside the app shell sits in the page's
 * own column, because a full-height block under a 56px bar scrolls into empty space and
 * puts the message below the centre. The caller passes the frame.
 */
export async function NotFoundContent({ className }: { className?: string }) {
  // Signed out, /home is a sign-in wall: someone who followed a dead shared link is
  // better served by the page that says what Tocker is. A failed session read is
  // treated as signed out rather than breaking the 404 itself.
  const session = await viewerSession().catch(() => null);
  const primary = session ? { href: "/home", label: "Go home" } : { href: "/", label: "Learn about Tocker" };

  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 text-center", className)}>
      <span className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
        <Compass aria-hidden className="size-5" />
      </span>

      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">Nothing here</h1>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          This agent, run or page does not exist — or it was deleted, or it is private and not
          yours to see.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Link
          href={primary.href}
          className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {primary.label}
        </Link>
        <Link
          href="/discover"
          className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Discover agents
        </Link>
      </div>
    </div>
  );
}
