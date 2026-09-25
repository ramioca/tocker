"use client";

/**
 * The owner's inbox for one agent (or, on the notifications page, for all of them).
 *
 * It is deliberately the first thing on the agent page when it is non-empty: a proposal
 * has a clock on it, and anything below the fold is a trade the operator missed. When it
 * is empty it renders nothing at all — an approval queue that advertises its own
 * emptiness is noise on every page load.
 *
 * **Two or more open proposals turn the list into a compare view.** A tick can put three
 * launch-day tokens in front of an operator at once, and stacked cards force them to be
 * judged one at a time from memory. Side by side, with the stat strips on the same
 * baseline, the comparison is the layout: age against age, buyers against buyers. The
 * order is newest first, because the newest token is the one the agent just found and
 * the oldest is the one about to expire at the bottom of the screen where the header
 * already warns about it.
 *
 * `?proposal=<id>` (the deep link in the owner's notification) scrolls that card into
 * view and rings it for a moment.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Gavel } from "lucide-react";
import { ProposalCard } from "./proposal-card";
import { byNewestFirst, formatCountdownCoarse, soonestExpiry } from "./proposal-stats";
import { useCoarseNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
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
  // The header's "expires in" moves in minutes, so it rides the coarse clock — the
  // per-card countdowns are the ones that need a second hand.
  const now = useCoarseNow();
  const [decided, setDecided] = useState<Record<string, true>>({});
  const [dropped, setDropped] = useState<Record<string, true>>({});
  const sectionRef = useRef<HTMLElement>(null);

  const visible = useMemo(
    () => byNewestFirst(proposals.filter((p) => !dropped[p.id])),
    [proposals, dropped],
  );

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
      handOffFocus(sectionRef.current, new Set(ids));
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
  const compare = count > 1;
  const soonest = soonestExpiry(visible, now);

  return (
    <section ref={sectionRef} aria-labelledby="proposals-heading" className={className}>
      <header className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Gavel aria-hidden className="size-3.5 text-[oklch(0.8_0.15_75)]" />
        <h2 id="proposals-heading" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {heading ?? `${count} trade${count === 1 ? "" : "s"} awaiting your approval`}
        </h2>
        {compare ? (
          <p className="tnum text-[11px] text-muted-foreground/80">
            <span aria-hidden className="mr-2">
              ·
            </span>
            newest first
            {soonest === null ? null : (
              <>
                <span aria-hidden className="mx-2">
                  ·
                </span>
                {soonest <= 0 ? "one has expired" : `first expires in ${formatCountdownCoarse(soonest)}`}
              </>
            )}
          </p>
        ) : null}
      </header>

      <div
        className={cn(
          compare
            ? "grid grid-cols-1 items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3"
            : "space-y-2.5",
        )}
      >
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

/**
 * Before decided cards leave: if focus is inside one of them, move it on, or it drops to
 * <body> and the next Tab starts from the top of the page. The next card that is staying
 * takes it (then the one before); with none left the whole list goes, heading included,
 * so the page's main region does.
 *
 * A card, not its first button: that would be Reject, one keypress from declining a
 * trade the operator has not read yet.
 */
function handOffFocus(section: HTMLElement | null, leaving: ReadonlySet<string>) {
  if (!section) return;
  const active = document.activeElement;
  const cards = Array.from(section.querySelectorAll<HTMLElement>("[data-proposal-card]"));
  const stays = (card: HTMLElement) => !leaving.has(card.id.replace(/^proposal-/, ""));
  const index = cards.findIndex((card) => card.contains(active));
  if (index < 0 || stays(cards[index])) return;
  const next = cards.slice(index + 1).find(stays) ?? cards.slice(0, index).reverse().find(stays);
  if (next) next.focus();
  else document.getElementById("main")?.focus({ preventScroll: true });
}
