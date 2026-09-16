"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleStop, Play } from "lucide-react";
import { toast } from "sonner";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { RelativeTime } from "@/components/common/relative-time";
import { setTradingPausedAction } from "@/server/actions/security";
import { cn } from "@/lib/utils";

/**
 * One control that stops every agent this account owns.
 *
 * Pausing is a hold — it is a large, account-wide action and should cost a
 * deliberate second. Resuming is a plain click: making it *easy* to start trading
 * again would be the mistake, but making it ceremonial would tempt someone to
 * leave it off. The asymmetry is the wrong way round from a delete button on
 * purpose, and the copy says which is which.
 */
export function KillSwitchCard({ paused: initialPaused, pausedAt }: { paused: boolean; pausedAt: string | null }) {
  const router = useRouter();
  const [paused, setPaused] = useState(initialPaused);
  const [pending, startTransition] = useTransition();

  const flip = (next: boolean) => {
    startTransition(async () => {
      const result = await setTradingPausedAction(next);
      if (!result.ok) {
        toast.error("Not changed", { description: result.error });
        return;
      }
      setPaused(next);
      toast.success(next ? "All trading paused" : "Trading resumed", {
        description: next
          ? "No agent will open a new position. Exits keep running."
          : "Agents run on their schedules again.",
      });
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "glass flex items-start gap-3 rounded-xl border p-4",
          paused ? "border-destructive/40 bg-destructive/5" : "border-border/70 bg-card/30",
        )}
      >
        <span className="mt-0.5 shrink-0">
          {paused ? (
            <CircleStop aria-hidden className="size-5 text-destructive" />
          ) : (
            <Play aria-hidden className="size-5 text-muted-foreground" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{paused ? "Trading is paused" : "Trading is running"}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {paused ? (
              <>
                The scheduler is skipping every agent you own
                {pausedAt ? (
                  <>
                    {" "}
                    since <RelativeTime iso={pausedAt} className="text-foreground" />
                  </>
                ) : null}
                . No new position will be opened by any of them.
              </>
            ) : (
              "Every active agent wakes up on its own schedule and may open positions within its risk caps."
            )}
          </p>
        </div>
      </div>

      <div>
        {paused ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => flip(false)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "hover:bg-muted active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Play aria-hidden className="size-4" />
            {pending ? "Resuming…" : "Resume trading"}
          </button>
        ) : (
          <HoldToConfirmButton
            size="sm"
            duration={1_200}
            label="Hold to pause all trading"
            confirmedLabel="Paused"
            icon={<CircleStop className="size-3.5" />}
            disabled={pending}
            onConfirm={() => flip(true)}
          />
        )}
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <p className="text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">What the switch does not do.</span> It does not stop the
          exit engine — stop losses, take profits and trailing stops keep firing every five minutes while trading
          is paused, because a switch that froze those would lock you into every open position at exactly the
          moment you decided something was wrong. It does not cancel a transaction already in flight, move any
          funds out of an agent wallet, or revoke the app&rsquo;s signing key. Those are separate, deliberate
          actions.
        </p>
      </div>
    </div>
  );
}
