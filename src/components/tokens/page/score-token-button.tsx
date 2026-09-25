"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Gauge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import { safeAction } from "@/lib/safe-action";
import { scoreTokenNow } from "@/server/actions/blocklist";
import type { Chain } from "@/server/types";

/**
 * "Score it" — for a token nothing has ever looked at.
 *
 * Scoring is free (Jupiter, RugCheck, DexScreener and GoPlus are all keyless), so
 * this is offered to anyone signed in rather than hidden behind an agent. It runs
 * under the platform's **default** universe, which is what makes the resulting
 * verdict publishable: an agent's own gates are part of its strategy.
 *
 * A token page never scores on render. Anyone can point a URL at any address, and
 * a page that fans out to four providers on every hit is a page that gets an
 * operator rate-limited by Jupiter.
 *
 * `lastScoredAt` is the newest point in the token's score history. When there is one,
 * the token *has* been looked at — just not under the default rules, or not since an
 * agent rescored it under its own — so the panel says the public score is out of date
 * rather than that nothing ever read it.
 */
export function ScoreTokenPanel({
  chain,
  address,
  signedIn,
  lastScoredAt = null,
  symbol,
}: {
  chain: Chain;
  address: string;
  signedIn: boolean;
  lastScoredAt?: string | null;
  /** The page's symbol, so the toast names the token the reader is looking at. */
  symbol: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const run = () => {
    setFailed(null);
    startTransition(async () => {
      const result = await safeAction(
        () => scoreTokenNow(chain, address),
        "Could not reach Tocker. Try again in a moment.",
      );
      if (!result.ok) {
        setFailed(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(`${symbol} scored ${Math.round(result.data.total)}/100`);
      router.refresh();
    });
  };

  const stale = lastScoredAt !== null;

  const button = signedIn ? (
    <Button onClick={run} disabled={pending} size="sm" className="gap-1.5">
      {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Gauge aria-hidden />}
      {pending ? "Reading providers…" : stale ? "Rescore" : "Score it"}
    </Button>
  ) : null;

  return (
    <EmptyState
      icon={<Gauge />}
      title={stale ? "The public score is out of date" : "Not scored yet"}
      description={
        stale
          ? signedIn
            ? "The history below keeps every reading, but the verdict here needs a fresh one under the platform's default rules. Rescoring is free — it reads Jupiter, RugCheck, DexScreener and GoPlus, and spends nothing."
            : "The history below keeps every reading, but the verdict here needs a fresh one under the platform's default rules. Sign in to rescore it — scoring is free and costs no x402 money."
          : signedIn
            ? "Nothing has looked at this token under the platform's default rules. Scoring is free — it reads Jupiter, RugCheck, DexScreener and GoPlus, and spends nothing."
            : "Nothing has looked at this token yet. Sign in to score it — scoring is free and costs no x402 money."
      }
      action={
        stale ? (
          <div className="flex flex-col items-center gap-2">
            {button}
            <p className="text-xs text-muted-foreground">
              Last read <RelativeTime iso={lastScoredAt} />
            </p>
          </div>
        ) : (
          button
        )
      }
      className={failed ? "border-destructive/30" : undefined}
    />
  );
}
