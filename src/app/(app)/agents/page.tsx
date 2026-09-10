import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Plus } from "lucide-react";
import { AgentCard } from "@/components/agents/agent-card";
import { EmptyState } from "@/components/common/empty-state";
import { myAgents, viewerSession } from "@/components/common/data-access";

export const metadata: Metadata = {
  title: "My agents",
  description: "Every agent you have deployed, and what it is doing right now.",
};

export default async function MyAgentsPage() {
  const session = await viewerSession();
  const agents = await myAgents(session?.userId ?? null);

  const live = agents.filter((agent) => agent.mode === "live").length;
  const active = agents.filter((agent) => agent.status === "active").length;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">My agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {agents.length === 0
              ? "Nothing deployed yet."
              : `${agents.length} agent${agents.length === 1 ? "" : "s"} · ${active} active · ${live} trading live money.`}
          </p>
        </div>

        <Link
          href="/agents/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus aria-hidden className="size-4" />
          New agent
        </Link>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={<Bot />}
          title="No agents yet"
          description="An agent is a prompt, a wallet and a schedule. Build one in about two minutes and let it trade on paper first."
          action={
            <Link
              href="/agents/new"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
            >
              Build your first agent
            </Link>
          }
        />
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent, index) => (
            <AgentCard key={agent.id} agent={agent} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}
