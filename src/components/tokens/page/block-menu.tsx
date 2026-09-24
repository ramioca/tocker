"use client";

import { useState, useTransition } from "react";
import { Ban, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { addToBlocklist, removeFromBlocklist } from "@/server/actions/blocklist";
import type { BlocklistTarget } from "@/server/queries/tokens";
import type { Chain } from "@/server/types";

/**
 * "Block on…" — the only control a token page has over an agent.
 *
 * There is no allowlist to add to (SPEC rule 2), so this menu can only ever
 * remove permission. That asymmetry is deliberate and worth being literal about:
 * a second click on a blocked agent lifts the block again, and nothing here can
 * make an agent buy anything.
 *
 * Only the viewer's own agents are listed — the server action re-checks
 * ownership, this is not the enforcement.
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
  agents: BlocklistTarget[];
}) {
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(agents.map((agent) => [agent.id, agent.blocked])),
  );
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (agents.length === 0) return null;

  const blockedCount = Object.values(state).filter(Boolean).length;

  const toggle = (agent: BlocklistTarget) => {
    const currentlyBlocked = state[agent.id] === true;
    setBusyId(agent.id);
    startTransition(async () => {
      const result = currentlyBlocked
        ? await removeFromBlocklist(agent.id, chain, address)
        : await addToBlocklist(agent.id, chain, address, symbol);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setState((prev) => ({ ...prev, [agent.id]: !currentlyBlocked }));
      toast.success(
        currentlyBlocked
          ? `${agent.name} may trade ${symbol} again`
          : `${agent.name} will never touch ${symbol}`,
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
          Your agents will never trade {symbol}. This is the only list in Tocker, and it only
          subtracts.
        </p>
        <DropdownMenuSeparator />
        {agents.map((agent) => {
          const blocked = state[agent.id] === true;
          const busy = pending && busyId === agent.id;
          return (
            <DropdownMenuItem
              key={agent.id}
              closeOnClick={false}
              disabled={busy}
              onClick={() => toggle(agent)}
              className="justify-between gap-2"
            >
              <span className="truncate">{agent.name}</span>
              {busy ? (
                <Loader2 aria-hidden className="size-3.5 animate-spin text-muted-foreground" />
              ) : blocked ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Check aria-hidden className="size-3.5" />
                  blocked
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
