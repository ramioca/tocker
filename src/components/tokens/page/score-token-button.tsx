"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Gauge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
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
 */
export function ScoreTokenPanel({
  chain,
  address,
  signedIn,
}: {
  chain: Chain;
  address: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const run = () => {
    setFailed(null);
    startTransition(async () => {
      const result = await scoreTokenNow(chain, address);
      if (!result.ok) {
        setFailed(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.symbol} scored ${Math.round(result.data.total)}/100`);
      router.refresh();
    });
  };

  return (
    <EmptyState
      icon={<Gauge />}
      title="Not scored yet"
      description={
        signedIn
          ? "Nothing has looked at this token under the platform's default rules. Scoring is free — it reads Jupiter, RugCheck, DexScreener and GoPlus, and spends nothing."
          : "Nothing has looked at this token yet. Sign in to score it — scoring is free and costs no x402 money."
      }
      action={
        signedIn ? (
          <Button onClick={run} disabled={pending} size="sm" className="gap-1.5">
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Gauge aria-hidden />}
            {pending ? "Reading providers…" : "Score it"}
          </Button>
        ) : null
      }
      className={failed ? "border-destructive/30" : undefined}
    />
  );
}
