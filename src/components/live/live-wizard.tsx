"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pause, RefreshCw, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { ModeBadge } from "@/components/common/mode-badge";
import { RunSteps } from "@/components/agents/run-steps";
import { formatUsd } from "@/components/common/format";
import { chainLabelFor } from "@/lib/wallets/funding";
import {
  applyFirstTradePresetAction,
  checkLiveReadinessAction,
  goLiveAction,
  noteBudgetChangeAction,
  noteManualRunAction,
  pauseAgentAction,
  tradeReceiptAction,
} from "@/server/actions/security";
import { updateAgentAction } from "@/components/agents/agent-actions";
import type { LiveReadiness } from "@/lib/security/types";
import type { AgentConfig, TradeReceiptData } from "@/db/schema";
import type { AgentDetail, RunDetail } from "@/server/types";
import { Checklist } from "./checklist";
import { FirstFillPanel } from "./trade-receipt";
import { ProposalPanel } from "./proposal-panel";
import { readinessTally } from "./readiness-tally";
import { deriveRunOutcome } from "./run-outcome";
import { RUN_UNREACHABLE, runErrorMessage } from "./run-error";
import { cn } from "@/lib/utils";

/**
 * What the first-trade preset clamps to. `FIRST_TRADE_PRESET` lives in a server-only
 * module, so the numbers are repeated here for the sentence that describes them; the
 * server applies its own.
 */
const FIRST_TRADE = { maxTradeUsd: 2, maxDailyTrades: 1, stopLossPct: 25 } as const;

function listPhrase(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** How often to poll the run while it is in flight. */
const POLL_MS = 1_500;
/** Stop polling rather than hammer a run that is wedged. */
const POLL_TIMEOUT_MS = 5 * 60_000;
const LOST_TRACK = "Lost track of the run. It may still be going — open it to check.";

/**
 * The first live trade, as a screen.
 *
 * Three phases, and the screen refuses to move between them out of order:
 *
 *  1. **Check.** Every precondition, evaluated on the server, with the exact
 *     screen that fixes each red one. The readiness object is re-fetched from the
 *     server on demand — this component never decides for itself that something
 *     has become true.
 *  2. **Confirm.** A hold, not a click, and the sentence above it says in plain
 *     numbers what is about to become possible.
 *  3. **Prove it.** One run, streamed step by step, ending in a receipt with a
 *     link to the transaction on the chain, and a pause button right there.
 *
 * The server re-runs every check inside `goLiveAction`, so a stale green
 * checklist cannot be used to get past the gate.
 */
export function LiveWizard({
  agent,
  initialReadiness,
}: {
  agent: AgentDetail;
  initialReadiness: LiveReadiness;
}) {
  const router = useRouter();
  const [readiness, setReadiness] = useState(initialReadiness);
  const [mode, setMode] = useState(agent.mode);
  const [checking, startChecking] = useTransition();
  // Its own transition: applying the preset saves config and a wallet policy, which is
  // not "Checking…", and the Re-check spinner used to stand in for it.
  const [presetPending, startPreset] = useTransition();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [paused, setPaused] = useState(agent.status === "paused");
  const [receipt, setReceipt] = useState<TradeReceiptData | null>(null);
  // A hold only says the gesture finished, not that the server agreed. Each button shows
  // a pending verb until the answer comes back, and remounts (fresh, holdable) if it is no.
  const [goLiveAttempt, setGoLiveAttempt] = useState(0);
  const [pauseAttempt, setPauseAttempt] = useState(0);

  const cap = readiness.caps.maxTradeUsd;

  const recheck = useCallback(() => {
    startChecking(async () => {
      const result = await checkLiveReadinessAction(agent.id, cap);
      if (!result.ok) {
        toast.error("Could not re-check", { description: result.error });
        return;
      }
      setReadiness(result.data);
    });
  }, [agent.id, cap]);

  // A step that is waiting on the chain (a funding transfer confirming) re-checks itself
  // every few seconds for up to three minutes, so the operator never has to reload to
  // watch a red row turn green.
  const pendingSteps = readiness.steps.filter((step) => step.pending).length;
  useEffect(() => {
    if (pendingSteps === 0) return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      if (Date.now() - startedAt > 3 * 60_000) {
        clearInterval(id);
        return;
      }
      recheck();
    }, 6_000);
    return () => clearInterval(id);
  }, [pendingSteps, recheck]);

  // The config as the server last rendered it. Read at undo time, not click time, so an
  // undo lays the old caps over whatever the page now knows rather than a stale copy.
  const configRef = useRef(agent.config);
  useEffect(() => {
    configRef.current = agent.config;
  }, [agent.config]);

  /** Put back the four fields the preset touches: chains, per-trade and daily caps, stop. */
  const undoPreset = useCallback(
    (before: AgentConfig) => {
      startPreset(async () => {
        const current = configRef.current ?? before;
        const restored: AgentConfig = {
          ...current,
          chains: before.chains,
          risk: {
            ...current.risk,
            maxTradeUsd: before.risk.maxTradeUsd,
            maxDailyTrades: before.risk.maxDailyTrades,
            stopLossPct: before.risk.stopLossPct,
          },
        };
        // The same save the settings form makes, which also lifts the wallet policy
        // back up to the restored per-trade cap.
        const result = await updateAgentAction(agent.id, { config: restored });
        if (!result.ok) {
          toast.error("Preset not undone", { description: result.error });
          return;
        }
        const capsOf = (config: AgentConfig) => ({
          maxTradeUsd: config.risk.maxTradeUsd,
          maxDailyTrades: config.risk.maxDailyTrades,
          maxPositionPct: config.risk.maxPositionPct,
          maxDataSpendUsdPerRun: config.risk.maxDataSpendUsdPerRun,
        });
        void noteBudgetChangeAction({ agentId: agent.id, before: capsOf(current), after: capsOf(restored) });
        const again = await checkLiveReadinessAction(agent.id, restored.risk.maxTradeUsd);
        if (again.ok) setReadiness(again.data);
        toast.success("Preset undone", {
          description: `Back to ${formatUsd(restored.risk.maxTradeUsd)} a trade and ${restored.risk.maxDailyTrades} a day.`,
        });
        router.refresh();
      });
    },
    [agent.id, router],
  );

  const applyPreset = useCallback(() => {
    const before = configRef.current;
    startPreset(async () => {
      const result = await applyFirstTradePresetAction(agent.id);
      if (!result.ok) {
        toast.error("Preset not applied", { description: result.error });
        return;
      }
      setReadiness(result.data);
      toast.success("First-trade preset applied", {
        description: `One chain, ${formatUsd(FIRST_TRADE.maxTradeUsd)} a trade, one trade a day, with a stop loss under it.`,
        // One tap rewrote saved caps and a wallet policy; one tap puts them back.
        ...(before ? { action: { label: "Undo", onClick: () => undoPreset(before) }, duration: 10_000 } : {}),
      });
      router.refresh();
    });
  }, [agent.id, router, undoPreset]);

  const goLive = useCallback(async () => {
    const result = await goLiveAction({ agentId: agent.id, capUsd: cap }).catch(() => ({
      ok: false as const,
      error: "Could not reach Tocker. Nothing changed.",
    }));
    if (!result.ok) {
      toast.error("Still on paper", { description: result.error });
      setGoLiveAttempt((n) => n + 1);
      recheck();
      return;
    }
    setMode("live");
    toast.success("Trading live", {
      description: `Every fill from here spends real money, up to ${formatUsd(cap)} a trade.`,
    });
    router.refresh();
  }, [agent.id, cap, recheck, router]);

  const runOnce = useCallback(async () => {
    setStarting(true);
    setRunError(null);
    setRun(null);
    // Cleared here rather than in the fetch effect: the previous run's receipt must
    // not be on screen next to a new run's steps for even one frame.
    setReceipt(null);
    try {
      const res = await fetch(`/api/agents/${agent.id}/run`, { method: "POST" });
      // A gateway error answers with HTML, not JSON: unreadable is a failure, not a throw.
      const body = (await res.json().catch(() => null)) as { ok?: boolean; runId?: string; error?: string } | null;
      if (!res.ok || !body?.runId) {
        setRunError(runErrorMessage(res.status, body));
        return;
      }
      void noteManualRunAction(agent.id, body.runId);
      setRun({
        id: body.runId,
        agentId: agent.id,
        trigger: "manual",
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        summary: null,
        error: null,
        dataSpendUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        tradeCount: 0,
        stepCount: 0,
        createdAt: new Date().toISOString(),
        steps: [],
        transcriptVisible: true,
        trades: [],
      });
    } catch {
      // Only fetch itself throws here ("Failed to fetch"), which says nothing to anyone.
      setRunError(RUN_UNREACHABLE);
    } finally {
      setStarting(false);
    }
  }, [agent.id]);

  useRunPolling({
    agentId: agent.id,
    runId: run?.status === "running" || run?.status === "queued" ? run.id : null,
    onUpdate: setRun,
    onError: setRunError,
  });

  const pause = useCallback(async () => {
    const result = await pauseAgentAction(agent.id).catch(() => ({
      ok: false as const,
      error: "Could not reach Tocker. It is still running.",
    }));
    setPauseAttempt((n) => n + 1);
    if (!result.ok) {
      toast.error("Not paused", { description: result.error });
      return;
    }
    setPaused(true);
    toast.success(`${agent.name} paused`, { description: "It stops waking up. Exits still run." });
    router.refresh();
  }, [agent.id, agent.name, router]);

  /** Re-reads the run once, off the polling loop — used after a proposal is decided. */
  const refreshRun = useCallback(async () => {
    if (!run) return;
    try {
      const res = await fetch(`/api/agents/${agent.id}/runs/${run.id}`, { cache: "no-store" });
      if (res.ok) setRun((await res.json()) as RunDetail);
    } catch {
      // The agent page is one tap away and shows the same thing; a failed refresh is
      // not worth an error toast on top of the one the decision already produced.
    }
  }, [agent.id, run]);

  // What actually happened this tick — a fill, a question, a refusal, or nothing. The
  // derivation is pure and unit-tested (`./run-outcome.ts`): getting this wrong is how
  // a proposal used to be rendered as a completed buy.
  const outcome = deriveRunOutcome(run);
  const fill = outcome.state === "filled" || outcome.state === "failed" || outcome.state === "pending"
    ? outcome.trade
    : null;
  const live = mode === "live";
  const tally = readinessTally(readiness);
  const failCount = tally.fail;
  // What the preset would change, from the caps the checklist just read (the server's
  // `withFirstTradePreset` only ever lowers them, keeps the first chain, adds a stop).
  const presetChanges = [
    readiness.caps.maxTradeUsd > FIRST_TRADE.maxTradeUsd
      ? `${formatUsd(readiness.caps.maxTradeUsd)} → ${formatUsd(FIRST_TRADE.maxTradeUsd)} a trade`
      : null,
    readiness.caps.maxDailyTrades > FIRST_TRADE.maxDailyTrades
      ? `${readiness.caps.maxDailyTrades} → ${FIRST_TRADE.maxDailyTrades} trade a day`
      : null,
    readiness.caps.chains.length > 1
      ? `${readiness.caps.chains.map(chainLabelFor).join(" and ")} → ${chainLabelFor(readiness.caps.chains[0])} only`
      : null,
    agent.config && agent.config.risk.stopLossPct === null ? `a ${FIRST_TRADE.stopLossPct}% stop loss` : null,
  ].filter((change): change is string => change !== null);
  /** Owner-only page, so `config` is never null here; the fallback is the product default. */
  const executionMode = agent.config?.execution?.mode ?? "approve";
  const proposalTtlMinutes = agent.config?.execution?.proposalTtlMinutes ?? 60;

  // The execution receipt is written by the executor as the fill settles, so it can
  // trail the trade row by a moment. Fetch it once the trade id appears and leave it
  // null if there is none — the panel says so rather than inventing one.
  const fillId = fill?.id ?? null;
  useEffect(() => {
    if (!fillId) return;
    let cancelled = false;
    void tradeReceiptAction(agent.id, fillId).then((result) => {
      if (!cancelled && result.ok) setReceipt(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [agent.id, fillId]);

  return (
    <div className="space-y-6">
      <header>
        <Link
          href={`/agents/${agent.slug}/settings`}
          className="inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          {agent.name} settings
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">First live trade</h1>
          <ModeBadge mode={mode} />
        </div>
        <p className="mt-1.5 max-w-prose text-sm leading-6 text-muted-foreground">
          {readiness.steps.length} things have to be true before {agent.name} signs a real transaction. Each one is
          checked on the server, and each red one links to the screen that fixes it. Then you hold to go live, run
          a single tick, and read {executionMode === "approve" ? "what it wants to do" : "the receipt"}.
        </p>
      </header>

      {/* ------------------------------------------------------------ 1. check */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">1 · Preflight</h2>
          <span className="tnum font-mono text-xs text-muted-foreground">{tally.label}</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={applyPreset}
              disabled={checking || presetPending}
              aria-describedby="first-trade-preset-desc"
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium",
                "transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.97]",
                "disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <Sparkles aria-hidden className="size-3.5" />
              {presetPending ? "Applying…" : "First-trade preset"}
            </button>
            <button
              type="button"
              onClick={recheck}
              disabled={checking || presetPending}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw aria-hidden className={cn("size-3.5", checking && "animate-spin")} />
              {checking ? "Checking…" : "Re-check"}
            </button>
          </div>
        </div>

        {/* Next to the button, in this agent's own numbers: the button rewrites saved caps in
            one tap, and the sentence saying so used to sit under every checklist row. */}
        <p id="first-trade-preset-desc" className="text-xs leading-5 text-muted-foreground">
          {presetChanges.length > 0 ? (
            <>
              The first-trade preset sets <span className="tnum">{listPhrase(presetChanges)}</span> — the smallest
              shape that still proves the whole pipeline. Widen it once you have seen a fill.
            </>
          ) : (
            <>
              Already in first-trade shape: <span className="tnum">{formatUsd(readiness.caps.maxTradeUsd)}</span> a
              trade, <span className="tnum">{readiness.caps.maxDailyTrades}</span> a day, one chain, with a stop loss.
              Widen it once you have seen a fill.
            </>
          )}
        </p>

        <Checklist steps={readiness.steps} />
      </section>

      {/* ---------------------------------------------------------- 2. confirm */}
      <section className="glass space-y-3 rounded-xl border border-border/70 bg-card/30 p-4">
        <div className="flex items-center gap-2">
          <Zap aria-hidden className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">2 · Go live</h2>
          <ModeBadge mode={mode} className="ml-auto" />
        </div>

        {live ? (
          <p className="text-sm leading-6 text-muted-foreground">
            {agent.name} is live and is in{" "}
            {executionMode === "approve" ? "ask-before-trading mode" : "trade-on-its-own mode"}:{" "}
            {executionMode === "approve"
              ? "every order it wants to place comes to you as a proposal first, and nothing is signed until you approve one."
              : "it signs each order itself, without asking."}{" "}
            Its risk caps — {formatUsd(readiness.caps.maxTradeUsd)} a trade, {readiness.caps.maxDailyTrades} a day
            on {readiness.caps.chains.map(chainLabelFor).join(" and ")} — are enforced in code before the executor,
            not by the prompt.
          </p>
        ) : (
          <>
            {/*
              This sentence used to read "with no approval step" whatever the agent's
              execution mode was, and the product default is `approve`. It is the last
              thing an operator reads before spending real money, so it says what this
              agent will actually do.
            */}
            <p className="text-sm leading-6 text-muted-foreground">
              {/* With a check still red there is no button here to hold. */}
              {readiness.ready ? "Holding this switches" : "Once every check is green, holding the button here switches"}{" "}
              {agent.name} to live mode.{" "}
              {executionMode === "approve"
                ? "It is set to ask before it trades: each order becomes a proposal you approve, and the moment you approve one it signs a real transaction from its own wallet."
                : "From then on it signs real transactions from its own wallet without asking you first."}{" "}
              Up to {formatUsd(readiness.caps.maxTradeUsd)} per trade and {readiness.caps.maxDailyTrades} per day
              on {readiness.caps.chains.map(chainLabelFor).join(" and ") || "no chain"}. The server re-checks every item above before
              it agrees.
            </p>
            {readiness.ready ? (
              <HoldToConfirmButton
                key={goLiveAttempt}
                duration={2_200}
                label={`Hold to put ${agent.name} live`}
                confirmedLabel="Going live…"
                resetDelay={0}
                icon={<Zap className="size-4" />}
                onConfirm={() => void goLive()}
              />
            ) : failCount > 0 ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-muted-foreground">
                <span className="tnum">{failCount}</span> check{failCount === 1 ? " is" : "s are"} still red. Fix
                them and re-check — there is no way past this from here.
              </p>
            ) : (
              // Nothing red, only a transfer still confirming: not a failure, so not in red.
              <p className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                Waiting for a transfer to confirm. The checklist re-checks itself every few seconds.
              </p>
            )}
          </>
        )}
      </section>

      {/* ------------------------------------------------------- 3. prove it */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">3 · Run one tick</h2>
        </div>

        {!live ? (
          <p className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
            Available once the agent is live. A tick wakes the agent once, right now, instead of waiting for its
            schedule.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void runOnce()}
                disabled={starting || run?.status === "running" || run?.status === "queued"}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium",
                  "transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.97]",
                  "disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {starting || run?.status === "running" ? "Running…" : "Run one tick now"}
              </button>
              {run ? (
                <Link
                  href={`/agents/${agent.slug}/runs/${run.id}`}
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  Open the full run
                </Link>
              ) : null}
            </div>

            {runError ? (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {runError}
              </p>
            ) : null}

            {run ? (
              <div className="glass space-y-4 rounded-xl border border-border/70 bg-card/30 p-4">
                <RunSteps
                  steps={run.steps}
                  status={run.status}
                  // Only once it has finished: a duration read from the wall clock
                  // during render is impure, and a "thought for 3s" that jumps on
                  // every poll is noise anyway.
                  durationMs={
                    run.startedAt && run.finishedAt
                      ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
                      : null
                  }
                />
                {run.summary ? <p className="text-sm leading-6">{run.summary}</p> : null}
                {run.error ? <p className="font-mono text-xs text-destructive">{run.error}</p> : null}

                {/*
                  A refusal is not silence. `place_trade` returns `{ok: false, reason}`
                  rather than throwing, so a trade the risk guard rejected leaves no
                  `trades` row at all and the reason exists only in the transcript — which
                  is why this screen used to call a rejected tick "a normal outcome".
                */}
                {outcome.refusals.map((refusal, i) => (
                  <p
                    key={`${refusal.reason}-${i}`}
                    role="alert"
                    className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm leading-6 text-muted-foreground"
                  >
                    <span className="font-medium text-destructive">
                      {refusal.byGuard ? "Rejected by the risk guard" : "The trade could not be placed"}
                      {refusal.symbol ? ` · ${refusal.symbol}` : ""}
                    </span>
                    <br />
                    {refusal.reason}
                  </p>
                ))}

                {outcome.finishedWithoutTrading ? (
                  <p className="text-sm text-muted-foreground">
                    The run finished without trading. That is a normal outcome — nothing cleared the bar this
                    tick. Run it again later, or loosen the universe rules if it never does.
                  </p>
                ) : null}
              </div>
            ) : null}

            {outcome.state === "proposed" && outcome.trade ? (
              <ProposalPanel
                trade={outcome.trade}
                agentName={agent.name}
                ttlMinutes={proposalTtlMinutes}
                onDecided={() => {
                  void refreshRun();
                  router.refresh();
                }}
              >
                <Link
                  href={`/agents/${agent.slug}`}
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  Decide it on the agent page instead
                </Link>
              </ProposalPanel>
            ) : null}

            {fill ? (
              <FirstFillPanel trade={fill} receipt={receipt}>
                <HoldToConfirmButton
                  key={pauseAttempt}
                  size="sm"
                  duration={1_200}
                  label={paused ? "Already paused" : "Hold to pause this agent"}
                  confirmedLabel="Pausing…"
                  resetDelay={0}
                  icon={<Pause className="size-3.5" />}
                  disabled={paused}
                  onConfirm={() => void pause()}
                />
                <Link
                  href={`/agents/${agent.slug}`}
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  See it on the agent page
                </Link>
              </FirstFillPanel>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Poll the run detail while it is in flight.
 *
 * `/api/agents/[id]/runs/[runId]` returns the transcript only to the owner, so
 * this is the same privacy boundary as the run page — there is no second path to
 * someone else's steps here.
 */
function useRunPolling({
  agentId,
  runId,
  onUpdate,
  onError,
}: {
  agentId: string;
  runId: string | null;
  onUpdate: (run: RunDetail) => void;
  onError: (message: string) => void;
}) {
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (!runId) return;
    startedAt.current = Date.now();
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt.current > POLL_TIMEOUT_MS) {
        onError("Stopped watching after five minutes. The run may still be going — open it to check.");
        return;
      }
      try {
        const res = await fetch(`/api/agents/${agentId}/runs/${runId}`, { cache: "no-store" });
        const detail = (await res.json().catch(() => null)) as RunDetail | null;
        if (cancelled) return;
        if (!res.ok || detail === null) {
          onError(runErrorMessage(res.status, null, LOST_TRACK));
          return;
        }
        onUpdate(detail);
        if (detail.status === "running" || detail.status === "queued") {
          timer = setTimeout(tick, POLL_MS);
        }
      } catch {
        if (!cancelled) onError(RUN_UNREACHABLE);
      }
    };

    let timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [agentId, runId, onError, onUpdate]);
}
