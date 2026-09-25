import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { RunSteps } from "@/components/agents/run-steps";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { RelativeTime } from "@/components/common/relative-time";
import { RunStatusBadge } from "@/components/common/status-badge";
import { TokenIcon } from "@/components/common/token-icon";
import { formatCount, formatDuration, formatPriceUsd, formatUsd } from "@/components/common/format";
import { agentBySlug, runDetail, viewerSession } from "@/components/common/data-access";
import { isTranscriptRow } from "@/lib/agent/narrate";
import { cn } from "@/lib/utils";

type Params = { params: Promise<{ slug: string; runId: string }> };

/**
 * The agent and the run, or nothing. Both ids are in the URL, so a run is shown only
 * under the agent that made it — otherwise any link could hang one agent's trades and
 * reasoning under another's name and avatar. `cache` so the metadata and the page
 * share one load.
 */
const loadRun = cache(async (slug: string, runId: string) => {
  const session = await viewerSession();
  const [agent, run] = await Promise.all([
    agentBySlug(slug, session?.userId ?? null),
    runDetail(runId, session?.userId ?? null),
  ]);
  if (!agent || !run || run.agentId !== agent.id) return null;
  return { agent, run };
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, runId } = await params;
  const loaded = await loadRun(slug, runId);
  if (!loaded) return { title: "Run not found" };
  return { title: `${loaded.agent.name} · run` };
}

function Stat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("glass-inset rounded-lg px-3 py-2", className)}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="tnum mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}

export default async function RunPage({ params }: Params) {
  const { slug, runId } = await params;
  const loaded = await loadRun(slug, runId);
  if (!loaded) notFound();
  const { agent, run } = loaded;

  // Wall time is finish − start, but a step's own duration can outrun the run row's
  // timestamps (the tool finished after the row was stamped), so take whichever is longer.
  const wall =
    run.startedAt && run.finishedAt
      ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
      : null;
  let stepSpan: number | null = null;
  if (run.steps.length > 0) {
    let first = Infinity;
    let last = -Infinity;
    for (const step of run.steps) {
      const at = new Date(step.createdAt).getTime();
      first = Math.min(first, at);
      last = Math.max(last, at + (step.durationMs ?? 0));
    }
    stepSpan = last - first;
  }
  const elapsed = wall === null ? null : Math.max(wall, stepSpan ?? 0);
  // The rows the transcript actually shows, as the runs list counts them.
  const stepCount = run.transcriptVisible
    ? run.steps.filter(isTranscriptRow).length || run.stepCount
    : run.stepCount;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      {/* Back to the Runs tab, not Overview: that is where the reader came from. */}
      <Link
        href={`/agents/${agent.slug}?tab=runs`}
        className="inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground focus-ring"
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
        <p className="mt-4 glass-inset rounded-xl px-3 py-2.5 text-sm leading-relaxed text-foreground/85">
          {run.summary}
        </p>
      ) : null}

      {/* The token tile is a little wider than the rest: its value is two numbers. */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.4fr)_minmax(0,1fr)]">
        <Stat label="Steps" value={String(stepCount)} />
        <Stat label="Trades" value={String(run.tradeCount)} />
        <Stat label="Data spend" value={formatUsd(run.dataSpendUsd)} />
        {/* "LLM", and in/out spelled out: on a trading page a bare "Tokens" reads as coins. */}
        <Stat
          label="LLM tokens"
          value={
            <>
              {formatCount(run.inputTokens)} <span className="text-xs font-normal text-muted-foreground">in</span>
              {" · "}
              {formatCount(run.outputTokens)} <span className="text-xs font-normal text-muted-foreground">out</span>
            </>
          }
        />
        {/* Five tiles in two columns leave the last one alone; let it take the row. */}
        <Stat
          label="Duration"
          value={elapsed === null ? "running" : formatDuration(elapsed)}
          className="max-sm:col-span-2"
        />
      </div>

      {run.trades.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Trades from this run
          </h2>
          <ul className="mt-2 space-y-2">
            {run.trades.map((trade) => {
              // As in the Trades tab: a proposal, or an order that was refused or expired,
              // is listed but dimmed and labelled, so it never reads as a fill.
              const unfilled = trade.status !== "filled";
              const failed = trade.status === "failed" || trade.status === "rejected" || trade.status === "expired";
              return (
                <li
                  key={trade.id}
                  className={cn(
                    "flex flex-wrap items-center gap-2.5 glass-inset rounded-xl px-3 py-2.5",
                    unfilled && "opacity-60",
                  )}
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
                  {unfilled ? (
                    <span
                      title={trade.error ?? undefined}
                      className={cn(
                        "rounded border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                        failed ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground",
                      )}
                    >
                      {trade.status}
                    </span>
                  ) : null}
                  <Link
                    href={`/tokens/${trade.token.chain}/${trade.token.address}`}
                    className="inline-flex items-center gap-2 rounded hover:underline focus-ring"
                  >
                    <TokenIcon token={trade.token} size="sm" />
                    <span className="text-sm font-medium">{trade.token.symbol}</span>
                  </Link>
                  <span className="tnum text-sm">{formatUsd(trade.amountUsd)}</span>
                  <span className="tnum text-xs text-muted-foreground">
                    @ {formatPriceUsd(trade.priceUsd)}
                  </span>
                  {trade.rationale ? (
                    <p className="w-full border-l-2 border-primary/40 pl-3 text-sm leading-relaxed text-foreground/80">
                      {trade.rationale}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Transcript
        </h2>
        {/*
          `run.transcriptVisible` is decided server-side and `run.steps` is already empty
          for non-owners — this only chooses what to render in the gap.
        */}
        {run.transcriptVisible ? (
          <RunSteps steps={run.steps} status={run.status} durationMs={elapsed} />
        ) : (
          <div className="glass-panel glass-grain relative overflow-hidden rounded-2xl p-5">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-14 -top-16 size-44 rounded-full bg-primary/12 blur-3xl"
            />
            <div className="relative flex items-start gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/60">
                <Lock aria-hidden className="size-4 text-primary" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold tracking-tight">
                  @{agent.owner.handle}&rsquo;s transcript is private
                </h3>
                <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
                  The step-by-step log shows which sources this run bought, the exact queries
                  it sent and how it reasoned from the answers — in order. That is the
                  strategy itself, so it stays with its author.
                </p>
                <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
                  The outcome does not:{" "}
                  <span className="text-foreground/85">
                    {run.tradeCount === 0
                      ? "no trades"
                      : run.tradeCount === 1
                        ? "1 trade"
                        : `${run.tradeCount} trades`}
                    , {formatUsd(run.dataSpendUsd)} of data,{" "}
                    {elapsed === null ? "still running" : formatDuration(elapsed)}
                  </span>
                  {run.summary ? " — and the summary above." : "."}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
