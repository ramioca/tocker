"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/common/relative-time";
import { refreshAdminBalancesAction } from "@/server/actions/admin";

/**
 * "read 2 min ago" plus the one button that changes it.
 *
 * The timestamp is the honest part: balances come from a 60-second in-process cache over
 * a few hundred Privy calls, so the page must never imply they are live. Pressing this
 * drops the cache, re-reads, and re-renders the page with the new snapshot.
 *
 * The icon spins only while the read is in flight, and only for users who have not asked
 * for less motion. There is nothing else on this page that moves.
 */
export function RefreshBalances({ readAt }: { readAt: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Relative, not a clock: a time rendered on the server comes out in the server's zone,
  // and "how stale is this" is the question anyway. The exact time is its tooltip.
  const read = !Number.isNaN(new Date(readAt).getTime());

  return (
    // Stacked, not inline: the error is a sentence, and this sits in a table header row
    // that already wraps at phone width.
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <span className="tnum font-mono text-[11px] text-muted-foreground">
          {read ? (
            <>
              read <RelativeTime iso={readAt} />
            </>
          ) : (
            "not read"
          )}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          // A tooltip, not an aria-label: the visible "Refresh" / "Reading…" is the name,
          // so voice control can say it and a screen reader hears the pending state.
          title="Re-read every agent wallet from Privy"
          onClick={() =>
            start(async () => {
              setError(null);
              // A network throw would otherwise land on the route's error boundary.
              const res = await refreshAdminBalancesAction().catch(() => ({
                ok: false as const,
                error: "Could not reach Tocker.",
              }));
              if (!res.ok) setError(res.error);
              else router.refresh();
            })
          }
        >
          <RotateCw className={pending ? "motion-safe:animate-spin" : undefined} aria-hidden />
          {pending ? "Reading…" : "Refresh"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="max-w-xs break-words text-right text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
