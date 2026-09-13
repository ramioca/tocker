"use client";

/**
 * The owner's inbox for one agent (or, on the notifications page, for all of them).
 *
 * It is deliberately the first thing on the agent page when it is non-empty: a proposal
 * has a clock on it, and anything below the fold is a trade the operator missed. When it
 * is empty it renders nothing at all — an approval queue that advertises its own
 * emptiness is noise on every page load.
 *
 * `?proposal=<id>` (the deep link in the owner's notification) scrolls that card into
 * view and rings it for a moment.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Gavel } from "lucide-react";
import { ProposalCard } from "./proposal-card";
import type { ProposalRow } from "@/server/types";

/** How long a decided card stays on screen before the list drops it. */
const SETTLE_MS = 2_400;

export function ProposalList({
  proposals,
  showAgent = false,
  heading,
  className,
}: {
  proposals: ProposalRow[];
  showAgent?: boolean;
  heading?: string;
  className?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const deepLink = params.get("proposal");
  const [decided, setDecided] = useState<Record<string, true>>({});
  const [dropped, setDropped] = useState<Record<string, true>>({});

  const visible = useMemo(() => proposals.filter((p) => !dropped[p.id]), [proposals, dropped]);

  // Scroll the deep-linked card into view once it is on screen.
  useEffect(() => {
    if (!deepLink) return;
    const node = document.getElementById(`proposal-${deepLink}`);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [deepLink]);

  // A decided card reads for a beat, then leaves and the server data is re-fetched.
  useEffect(() => {
    const ids = Object.keys(decided);
    if (ids.length === 0) return;
    const timer = window.setTimeout(() => {
      setDropped((current) => {
        const next = { ...current };
        for (const id of ids) next[id] = true;
        return next;
      });
      router.refresh();
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [decided, router]);

  if (visible.length === 0) return null;

  const count = visible.length;

  return (
    <section aria-labelledby="proposals-heading" className={className}>
      <header className="mb-2 flex items-center gap-2">
        <Gavel aria-hidden className="size-3.5 text-[oklch(0.8_0.15_75)]" />
        <h2 id="proposals-heading" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {heading ?? `${count} trade${count === 1 ? "" : "s"} awaiting your approval`}
        </h2>
      </header>
      <div className="space-y-2.5">
        {visible.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            showAgent={showAgent}
            highlighted={deepLink === proposal.id}
            onDecided={(tradeId) => setDecided((current) => ({ ...current, [tradeId]: true }))}
          />
        ))}
      </div>
    </section>
  );
}
