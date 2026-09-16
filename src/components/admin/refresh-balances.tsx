"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshAdminBalancesAction } from "@/server/actions/admin";

/**
 * "as of 14:32" plus the one button that changes it.
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

  const clock = new Date(readAt);
  const label = Number.isNaN(clock.getTime())
    ? "not read"
    : clock.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex items-center gap-2">
      <span className="tnum font-mono text-[11px] text-muted-foreground" suppressHydrationWarning>
        as of {label}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        aria-label="Re-read every agent wallet from Privy"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await refreshAdminBalancesAction();
            if (!res.ok) setError(res.error);
            else router.refresh();
          })
        }
      >
        <RotateCw className={pending ? "motion-safe:animate-spin" : undefined} aria-hidden />
        {pending ? "Reading…" : "Refresh"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
