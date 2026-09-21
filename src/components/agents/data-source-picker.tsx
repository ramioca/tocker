"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { chainLabelFor } from "@/lib/wallets/funding";
import type { Chain, DataSourceInfo } from "@/server/types";

export const MAX_DATA_SOURCES = 12;

/** Registry entries payable on at least one of these chains. */
export function payableSources(sources: readonly DataSourceInfo[], chains: readonly Chain[]): DataSourceInfo[] {
  return sources.filter((source) => source.id === "bazaar" || source.chains.some((chain) => chains.includes(chain)));
}

/**
 * The x402 catalogue, filtered by the chain that pays (W7).
 *
 * The platform pays for data from its wallet on the resource's network, so which
 * chain a source is paid on decides which platform wallet has to hold USDC. By default
 * the picker shows the sources payable on a chain the agent trades — the wallet an
 * operator running a Solana agent has certainly funded — and one tap reveals the rest,
 * each labelled with the chain (and therefore the wallet) that pays for it. A Solana
 * agent buying X sentiment paid on Base is a legitimate choice; it just needs the Base
 * wallet funded, and the live checklist checks exactly that.
 */
export function DataSourcePicker({
  sources,
  chains,
  selected,
  onChange,
}: {
  sources: DataSourceInfo[];
  /** The chains the agent trades — the default filter. */
  chains: Chain[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const picked = new Set(selected);
  const onAgentChains = payableSources(sources, chains);
  // A selected source always stays visible, whatever the filter says: hiding a pick is
  // how someone ends up paying for something they cannot see.
  const visible = showAll
    ? sources
    : sources.filter((source) => picked.has(source.id) || onAgentChains.includes(source));
  const hidden = sources.length - visible.length;
  const otherChains = Array.from(
    new Set(
      sources
        .filter((source) => !onAgentChains.includes(source))
        .flatMap((source) => source.chains.filter((chain) => !chains.includes(chain))),
    ),
  );

  const toggle = (id: string) => {
    const next = picked.has(id) ? selected.filter((value) => value !== id) : [...selected, id];
    if (next.length > MAX_DATA_SOURCES) {
      toast.error(`${MAX_DATA_SOURCES} sources is the cap`, {
        description: "More than that and a single run costs more than most trades make.",
      });
      return;
    }
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {visible.map((source) => {
          const active = picked.has(source.id);
          const paysOnAgentChain = source.chains.some((chain) => chains.includes(chain));
          const paysOn =
            source.id === "bazaar"
              ? "any chain"
              : (paysOnAgentChain ? source.chains.filter((chain) => chains.includes(chain)) : source.chains)
                  .map(chainLabelFor)
                  .join(" · ");
          return (
            <button
              key={source.id}
              type="button"
              role="checkbox"
              aria-checked={active}
              onClick={() => toggle(source.id)}
              className={cn(
                "flex flex-col gap-1.5 rounded-xl border p-3 text-left",
                "transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.99]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "border-primary/50 bg-primary/8" : "border-border/70 bg-card/30 hover:border-border hover:bg-card/60",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium">{source.name}</span>
                {active ? <Check aria-hidden className="size-3.5 text-primary" /> : null}
                <span className="tnum ml-auto font-mono text-[11px] text-muted-foreground">
                  {source.priceUsd === null ? "dynamic" : `$${source.priceUsd.toFixed(3)}`}
                </span>
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">{source.description}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    "rounded border px-1.5 py-px text-[10px]",
                    paysOnAgentChain || source.id === "bazaar"
                      ? "border-border bg-muted/40 text-muted-foreground"
                      : "border-primary/40 bg-primary/8 text-foreground",
                  )}
                >
                  paid on {paysOn}
                  {paysOnAgentChain || source.id === "bazaar" ? "" : " — needs that platform wallet funded"}
                </span>
                <span className="rounded border border-border bg-muted/40 px-1.5 py-px text-[10px] capitalize text-muted-foreground">
                  {source.category}
                </span>
                {source.experimental ? (
                  <span className="rounded border border-border px-1.5 py-px text-[10px] uppercase text-muted-foreground">
                    experimental
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {hidden > 0 || showAll ? (
        <button
          type="button"
          onClick={() => setShowAll((current) => !current)}
          className="rounded text-[11px] text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showAll
            ? `Show only sources paid on ${chains.map(chainLabelFor).join(" or ") || "the agent's chains"}`
            : `Show ${hidden} more paid on ${otherChains.map(chainLabelFor).join(" or ") || "other chains"} — Tocker's wallet there must hold USDC`}
        </button>
      ) : null}
    </div>
  );
}
