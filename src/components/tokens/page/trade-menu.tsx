"use client";

import { Fragment } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/components/common/format";
import type { BlocklistTarget } from "@/server/queries/tokens";
import type { Chain } from "@/server/types";

type TradeTarget = BlocklistTarget & { onChain?: boolean; holdingUsd?: number | null };

/** The agent page, with its Trade sheet opened on this token (see ManualTradeSheet). */
export function tradeHref(slug: string, side: "buy" | "sell", chain: Chain, address: string, symbol: string): string {
  const params = new URLSearchParams({ trade: side, chain, token: address, sym: symbol });
  return `/agents/${encodeURIComponent(slug)}?${params.toString()}`;
}

/**
 * "Buy" on a token page — the shortest road from "this looks good" to an order.
 *
 * The page already knows which of the viewer's own agents trade this chain (the Block
 * menu uses the same list), so buying is: pick the agent, land in its Trade sheet with
 * the token filled in, choose a size. One agent on the chain skips the menu entirely.
 * An agent that holds the token also offers Sell. Every order still goes through that
 * agent's own guard — this is a shortcut to the form, not around it.
 */
export function TradeMenu({
  chain,
  address,
  symbol,
  agents,
}: {
  chain: Chain;
  address: string;
  symbol: string;
  agents: TradeTarget[];
}) {
  const router = useRouter();
  const eligible = agents.filter((agent) => agent.onChain);
  if (eligible.length === 0) return null;

  if (eligible.length === 1) {
    const [agent] = eligible;
    const holds = agent.holdingUsd !== undefined;
    return (
      <div className="flex gap-1.5">
        <Button size="sm" className="gap-1.5" onClick={() => router.push(tradeHref(agent.slug, "buy", chain, address, symbol))}>
          <ArrowLeftRight aria-hidden />
          Buy {symbol}
        </Button>
        {holds ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => router.push(tradeHref(agent.slug, "sell", chain, address, symbol))}
          >
            Sell
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" className="gap-1.5">
            <ArrowLeftRight aria-hidden />
            Trade {symbol}
            <ChevronDown aria-hidden className="opacity-70" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-64">
        <p className="px-1.5 py-1 text-[11px] leading-snug text-muted-foreground">
          Opens the agent&rsquo;s Trade sheet with {symbol} filled in. Its own caps and gates still apply.
        </p>
        <DropdownMenuSeparator />
        {eligible.map((agent) => (
          <Fragment key={agent.id}>
            <DropdownMenuItem onClick={() => router.push(tradeHref(agent.slug, "buy", chain, address, symbol))}>
              <span className="min-w-0 flex-1 truncate">Buy with {agent.name}</span>
            </DropdownMenuItem>
            {agent.holdingUsd !== undefined ? (
              <DropdownMenuItem onClick={() => router.push(tradeHref(agent.slug, "sell", chain, address, symbol))}>
                <span className="min-w-0 flex-1 truncate">Sell from {agent.name}</span>
                {agent.holdingUsd !== null ? (
                  <span className="tnum text-xs text-muted-foreground">{formatUsd(agent.holdingUsd)}</span>
                ) : null}
              </DropdownMenuItem>
            ) : null}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
