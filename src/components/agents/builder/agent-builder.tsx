"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { agentConfigSchema } from "@/lib/agent/config";
import { LiquidMetal } from "@/components/common/liquid-metal";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { formatUsd } from "@/components/common/format";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { createAgentAction } from "@/components/agents/agent-actions";
import { BrainStep, DataStep, IdentityStep, RiskStep, ScheduleStep, UniverseStep } from "./steps";
import { universeSentence } from "./universe-controls";
import { useDraft } from "./use-draft";
import { cn } from "@/lib/utils";
import type { AgentConfig } from "@/db/schema";
import type { DataSourceInfo, LlmKeyRow } from "@/server/types";

/**
 * One page, not seven gates. Only three things are truly required — a name, a
 * key, a strategy — so those sit inline, and every rule domain (universe, data,
 * risk, schedule) is a summary card whose defaults you can read in a sentence
 * and open only if you want to tune them. Simplicity here is disclosure, not
 * removal: every control of the old wizard is still one tap away.
 */

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

type RuleId = "universe" | "data" | "risk" | "schedule";

const RULE_ERROR_KEYS: Record<RuleId, string[]> = {
  universe: ["chains", "universe"],
  data: ["dataSources"],
  risk: ["risk"],
  schedule: ["schedule"],
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
      {children}
    </p>
  );
}

/**
 * A rule domain: closed, it is one readable sentence; open, it is the full
 * control surface. The grid-rows transition keeps the reveal smooth without
 * measuring heights.
 */
function RuleCard({
  title,
  summary,
  open,
  onToggle,
  hasError,
  children,
}: {
  title: string;
  summary: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  hasError: boolean;
  children: React.ReactNode;
}) {
  const panelId = `rule-panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section
      className={cn(
        "rounded-xl border bg-card/30 transition-colors duration-150",
        hasError ? "border-destructive/60" : "border-border/70",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {title}
            {hasError ? (
              <TriangleAlert aria-label="has an error" className="size-3.5 shrink-0 text-destructive" />
            ) : null}
          </span>
          <span className={cn("mt-0.5 block truncate text-xs text-muted-foreground", open && "sr-only")}>
            {summary}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
            open && "rotate-180",
          )}
        />
      </button>
      <div
        id={panelId}
        role="region"
        aria-label={title}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border/50 px-4 pt-4 pb-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

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
  const [attempted, setAttempted] = useState(false);
  const [open, setOpen] = useState<Set<RuleId>>(new Set());
  const rulesRef = useRef<HTMLDivElement>(null);

  const errors = useMemo(() => validate(draft), [draft]);
  const visibleErrors = attempted ? errors : {};

  const toggle = (id: RuleId) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chosen = sources.filter((source) => draft.config.dataSources.includes(source.id));
  const costPerRun = chosen.reduce((sum, source) => sum + (source.priceUsd ?? 0.01), 0);
  const interval = draft.config.schedule.intervalMinutes;
  const runsPerDay = interval === 0 ? 0 : Math.round(1_440 / interval);
  const risk = draft.config.risk;

  const submit = async () => {
    const allErrors = validate(draft);
    if (Object.keys(allErrors).length > 0) {
      setAttempted(true);
      const badRules = (Object.keys(RULE_ERROR_KEYS) as RuleId[]).filter((id) =>
        RULE_ERROR_KEYS[id].some((key) => allErrors[key]),
      );
      if (badRules.length > 0) {
        setOpen((current) => new Set([...current, ...badRules]));
        rulesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
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
        <h1 className="text-lg font-semibold tracking-tight">New agent</h1>
        {restored ? (
          <button
            type="button"
            onClick={() => {
              clear();
              setOpen(new Set());
              setAttempted(false);
              toast.success("Draft cleared");
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw aria-hidden className="size-3" />
            Start over
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Three things are required: a name, a key, a strategy. Everything else ships with
        defaults you can read below — and open if you disagree.
      </p>

      <div className="mt-8 space-y-8">
        <section className="space-y-5">
          <SectionLabel>Identity</SectionLabel>
          <IdentityStep draft={draft} update={update} updateConfig={updateConfig} errors={visibleErrors} hideHeading />
        </section>

        <section className="space-y-5">
          <SectionLabel>Brain</SectionLabel>
          <BrainStep
            draft={draft}
            update={update}
            updateConfig={updateConfig}
            errors={visibleErrors}
            llmKeys={keys}
            onKeyAdded={(key) => setKeys((current) => [key, ...current])}
            hideHeading
          />
        </section>

        <section ref={rulesRef} className="scroll-mt-20 space-y-3">
          <SectionLabel>Trading rules</SectionLabel>

          <RuleCard
            title="Where it hunts"
            summary={universeSentence(draft.config.universe as AgentConfig["universe"], draft.config.chains)}
            open={open.has("universe")}
            onToggle={() => toggle("universe")}
            hasError={attempted && RULE_ERROR_KEYS.universe.some((key) => errors[key])}
          >
            <UniverseStep draft={draft} update={update} updateConfig={updateConfig} errors={visibleErrors} hideHeading />
          </RuleCard>

          <RuleCard
            title="Data it buys"
            summary={
              chosen.length === 0
                ? "Free feeds only — it pays for nothing."
                : `${chosen.length} paid source${chosen.length === 1 ? "" : "s"} · up to ${formatUsd(costPerRun)} per run, from its own wallet`
            }
            open={open.has("data")}
            onToggle={() => toggle("data")}
            hasError={attempted && RULE_ERROR_KEYS.data.some((key) => errors[key])}
          >
            <DataStep draft={draft} update={update} updateConfig={updateConfig} errors={visibleErrors} sources={sources} hideHeading />
          </RuleCard>

          <RuleCard
            title="Risk limits"
            summary={`${formatUsd(risk.maxTradeUsd)} per trade · ${risk.maxDailyTrades} trades/day · ${risk.maxPositionPct}% max position · ${formatUsd(risk.maxDataSpendUsdPerRun)} data/run`}
            open={open.has("risk")}
            onToggle={() => toggle("risk")}
            hasError={attempted && RULE_ERROR_KEYS.risk.some((key) => errors[key])}
          >
            <RiskStep draft={draft} update={update} updateConfig={updateConfig} errors={visibleErrors} hideHeading />
          </RuleCard>

          <RuleCard
            title="Schedule & mode"
            summary={`${intervalLabel(interval)} · ${formatUsd(draft.paperStartingUsd)} paper balance · ${draft.activate ? "starts active" : "starts paused"}`}
            open={open.has("schedule")}
            onToggle={() => toggle("schedule")}
            hasError={attempted && RULE_ERROR_KEYS.schedule.some((key) => errors[key])}
          >
            <ScheduleStep draft={draft} update={update} updateConfig={updateConfig} errors={visibleErrors} hideHeading />
          </RuleCard>
        </section>
      </div>

      {/* The commit bar: what it costs, then the one button. Sticky glass so the
          decision is always in reach, above the mobile tab bar on phones. */}
      <div className="glass-bar sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 mt-8 -mx-4 flex items-center gap-3 border-t border-border/60 px-4 py-3 sm:-mx-6 sm:px-6 md:bottom-0">
        <p className="min-w-0 flex-1 text-xs leading-4 text-muted-foreground">
          {runsPerDay === 0 ? (
            <>Manual runs only — nothing is spent until you press Run now.</>
          ) : (
            <>
              ~<span className="tnum font-mono">{runsPerDay}</span> runs/day · up to{" "}
              <span className="tnum font-mono">{formatUsd(costPerRun)}</span> data each, capped at{" "}
              <span className="tnum font-mono">{formatUsd(risk.maxDataSpendUsdPerRun)}</span>/run —
              paper trades until you go live.
            </>
          )}
        </p>
        <LiquidMetal preset="chromatic" theme="dark" strength={0.85} className="shrink-0">
          <MorphButton
            size="lg"
            onAction={submit}
            loadingLabel="Creating…"
            successLabel="Created"
            errorLabel="Check the form"
          >
            Create agent
          </MorphButton>
        </LiquidMetal>
      </div>
    </div>
  );
}
