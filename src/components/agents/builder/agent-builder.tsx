"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { agentConfigSchema } from "@/lib/agent/config";
import { StatusTracker } from "@/components/spectrumui/blocks/ai-assistants/status-tracker";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { ChainBadge } from "@/components/common/chain-badge";
import { ModeBadge } from "@/components/common/mode-badge";
import { formatUsd } from "@/components/common/format";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { createAgentAction } from "@/components/agents/agent-actions";
import { BrainStep, DataStep, IdentityStep, RiskStep, ScheduleStep, UniverseStep } from "./steps";
import { universeSentence } from "./universe-controls";
import { StepHeading } from "./field";
import { useDraft } from "./use-draft";
import { STEPS, type StepId } from "./types";
import { cn } from "@/lib/utils";
import { ScoreBadge } from "@/components/tokens/score-badge";
import type { AgentConfig } from "@/db/schema";
import type { DataSourceInfo, LlmKeyRow } from "@/server/types";

function validate(draft: ReturnType<typeof useDraft>["draft"]): Record<string, string> {
  const errors: Record<string, string> = {};

  if (draft.name.trim().length < 2) errors.name = "Give it a name — at least two characters.";
  if (!draft.llmKeyId) errors.llmKeyId = "Pick or add an API key. The agent cannot think without one.";

  const parsed = agentConfigSchema.safeParse(draft.config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "strategyPrompt") errors.strategyPrompt = issue.message;
      else if (key === "chains") errors.chains = issue.message;
      else if (typeof key === "string") errors[key] = issue.message;
    }
  }

  return errors;
}

const STEP_ERROR_KEYS: Record<StepId, string[]> = {
  identity: ["name"],
  brain: ["llmKeyId", "strategyPrompt", "llm"],
  data: ["dataSources"],
  universe: ["chains", "universe"],
  risk: ["risk"],
  schedule: ["schedule"],
  review: [],
};

export function AgentBuilder({
  sources,
  initialKeys,
}: {
  sources: DataSourceInfo[];
  initialKeys: LlmKeyRow[];
}) {
  const router = useRouter();
  const { draft, update, updateConfig, clear, restored } = useDraft();
  const [keys, setKeys] = useState(initialKeys);
  const [index, setIndex] = useState(0);
  const [touched, setTouched] = useState<Set<StepId>>(new Set());

  const errors = useMemo(() => validate(draft), [draft]);
  const step = STEPS[index];
  const stepErrors = STEP_ERROR_KEYS[step.id].filter((key) => errors[key]);
  const showErrors = touched.has(step.id);
  const visibleErrors = showErrors ? errors : {};
  const blocked = stepErrors.length > 0;

  const goNext = () => {
    if (blocked) {
      setTouched((current) => new Set(current).add(step.id));
      return;
    }
    setIndex((value) => Math.min(STEPS.length - 1, value + 1));
  };

  const goBack = () => setIndex((value) => Math.max(0, value - 1));

  const submit = async () => {
    const allErrors = validate(draft);
    if (Object.keys(allErrors).length > 0) {
      setTouched(new Set(STEPS.map((s) => s.id)));
      const firstBad = STEPS.findIndex((s) =>
        STEP_ERROR_KEYS[s.id].some((key) => allErrors[key]),
      );
      if (firstBad >= 0) setIndex(firstBad);
      toast.error("Something is still missing", {
        description: Object.values(allErrors)[0],
      });
      throw new Error("invalid");
    }

    const result = await createAgentAction({
      name: draft.name.trim(),
      tagline: draft.tagline.trim() || undefined,
      avatarSeed: draft.avatarSeed,
      isPublic: draft.isPublic,
      llmKeyId: draft.llmKeyId,
      paperStartingUsd: draft.paperStartingUsd,
      activate: draft.activate,
      config: draft.config,
    });

    if (!result.ok) {
      toast.error("The agent was not created", { description: result.error });
      throw new Error(result.error);
    }

    clear();
    toast.success(`${draft.name.trim()} is live on paper`, {
      description: draft.activate
        ? "It will take its first tick on schedule. You can also run it now from its page."
        : "It is paused. Activate it from settings when you are ready.",
    });
    router.push(`/agents/${result.data.slug}`);
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-sm font-medium text-muted-foreground">New agent</h1>
        {restored ? (
          <button
            type="button"
            onClick={() => {
              clear();
              setIndex(0);
              setTouched(new Set());
              toast.success("Draft cleared");
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw aria-hidden className="size-3" />
            Start over
          </button>
        ) : null}
      </div>

      <div className="mt-4 overflow-x-auto pb-1">
        <StatusTracker
          stages={STEPS.map((s) => ({ id: s.id, label: s.label }))}
          activeIndex={index}
          progress={blocked ? 0.15 : 0.6}
          className="max-w-none min-w-[34rem]"
        />
      </div>

      <div className="mt-6">
        {step.id === "identity" ? (
          <IdentityStep
            draft={draft}
            update={update}
            updateConfig={updateConfig}
            errors={visibleErrors}
          />
        ) : step.id === "brain" ? (
          <BrainStep
            draft={draft}
            update={update}
            updateConfig={updateConfig}
            errors={visibleErrors}
            llmKeys={keys}
            onKeyAdded={(key) => setKeys((current) => [key, ...current])}
          />
        ) : step.id === "data" ? (
          <DataStep
            draft={draft}
            update={update}
            updateConfig={updateConfig}
            errors={visibleErrors}
            sources={sources}
          />
        ) : step.id === "universe" ? (
          <UniverseStep
            draft={draft}
            update={update}
            updateConfig={updateConfig}
            errors={visibleErrors}
          />
        ) : step.id === "risk" ? (
          <RiskStep
            draft={draft}
            update={update}
            updateConfig={updateConfig}
            errors={visibleErrors}
          />
        ) : step.id === "schedule" ? (
          <ScheduleStep
            draft={draft}
            update={update}
            updateConfig={updateConfig}
            errors={visibleErrors}
          />
        ) : (
          <ReviewStep draft={draft} sources={sources} keys={keys} />
        )}
      </div>

      <div className="mt-8 flex items-center gap-2 border-t border-border/70 pt-4">
        <button
          type="button"
          onClick={goBack}
          disabled={index === 0}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm",
            "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
            "hover:bg-muted active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back
        </button>

        <p className="tnum ml-auto text-xs text-muted-foreground">
          Step {index + 1} of {STEPS.length}
        </p>

        {step.id === "review" ? (
          <MorphButton
            size="lg"
            onAction={submit}
            loadingLabel="Creating…"
            successLabel="Created"
            errorLabel="Check the form"
          >
            Create agent
          </MorphButton>
        ) : (
          <button
            type="button"
            onClick={goNext}
            aria-disabled={blocked}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "hover:bg-primary/90 active:scale-[0.97]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              blocked && "opacity-50",
            )}
          >
            Continue
            <ArrowRight aria-hidden className="size-4" />
          </button>
        )}
      </div>

      {showErrors && stepErrors.length > 0 ? (
        <p role="alert" className="mt-2 text-right text-xs text-destructive">
          {errors[stepErrors[0]]}
        </p>
      ) : null}
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 py-2 last:border-b-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm">{children}</dd>
    </div>
  );
}

function ReviewStep({
  draft,
  sources,
  keys,
}: {
  draft: ReturnType<typeof useDraft>["draft"];
  sources: DataSourceInfo[];
  keys: LlmKeyRow[];
}) {
  const key = keys.find((entry) => entry.id === draft.llmKeyId);
  const chosen = sources.filter((source) => draft.config.dataSources.includes(source.id));
  const costPerRun = chosen.reduce((sum, source) => sum + (source.priceUsd ?? 0.01), 0);
  const runsPerDay =
    draft.config.schedule.intervalMinutes === 0
      ? 0
      : Math.round(1_440 / draft.config.schedule.intervalMinutes);

  return (
    <div className="space-y-5">
      <StepHeading
        title="Read it back"
        blurb="This is exactly what it will do the first time it wakes up."
      />

      <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/40 p-4">
        <AgentAvatar seed={draft.avatarSeed} name={draft.name || "Agent"} size="lg" />
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span className="truncate font-semibold tracking-tight">
              {draft.name || "Untitled agent"}
            </span>
            <ModeBadge mode="paper" size="xs" />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {draft.tagline || "No tagline"}
          </p>
        </div>
      </div>

      <dl className="rounded-xl border border-border/70 bg-card/30 px-3">
        <SummaryRow label="Model">
          <span className="font-mono text-xs">{draft.config.llm.model}</span>
        </SummaryRow>
        <SummaryRow label="Key">
          {key ? `${key.label ?? key.provider} ••••${key.last4}` : "—"}
        </SummaryRow>
        <SummaryRow label="Chains">
          <span className="inline-flex gap-1.5">
            {draft.config.chains.map((chain) => (
              <ChainBadge key={chain} chain={chain} />
            ))}
          </span>
        </SummaryRow>
        <SummaryRow label="Bar">
          <span className="inline-flex items-center gap-1.5">
            <ScoreBadge total={draft.config.universe.minScore} size="xs" />
            <span className="tnum text-xs text-muted-foreground">
              {formatUsd(draft.config.universe.minLiquidityUsd, { compact: true })} liq ·{" "}
              {draft.config.universe.minHolderCount} holders
            </span>
          </span>
        </SummaryRow>
        <SummaryRow label="Blocklist">
          {draft.config.universe.blocklist.length === 0
            ? "Empty"
            : draft.config.universe.blocklist.map((entry) => entry.symbol).join(", ")}
        </SummaryRow>
        <SummaryRow label="Data sources">
          {chosen.length === 0 ? "None" : chosen.map((source) => source.name).join(", ")}
        </SummaryRow>
        <SummaryRow label="Schedule">
          {intervalLabel(draft.config.schedule.intervalMinutes)}
        </SummaryRow>
        <SummaryRow label="Paper balance">
          <span className="tnum">{formatUsd(draft.paperStartingUsd)}</span>
        </SummaryRow>
        <SummaryRow label="Risk">
          <span className="tnum">
            {formatUsd(draft.config.risk.maxTradeUsd)} / trade ·{" "}
            {draft.config.risk.maxDailyTrades} / day · {draft.config.risk.maxPositionPct}% max
            position
          </span>
        </SummaryRow>
        <SummaryRow label="Visibility">
          {draft.isPublic ? "Public record, private strategy" : "Private"}
        </SummaryRow>
      </dl>

      <div className="rounded-xl border border-border/70 bg-card/30 p-3">
        <p className="text-sm font-medium">What this will cost</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {runsPerDay === 0 ? (
            <>
              Manual runs only, so nothing is spent until you press Run now. Each run pays up to{" "}
              <span className="tnum font-mono">{formatUsd(costPerRun)}</span> for data, on top of
              your own LLM tokens.
            </>
          ) : (
            <>
              About <span className="tnum font-mono">{runsPerDay}</span> runs a day at up to{" "}
              <span className="tnum font-mono">{formatUsd(costPerRun)}</span> of data each — roughly{" "}
              <span className="tnum font-mono">{formatUsd(costPerRun * runsPerDay)}</span> a day in
              x402 payments, plus your own LLM tokens. The hard cap per run is{" "}
              <span className="tnum font-mono">
                {formatUsd(draft.config.risk.maxDataSpendUsdPerRun)}
              </span>
              .
            </>
          )}
        </p>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/30 p-3">
        <p className="text-sm font-medium">Where it will hunt</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {universeSentence(draft.config.universe as AgentConfig["universe"], draft.config.chains)}
        </p>
      </div>

      <details className="rounded-xl border border-border/70 bg-card/30 p-3">
        <summary className="cursor-pointer text-sm font-medium">Strategy prompt</summary>
        <p className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
          {draft.config.strategyPrompt}
        </p>
      </details>
    </div>
  );
}
