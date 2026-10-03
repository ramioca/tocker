"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const PRESS =
  "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] focus-ring";

/**
 * The body of a route error boundary, shared by `app/error.tsx` and `app/(client)/(app)/error.tsx`.
 *
 * `fullScreen` is for the root boundary only: it replaces the whole document, so it
 * centres itself in the viewport. Inside the app shell the header and tab bar are still
 * there, and the state sits in the content column like any other page — a failed page
 * should not also take the navigation away with it.
 *
 * Next 16 hands the boundary a `retry` callback (it was `reset` before).
 */
export function RouteErrorState({
  error,
  retry,
  fullScreen = false,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  fullScreen?: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    console.error(error);
  }, [error]);

  // Focus moves here so a keyboard or screen-reader user lands on what replaced the
  // page, not on whatever link they last pressed, which may no longer exist.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 text-center",
        fullScreen ? "min-h-dvh px-6" : "mx-auto w-full max-w-5xl px-4 py-16 sm:px-6",
      )}
    >
      <span className="grid size-11 place-items-center rounded-xl bg-destructive/12 text-destructive">
        <TriangleAlert aria-hidden className="size-5" />
      </span>

      <div className="space-y-1.5">
        <h1 ref={headingRef} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none">
          That did not load
        </h1>
        {/* Not only a page load: a failed render after an action lands here too. */}
        <p role="alert" className="mx-auto max-w-md text-sm text-muted-foreground">
          Something went wrong. Trying again usually fixes it; if not, head home and come back in a
          minute.
        </p>
        {error.digest ? (
          <p className="font-mono text-[11px] text-muted-foreground">digest {error.digest}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={retry}
          className={cn(PRESS, "bg-primary font-medium text-primary-foreground hover:bg-primary/90")}
        >
          <RotateCcw aria-hidden className="size-4" />
          Try again
        </button>
        <Link href="/home" className={cn(PRESS, "border border-border hover:bg-muted")}>
          Go home
        </Link>
      </div>
    </div>
  );
}
