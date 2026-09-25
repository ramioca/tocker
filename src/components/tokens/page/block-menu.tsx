"use client";

import { useState, useTransition } from "react";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { addToBlocklist, removeFromBlocklist } from "@/server/actions/blocklist";
import { safeAction } from "@/lib/safe-action";
import type { BlocklistTarget } from "@/server/queries/tokens";
import type { Chain } from "@/server/types";
import { chainLabel } from "@/components/common/chain-badge";
import { formatUsd } from "@/components/common/format";

/**
 * `onChain` is optional so an older caller that does not know it still gets a working menu.
 * `holdingUsd` is the agent's open position here (null: held, value unknown; absent: not
 * held) — the page joins it from the public holders list, and only onto the viewer's own agents.
 */
type BlockTarget = BlocklistTarget & { onChain?: boolean; holdingUsd?: number | null };

/**
 * "Block on…" — the only control a token page has over an agent.
 *
 * There is no allowlist to add to (SPEC rule 2), so this menu can only ever
 * remove permission. That asymmetry is deliberate and worth being literal about:
 * a second click on a blocked agent lifts the block again, and nothing here can
 * make an agent buy anything.
 *
 * A block stops entries only. Exits are never blocked (lib/trading/risk.ts), so an
 * agent holding the token still sells it on its own rules — the copy says "won't
 * buy", not "never touch", and a holder's row says its exits still run.
 *
 * Only the viewer's own agents are listed — the server action re-checks
 * ownership, this is not the enforcement.
 *
 * Items are checkboxes, so a screen reader hears "checked" on a blocked agent instead
 * of finding out only from text that appears after a click. An agent that does not
 * trade this chain is listed but disabled — blocking it would toast "Base Camp won't
 * buy WIF again" about a token it could never reach — unless it is already blocked,
 * in which case it stays enabled so the block can be lifted.
 */
export function BlockMenu({
  chain,
  address,
  symbol,
  agents,
}: {
  chain: Chain;
  address: string;
  symbol: string;
  agents: BlockTarget[];
}) {
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(agents.map((agent) => [agent.id, agent.blocked])),
  );
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (agents.length === 0) return null;

  const blockedCount = Object.values(state).filter(Boolean).length;

  const toggle = (agent: BlockTarget) => {
    const currentlyBlocked = state[agent.id] === true;
    setBusyId(agent.id);
    startTransition(async () => {
      // Guarded, so a throw (offline, a deploy mid-flight) clears the spinner too.
      const result = await safeAction<{ blocked: boolean; count: number }>(() =>
        currentlyBlocked
          ? removeFromBlocklist(agent.id, chain, address)
          : addToBlocklist(agent.id, chain, address, symbol),
      );
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setState((prev) => ({ ...prev, [agent.id]: !currentlyBlocked }));
      toast.success(
        currentlyBlocked
          ? `${agent.name} may buy ${symbol} again`
          : `${agent.name} won’t buy ${symbol} again`,
      );
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <Ban aria-hidden />
            {blockedCount > 0 ? `Blocked on ${blockedCount}` : "Block on…"}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-64">
        {/* A description, not a group label: Base UI's GroupLabel throws outside a Group,
            and that took the whole token page down to the error screen. */}
        <p className="px-1.5 py-1 text-[11px] leading-snug text-muted-foreground">
          Stop an agent from buying {symbol}. Pick it again to lift the block. Open positions
          still exit on the agent&rsquo;s own rules.
        </p>
        <DropdownMenuSeparator />
        {agents.map((agent) => {
          const blocked = state[agent.id] === true;
          const busy = pending && busyId === agent.id;
          const offChain = agent.onChain === false;
          return (
            <DropdownMenuCheckboxItem
              key={agent.id}
              checked={blocked}
              onCheckedChange={() => toggle(agent)}
              closeOnClick={false}
              disabled={busy || (offChain && !blocked)}
              className="gap-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{agent.name}</span>
                {offChain ? (
                  <span className="block text-[11px] text-muted-foreground">
                    Doesn&rsquo;t trade {chainLabel(chain)}
                  </span>
                ) : agent.holdingUsd !== undefined ? (
                  <span className="tnum block text-[11px] text-muted-foreground">
                    Holds {agent.holdingUsd === null ? "a position" : formatUsd(agent.holdingUsd)} · exits
                    still run
                  </span>
                ) : null}
              </span>
              {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin text-muted-foreground" /> : null}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
