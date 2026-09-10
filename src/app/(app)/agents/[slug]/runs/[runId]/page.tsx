import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RunSteps } from "@/components/agents/run-steps";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { RelativeTime } from "@/components/common/relative-time";
import { RunStatusBadge } from "@/components/common/status-badge";
import { TokenIcon } from "@/components/common/token-icon";
import { formatDuration, formatUsd } from "@/components/common/format";
import { agentBySlug, runDetail, viewerSession } from "@/components/common/data-access";
import { cn } from "@/lib/utils";

type Params = { params: Promise<{ slug: string; runId: string }> };

export const metadata: Metadata = { title: "Run" };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="tnum mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}

export default async function RunPage({ params }: Params) {
  const { slug, runId } = await params;
  const session = await viewerSession();
  const [agent, run] = await Promise.all([
    agentBySlug(slug, session?.userId ?? null),
    runDetail(runId, session?.userId ?? null),
  ]);
  if (!agent || !run) notFound();

  const elapsed =
    run.startedAt && run.finishedAt
      ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
      : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <Link
        href={`/agents/${agent.slug}`}
        className="inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        {agent.name}
      </Link>

      <header className="mt-3 flex flex-wrap items-center gap-3">
        <AgentAvatar seed={agent.avatarSeed} name={agent.name} size="md" />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            Run
            <span className="font-mono text-xs font-normal text-muted-foreground">{run.id}</span>
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <RunStatusBadge status={run.status} />
            <span className="capitalize">{run.trigger}</span>
            <span aria-hidden>·</span>
            <RelativeTime iso={run.createdAt} className="text-xs" />
          </p>
        </div>
      </header>

      {run.error ? (
        <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2.5 font-mono text-xs text-destructive">
          {run.error}
        </p>
      ) : run.summary ? (
        <p className="mt-4 rounded-xl border border-border/70 bg-card/40 px-3 py-2.5 text-sm leading-relaxed text-foreground/85">
          {run.summary}
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Steps" value={String(run.steps.length || run.stepCount)} />
        <Stat label="Trades" value={String(run.tradeCount)} />
        <Stat label="Data spend" value={formatUsd(run.dataSpendUsd)} />
        <Stat
          label="Tokens"
          value={`${(run.inputTokens / 1000).toFixed(1)}k / ${(run.outputTokens / 1000).toFixed(1)}k`}
        />
        <Stat label="Duration" value={elapsed === null ? "running" : formatDuration(elapsed)} />
      </div>

      {run.trades.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Trades from this run
          </h2>
          <ul className="mt-2 space-y-2">
            {run.trades.map((trade) => (
              <li
                key={trade.id}
                className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border/70 bg-card/40 px-3 py-2.5"
              >
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    trade.side === "buy"
                      ? "bg-positive/15 text-positive"
                      : "bg-negative/15 text-negative",
                  )}
                >
                  {trade.side}
                </span>
                <TokenIcon token={trade.token} size="sm" />
                <span className="text-sm font-medium">{trade.token.symbol}</span>
                <span className="tnum text-sm">{formatUsd(trade.amountUsd)}</span>
                <span className="tnum text-xs text-muted-foreground">
                  @ {formatUsd(trade.priceUsd)}
                </span>
                {trade.rationale ? (
                  <p className="w-full border-l-2 border-primary/40 pl-3 text-sm leading-relaxed text-foreground/80">
                    {trade.rationale}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Transcript
        </h2>
        <RunSteps steps={run.steps} status={run.status} durationMs={elapsed} />
      </section>
    </div>
  );
}
