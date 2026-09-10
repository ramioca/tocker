"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";

/** Next 16 hands the boundary a `retry` callback (it was `reset` before). */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-destructive/12 text-destructive">
        <TriangleAlert aria-hidden className="size-5" />
      </span>

      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">That did not load</h1>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          Something threw on the way to rendering this page. Retrying often works; if it does not,
          the feed is a safe place to land.
        </p>
        {error.digest ? (
          <p className="font-mono text-[11px] text-muted-foreground">digest {error.digest}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={retry}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw aria-hidden className="size-4" />
          Try again
        </button>
        <Link
          href="/feed"
          className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Go to the feed
        </Link>
      </div>
    </div>
  );
}
