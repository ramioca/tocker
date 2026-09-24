import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
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
          href="/home"
          className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Go home
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
