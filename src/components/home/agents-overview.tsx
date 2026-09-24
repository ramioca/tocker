import Link from "next/link";
import { ArrowUpRight, Bot, Plus } from "lucide-react";
import { AgentCard } from "@/components/agents/agent-card";
import { EmptyState } from "@/components/common/empty-state";
import type { HomeOverview } from "@/server/queries/home";

/**
 * Your agents, as cards.
 *
 * Deliberately NOT a `.glass-panel`: this is a grid of up to a dozen repeating
 * surfaces, and `AgentCard` is `.glass-card` — the unblurred weight. Wrapping
 * them in a blurred panel would put a backdrop-filter behind twelve more, which
 * is the one thing the material system forbids.
 */
export function AgentsOverview({
  agents,
  counts,
  accountPaused = false,
}: {
  agents: HomeOverview["agents"];
  counts: HomeOverview["counts"];
  /** Trading is paused account-wide, so no agent here is actually running. */
  accountPaused?: boolean;
}) {
  return (
    <section aria-labelledby="home-agents-heading" id="agents" className="scroll-mt-20">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h2
            id="home-agents-heading"
            className="flex items-center gap-2 text-lg font-medium tracking-tight"
          >
            <Bot aria-hidden className="size-4.5 text-primary" />
            Your agents
          </h2>
          <p className="tnum mt-1 text-sm text-muted-foreground">
            {counts.total === 0
              ? "Nothing deployed yet."
              : accountPaused
                ? `${counts.total} agent${counts.total === 1 ? "" : "s"} · all trading paused account-wide.`
                : `${counts.active} active · ${counts.paused} paused · ${counts.live} trading live money.`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/agents"
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97]"
          >
            All agents
            <ArrowUpRight aria-hidden className="size-3.5" />
          </Link>
          <Link
            href="/agents/new"
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.97]"
          >
            <Plus aria-hidden className="size-3.5" />
            New agent
          </Link>
        </div>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          className="mt-5"
          icon={<Bot />}
          title="No agents yet"
          description="An agent is a prompt, a wallet and a schedule. Build one in about two minutes — it starts on paper, so the first mistake costs nothing."
          action={
            <Link
              href="/agents/new"
              className="focus-ring rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
            >
              Build your first agent
            </Link>
          }
        />
      ) : (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.slice(0, 6).map((agent, index) => (
            <li key={agent.id}>
              <AgentCard agent={agent} index={index} accountPaused={accountPaused} />
            </li>
          ))}
        </ul>
      )}

      {agents.length > 6 ? (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          <Link href="/agents" className="focus-ring rounded hover:text-foreground hover:underline">
            {agents.length - 6} more on My agents →
          </Link>
        </p>
      ) : null}
    </section>
  );
}
