import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentConfigSummary } from "@/components/agents/agent-config-summary";
import { AgentHeader } from "@/components/agents/agent-header";
import { AgentStats } from "@/components/agents/agent-stats";
import { AgentTabs } from "@/components/agents/agent-tabs";
import { PositionsTable } from "@/components/agents/positions-table";
import { PrivateStrategyPanel } from "@/components/agents/private-strategy";
import { ProposalList } from "@/components/agents/proposals/proposal-list";
import { RunsTimeline } from "@/components/agents/runs-timeline";
import { TradesTable } from "@/components/agents/trades-table";
import { PerformancePanel } from "@/components/agents/analytics";
import { EquityChart } from "@/components/charts/equity-chart";
import { agentBySlug, equitySeries, viewerSession } from "@/components/common/data-access";
import { listProposals } from "@/server/queries/proposals";
import { getAgentAnalyticsWindows } from "@/server/queries/analytics";
import type { AgentDetail, EquityPoint } from "@/server/types";

/**
 * The chart's last point is the newest snapshot, which the marks cron writes every five
 * minutes; the positions table under it is live. Append "now" so the headline is the
 * same number as the table, and the line reaches the present.
 */
function withLivePoint(points: EquityPoint[], agent: AgentDetail): EquityPoint[] {
  if (agent.equityUsd === null || agent.equityUsd === undefined) return points;
  const last = points.at(-1);
  if (last && Math.abs(last.equityUsd - agent.equityUsd) < 0.005) return points;
  return [
    ...points,
    { at: new Date().toISOString(), equityUsd: agent.equityUsd, cashUsd: agent.cashUsd ?? last?.cashUsd ?? 0 },
  ];
}

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const session = await viewerSession();
  const agent = await agentBySlug(slug, session?.userId ?? null);
  if (!agent) return { title: "Agent not found" };
  return {
    title: agent.name,
    description: agent.tagline ?? `${agent.name} trades ${agent.chains.join(" and ")} autonomously.`,
  };
}

export default async function AgentPage({ params }: Params) {
  const { slug } = await params;
  const session = await viewerSession();
  const agent = await agentBySlug(slug, session?.userId ?? null);
  if (!agent) notFound();

  const [equity, analytics, proposals] = await Promise.all([
    equitySeries(agent.id, "all"),
    // The record is public, so a provider hiccup here must cost the tab, not the page.
    getAgentAnalyticsWindows(agent.id).catch(() => null),
    // Owner-gated inside the query too — this is the second lock, not the only one.
    agent.isOwner ? listProposals(agent.id, session?.userId ?? null) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <AgentHeader agent={agent} />

      <div className="mt-6 space-y-6">
        {/* Above the tabs on purpose: a proposal has a clock on it. */}
        {proposals.length > 0 ? (
          <Suspense fallback={null}>
            <ProposalList proposals={proposals} />
          </Suspense>
        ) : null}

        <AgentStats agent={agent} />

        <AgentTabs
          overview={
            <div className="space-y-6">
              <section className="glass-panel rounded-2xl p-3 sm:p-4">
                <EquityChart
                  points={withLivePoint(equity.length > 1 ? equity : agent.equity, agent)}
                  startingUsd={agent.paperStartingUsd}
                  label={agent.name}
                />
              </section>

              <section>
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Positions
                </h2>
                <PositionsTable positions={agent.positions} cashUsd={agent.cashUsd} />
              </section>
            </div>
          }
          trades={<TradesTable agentId={agent.id} />}
          performance={analytics ? <PerformancePanel windows={analytics} /> : null}
          runs={<RunsTimeline agentId={agent.id} agentSlug={agent.slug} />}
          configLabel={agent.config ? "Config" : "Strategy"}
          /**
           * `agent.config` is already `null` for non-owners — the server never sent it.
           * This branch only decides what fills the space, it is not the enforcement.
           */
          config={
            agent.config ? (
              <AgentConfigSummary config={agent.config} />
            ) : (
              <PrivateStrategyPanel agent={agent} />
            )
          }
        />
      </div>
    </div>
  );
}
