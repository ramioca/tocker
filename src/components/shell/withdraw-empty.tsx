"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { formatUsd } from "@/components/common/format";
import type { AgentCash } from "@/lib/wallets/funding";

/** Agents listed by name before the rest collapse into "and N more". */
const AGENTS_SHOWN = 4;

const TEXT_LINK =
  "rounded text-xs text-muted-foreground underline underline-offset-2 transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Where an agent's money is taken out: its Withdraw card. */
export function agentWithdrawHref(slug: string): string {
  return `/agents/${slug}/settings#withdraw`;
}

/**
 * What Withdraw shows when there is no cash to send.
 *
 * A chain, an amount and an address to send nothing from is a form that can only fail,
 * so it says why instead. There are two reasons, and they need different next steps:
 * the money is in the user's agents (the top bar counts it, so "nothing to withdraw"
 * right under "$25.00 cash" read as a bug), or there is no money yet.
 */
export function WithdrawEmpty({
  agents,
  inAgentsUsd,
  onDeposit,
  onNavigate,
}: {
  /** The user's agents that hold something, as the Cash panel lists them. */
  agents: AgentCash[];
  inAgentsUsd: number;
  onDeposit?: () => void;
  /**
   * Closes the dialog. The chip closes it on a route change, but a link to the page the
   * user is already on only changes the hash.
   */
  onNavigate: () => void;
}) {
  if (inAgentsUsd > 0) {
    const shown = agents.slice(0, AGENTS_SHOWN);
    const more = agents.length - shown.length;
    return (
      <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium">Your money is in your agents</p>
          <p className="tnum text-xs leading-relaxed text-muted-foreground">
            {formatUsd(inAgentsUsd)} is working in your agents and {formatUsd(0)} is in your cash. Move it back to
            your cash first, then withdraw it from here.
          </p>
        </div>

        <ul className="space-y-2">
          {shown.map((agent) => (
            <li
              key={agent.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/40 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{agent.name}</p>
                <p className="tnum text-[11px] text-muted-foreground">
                  {agent.positionsUsd > 0
                    ? `${formatUsd(agent.cashUsd)} cash · ${formatUsd(agent.positionsUsd)} in positions`
                    : `${formatUsd(agent.equityUsd)} · all cash`}
                </p>
              </div>
              <Link
                href={agentWithdrawHref(agent.slug)}
                onClick={onNavigate}
                className="inline-flex h-8 shrink-0 items-center rounded-lg border border-border px-3 text-xs font-medium transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                Move to cash
              </Link>
            </li>
          ))}
        </ul>

        {more > 0 ? (
          <p className="text-center">
            <Link href="/agents" onClick={onNavigate} className={TEXT_LINK}>
              and {more} more
            </Link>
          </p>
        ) : null}

        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          Open positions have to be sold before their value can be withdrawn.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4 text-center">
      <p className="text-sm font-medium">Nothing to withdraw yet.</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Deposit USDC first; once it lands you can send it to any wallet from here. If you funded an agent that
        isn&rsquo;t live yet, withdraw it from that agent&rsquo;s settings.
      </p>
      {onDeposit ? (
        <button
          type="button"
          onClick={onDeposit}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus aria-hidden className="size-4" />
          Deposit
        </button>
      ) : null}
      <p>
        <Link href="/agents" onClick={onNavigate} className={TEXT_LINK}>
          Your agents
        </Link>
      </p>
    </div>
  );
}
