"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { MORPH_FOCUS } from "@/components/common/focus";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/common/status-badge";
import { formatUsd } from "@/components/common/format";
import { Field, RiskSlider, Toggle } from "@/components/agents/builder/field";
import { parseBps } from "@/components/agents/builder/parse-value";
import { slippageMeaning } from "@/components/agents/builder/slippage-copy";
import { UniverseControls } from "@/components/agents/builder/universe-controls";
import { UniversePreview } from "@/components/agents/settings/universe-preview";
import { sameConfig } from "@/components/agents/settings/same-config";
import { AddKeyInline, PROVIDER_LABELS } from "@/components/agents/builder/steps";
import { SimpleSelect } from "@/components/agents/builder/simple-select";
import { DEFAULT_MODELS, agentConfigSchema } from "@/lib/agent/config";
import { DataSourcePicker } from "@/components/agents/data-source-picker";
import { ExecutionControls } from "@/components/agents/proposals/execution-controls";
import { ExitRulesFields } from "@/components/agents/exit-rules";
import {
  INTERVAL_PRESETS,
  LLM_BOUNDS,
  MAX_AGENT_NAME,
  MAX_TRADE_LADDER,
  RISK_BOUNDS,
} from "@/components/agents/builder/types";
import { EmptyState } from "@/components/common/empty-state";
import { setAgentStatusAction, updateAgentAction } from "@/components/agents/agent-actions";
import { SizingControls } from "@/components/trading";
import { readSizing } from "@/lib/trading/sizing";
import { noteBudgetChangeAction } from "@/server/actions/security";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { safeAction } from "@/lib/safe-action";
import { cn } from "@/lib/utils";
import type { AgentConfig, AgentRiskWithSizing } from "@/db/schema";
import type { AgentDetail, DataSourceInfo, LlmKeyRow } from "@/server/types";
import { stickyActionbarRef } from "@/hooks/root-flag";

/** The four numbers that decide how much money can move. */
function capsOf(config: AgentConfig) {
  return {
    maxTradeUsd: config.risk.maxTradeUsd,
    maxDailyTrades: config.risk.maxDailyTrades,
    maxPositionPct: config.risk.maxPositionPct,
    maxDataSpendUsdPerRun: config.risk.maxDataSpendUsdPerRun,
  };
}

/**
 * `AgentDetail.config` is null for anyone who is not the owner, so the form
 * cannot be built at all without one. The settings route is owner-gated, but
 * the type is the real contract — refuse rather than fabricate a config.
 */
export function AgentSettingsForm({
  agent,
  config,
  sources = [],
  llmKeys = [],
  accountPaused = false,
  isAdmin = false,
}: {
  agent: AgentDetail;
  config?: AgentConfig | null;
  /** The x402 catalogue, for the Data section. Server-fetched by the page. */
  sources?: DataSourceInfo[];
  /** The owner's API keys, for the Brain section. Server-fetched by the page. */
  llmKeys?: LlmKeyRow[];
  /** Trading is paused account-wide (Security → Pause all trading). */
  accountPaused?: boolean;
  /** Shows operator-only notes, such as which platform wallet pays for a source. */
  isAdmin?: boolean;
}) {
  const resolved = config ?? agent.config;
  if (!resolved) {
    return (
      <EmptyState
        title="This agent's settings are not yours to see"
        description="A strategy belongs to whoever wrote it. Its record is public; its recipe is not."
      />
    );
  }
  return (
    <SettingsForm
      agent={agent}
      initialConfig={resolved}
      sources={sources}
      llmKeys={llmKeys}
      accountPaused={accountPaused}
      isAdmin={isAdmin}
    />
  );
}

function SettingsForm({
  agent,
  initialConfig,
  sources,
  llmKeys,
  accountPaused,
  isAdmin,
}: {
  agent: AgentDetail;
  initialConfig: AgentConfig;
  sources: DataSourceInfo[];
  llmKeys: LlmKeyRow[];
  accountPaused: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(agent.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [strategyError, setStrategyError] = useState<string | null>(null);
  const [tagline, setTagline] = useState(agent.tagline ?? "");
  const [isPublic, setIsPublic] = useState(agent.isPublic);
  const [config, setConfig] = useState<AgentConfig>(initialConfig);
  const [llmKeyId, setLlmKeyId] = useState<string | null>(agent.llmKeyId);
  const [keys, setKeys] = useState<LlmKeyRow[]>(llmKeys);
  const keysForProvider = keys.filter((key) => key.provider === config.llm.provider);

  const dirty =
    name !== agent.name ||
    tagline !== (agent.tagline ?? "") ||
    isPublic !== agent.isPublic ||
    llmKeyId !== agent.llmKeyId ||
    !sameConfig(config, initialConfig);

  // Unsaved edits live only in this component, so leaving drops them. Ask first: on
  // reload or close, and on in-app links — the money strip's Go live, the back link,
  // the tab bar — which navigate client-side and never fire `beforeunload`. Going live
  // on the old caps because a Save was missed is the case this exists for.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      // A modified click opens another tab; nothing here is lost.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      // Another origin unloads the page, so `beforeunload` asks; a #card jump stays here.
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm("You have unsaved changes to this agent. Leave without saving them?")) {
        // Capture phase, so this runs before Next's <Link>, which skips a prevented click.
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const save = async () => {
    const trimmed = name.trim();
    const problem =
      trimmed.length < 2
        ? "Give it a name — at least two characters."
        : trimmed.length > MAX_AGENT_NAME
          ? `Keep the name to ${MAX_AGENT_NAME} characters or fewer.`
          : null;
    if (problem) {
      // At the field, not in a toast: Save sits at the bottom of a long page, and a toast
      // that vanished in four seconds left the operator hunting for what it meant.
      setNameError(problem);
      requestAnimationFrame(() => {
        const input = document.getElementById("settings-name");
        input?.scrollIntoView({ behavior: "smooth", block: "center" });
        input?.focus({ preventScroll: true });
      });
      throw new Error("invalid");
    }
    // The same schema the server applies, checked here so an empty or oversized prompt is
    // marked at the box — scrolled out of view above Save — rather than only in a toast.
    const strategy = agentConfigSchema.shape.strategyPrompt.safeParse(config.strategyPrompt);
    if (!strategy.success) {
      setStrategyError(strategy.error.issues[0]?.message ?? "Describe the strategy in at least a sentence.");
      requestAnimationFrame(() => {
        const input = document.getElementById("settings-strategy");
        input?.scrollIntoView({ behavior: "smooth", block: "center" });
        input?.focus({ preventScroll: true });
      });
      throw new Error("invalid");
    }
    const result = await updateAgentAction(agent.id, {
      name: name.trim(),
      tagline: tagline.trim() || undefined,
      isPublic,
      llmKeyId,
      config,
    });
    if (!result.ok) {
      toast.error("Not saved", { description: result.error });
      throw new Error(result.error);
    }
    // A change to the caps is a change to how much money can move, so it goes on
    // the audit record. Fire-and-forget: the save already succeeded, and a failed
    // audit write must not turn a saved change into an error the operator retries.
    void noteBudgetChangeAction({
      agentId: agent.id,
      before: capsOf(initialConfig),
      after: capsOf(config),
    });
    toast.success("Saved");
    router.refresh();
  };

  const toggleStatus = async () => {
    const next = agent.status === "active" ? "paused" : "active";
    const result = await safeAction(() => setAgentStatusAction(agent.id, next));
    if (!result.ok) {
      toast.error("Status not changed", { description: result.error });
      return;
    }
    toast.success(next === "active" ? "Resumed" : "Paused", {
      description:
        next === "active"
          ? `It will tick ${intervalLabel(config.schedule.intervalMinutes).toLowerCase()}.`
          : "It will not run again until you resume it.",
    });
    router.refresh();
  };

  const patchRisk = (patch: Partial<AgentRiskWithSizing>) =>
    setConfig((current) => ({ ...current, risk: { ...current.risk, ...patch } }));

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border/70 bg-card/30 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">Status</h2>
          <StatusBadge status={agent.status} accountPaused={accountPaused} />
          <button
            type="button"
            onClick={() => void toggleStatus()}
            disabled={agent.status === "draft"}
            className={cn(
              "ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "hover:bg-muted active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            {agent.status === "active" ? (
              <>
                <Pause aria-hidden className="size-3.5" />
                Pause
              </>
            ) : (
              <>
                <Play aria-hidden className="size-3.5" />
                Resume
              </>
            )}
          </button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {agent.status === "active" ? (
            accountPaused ? (
              <>
                Paused account-wide.{" "}
                <Link
                  href="/settings/security#kill-switch"
                  className="rounded underline underline-offset-2 hover:text-foreground focus-ring"
                >
                  Resume trading
                </Link>{" "}
                in Security to let it run again.
              </>
            ) : agent.llmKeyId === null ? (
              // The saved key, not the draft: this is what the next tick will run with. A
              // green Active over "Next tick is scheduled" read as healthy while every run
              // failed, and the only warning sat 1,000px down in Brain.
              <span className="text-destructive">
                Active, but every tick fails before it starts: no API key attached.{" "}
                <a href="#brain" className="rounded underline underline-offset-2 hover:text-foreground focus-ring">
                  Choose a key
                </a>
              </span>
            ) : (
              `Running ${intervalLabel(config.schedule.intervalMinutes).toLowerCase()}. Next tick ${
                agent.nextRunAt ? "is scheduled" : "unscheduled"
              }.`
            )
          ) : (
            "Paused agents keep their positions and history; they just stop waking up."
          )}
        </p>
      </section>

      <section className="space-y-4 rounded-xl border border-border/70 bg-card/30 p-4">
        <h2 className="text-sm font-medium">Identity</h2>

        <Field label="Name" htmlFor="settings-name" error={nameError}>
          <Input
            id="settings-name"
            value={name}
            maxLength={MAX_AGENT_NAME}
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? "settings-name-error" : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(null);
            }}
          />
        </Field>

        <Field label="Tagline" htmlFor="settings-tagline">
          <Input
            id="settings-tagline"
            value={tagline}
            maxLength={120}
            onChange={(event) => setTagline(event.target.value)}
          />
        </Field>

        <Toggle
          id="settings-public"
          label="Public"
          description="Its trades, PnL and run summaries are visible to everyone. This strategy, its universe rules and its transcripts stay yours either way."
          checked={isPublic}
          onChange={setIsPublic}
        />
      </section>

      <section id="strategy" className="scroll-mt-20 space-y-4 rounded-xl border border-border/70 bg-card/30 p-4">
        <h2 className="text-sm font-medium">Strategy</h2>
        <div className="space-y-1.5">
          <Textarea
            id="settings-strategy"
            value={config.strategyPrompt}
            rows={8}
            aria-invalid={Boolean(strategyError)}
            aria-describedby={strategyError ? "settings-strategy-error" : undefined}
            onChange={(event) => {
              const strategyPrompt = event.target.value;
              setConfig((current) => ({ ...current, strategyPrompt }));
              setStrategyError(null);
            }}
            // A focused text field only scrolls its caret into view, so a tall prompt whose
            // first line was visible stayed half under the Save bar. "nearest" honours the
            // bar's scroll padding and does nothing when the box is already clear.
            onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest" })}
            className="font-mono leading-relaxed"
            aria-label="Strategy prompt"
          />
          {/* The heading above already names the box, so the error and the builder's
              counter sit under it without a second "Strategy" label. */}
          <div className="flex items-start gap-3">
            {strategyError ? (
              <p id="settings-strategy-error" role="alert" className="text-xs text-destructive">
                {strategyError}
              </p>
            ) : null}
            <p
              className={cn(
                "tnum ml-auto shrink-0 text-right text-[11px] text-muted-foreground",
                config.strategyPrompt.length > 8000 && "text-destructive",
              )}
            >
              {config.strategyPrompt.length} / 8000
            </p>
          </div>
        </div>
      </section>

      <section id="brain" className="scroll-mt-20 space-y-4 rounded-xl border border-border/70 bg-card/30 p-4">
        <div>
          <h2 className="text-sm font-medium">Brain</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            The key it thinks with and the model it runs. Changing the key here is how a run that failed on its
            key gets a working one — adding a key under Settings does not switch an existing agent by itself.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="settings-llm-provider" className="mb-1 block text-xs text-muted-foreground">
              Provider
            </label>
            <SimpleSelect
              id="settings-llm-provider"
              value={config.llm.provider}
              options={[
                { value: "anthropic", label: "Anthropic" },
                { value: "openai", label: "OpenAI" },
                { value: "openrouter", label: "OpenRouter" },
              ]}
              onChange={(next) => {
                const provider = next as AgentConfig["llm"]["provider"];
                setConfig((current) => ({
                  ...current,
                  llm: { ...current.llm, provider, model: DEFAULT_MODELS[provider][0].id },
                }));
                setLlmKeyId(null);
              }}
            />
          </div>
          <div>
            <label htmlFor="settings-llm-model" className="mb-1 block text-xs text-muted-foreground">
              Model
            </label>
            <SimpleSelect
              id="settings-llm-model"
              value={config.llm.model}
              options={DEFAULT_MODELS[config.llm.provider].map((model) => ({ value: model.id, label: model.label }))}
              onChange={(model) => setConfig((current) => ({ ...current, llm: { ...current.llm, model } }))}
            />
          </div>
        </div>
        <RiskSlider
          id="settings-llm-steps"
          label="Steps per run"
          value={config.llm.maxSteps}
          {...LLM_BOUNDS.maxSteps}
          format={(value) => String(Math.round(value))}
          meaning={`Up to ${Math.round(config.llm.maxSteps)} tool calls a run. A shortlist of three proposals needs about 12; deeper research needs more, and every step costs model tokens.`}
          onChange={(maxSteps) =>
            setConfig((current) => ({ ...current, llm: { ...current.llm, maxSteps: Math.round(maxSteps) } }))
          }
        />
        <div className="space-y-2">
          {/* A real label when there is a select to name; with no key yet, the add button
              names itself and a label would rename it "API key". */}
          {keysForProvider.length > 0 ? (
            <label htmlFor="settings-llm-key" className="block text-xs text-muted-foreground">
              API key
            </label>
          ) : (
            <span className="block text-xs text-muted-foreground">API key</span>
          )}
          {keysForProvider.length > 0 ? (
            <SimpleSelect
              id="settings-llm-key"
              invalid={llmKeyId === null}
              describedBy={llmKeyId === null ? "settings-llm-key-error" : undefined}
              value={llmKeyId}
              placeholder="Choose a key"
              options={keysForProvider.map((key) => ({
                value: key.id,
                label: key.label ?? `${PROVIDER_LABELS[key.provider]} key`,
                hint: `••••${key.last4}`,
              }))}
              onChange={(next) => setLlmKeyId(next)}
            />
          ) : (
            <p className="text-xs text-muted-foreground">No {PROVIDER_LABELS[config.llm.provider]} key on file yet.</p>
          )}
          <AddKeyInline
            provider={config.llm.provider}
            describedBy={keysForProvider.length === 0 && llmKeyId === null ? "settings-llm-key-error" : undefined}
            onAdded={(key) => {
              setKeys((current) => [key, ...current]);
              setLlmKeyId(key.id);
            }}
          />
          {llmKeyId === null ? (
            <p id="settings-llm-key-error" className="text-xs text-destructive">
              No key attached: every run will fail until one is chosen.
            </p>
          ) : null}
        </div>
      </section>

      <section id="universe" className="scroll-mt-20 space-y-4 rounded-xl border border-border/70 bg-card/30 p-4">
        <div>
          <h2 className="text-sm font-medium">Universe</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Where it looks and how high the bar sits. Changes apply from the next tick.
          </p>
        </div>
        <UniverseControls
          idPrefix="settings-universe"
          chains={config.chains}
          universe={config.universe}
          onChains={(chains) => setConfig((current) => ({ ...current, chains }))}
          onUniverse={(patch) =>
            setConfig((current) => ({ ...current, universe: { ...current.universe, ...patch } }))
          }
        />
        {/* Under the sliders, not above them: it is the consequence of what was just
            moved. Debounced and non-blocking — Save never waits on it. */}
        <UniversePreview agentId={agent.id} universe={config.universe} chains={config.chains} />
      </section>

      <section id="data" className="scroll-mt-20 space-y-4 rounded-xl border border-border/70 bg-card/30 p-4">
        <div>
          <h2 className="text-sm font-medium">Data it buys</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Paid over x402 from Tocker&apos;s platform wallet on the chain each source bills on, charged to this
            agent&apos;s data budget. Sources payable on its own chains are listed first.
          </p>
        </div>
        <DataSourcePicker
          sources={sources}
          isAdmin={isAdmin}
          chains={config.chains}
          selected={config.dataSources}
          onChange={(dataSources) => setConfig((current) => ({ ...current, dataSources }))}
        />
      </section>

      <section id="execution" className="scroll-mt-20 space-y-4 rounded-xl border border-border/70 bg-card/30 p-4">
        <div>
          <h2 className="text-sm font-medium">Execution</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            The safe way to go live: let the agent propose and decide yourself. Approval applies
            from the next tick, and a proposal the agent already made keeps the TTL it was created
            with.
          </p>
        </div>
        <ExecutionControls
          idPrefix="settings-execution"
          execution={config.execution}
          onChange={(execution) => setConfig((current) => ({ ...current, execution }))}
        />
      </section>

      <section className="space-y-4 rounded-xl border border-border/70 bg-card/30 p-4">
        <h2 className="text-sm font-medium">Schedule</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {INTERVAL_PRESETS.map((preset) => {
            const active = config.schedule.intervalMinutes === preset.minutes;
            return (
              <button
                key={preset.minutes}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setConfig((current) => ({
                    ...current,
                    schedule: { intervalMinutes: preset.minutes },
                  }))
                }
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-sm",
                  "transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary/50 bg-primary/8"
                    : "border-border/70 hover:border-border hover:bg-muted/40",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* `scroll-mt-20` clears the sticky top bar; without it an anchored jump lands
          with the heading hidden under the chrome, which reads as "the link did
          nothing". Readiness and the live checklist deep-link here. */}
      <section id="risk" className="scroll-mt-20 space-y-3 rounded-xl border border-border/70 bg-card/30 p-4">
        <h2 className="text-sm font-medium">Risk</h2>
        {/*
          There are two layers of cap and they are not the same thing, so say which
          is which: these four are enforced by `riskGuard()` in app code before any
          executor is reached — not asked of the model in a prompt. The Wallet budget
          card below is the layer underneath, a Privy policy the wallet itself
          enforces even if this app is compromised.
        */}
        <p className="text-xs leading-5 text-muted-foreground">
          Enforced by the risk guard before a quote is ever requested. A strategy that decides to buy ten times
          this gets refused, and the refusal is written into the run transcript. Changes take effect from the next
          tick and are recorded in your{" "}
          <Link href="/settings/security" className="text-foreground underline underline-offset-2">
            audit log
          </Link>
          . The wallet budget below is a second, lower layer that holds even if this app does not.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <RiskSlider
            id="settings-max-trade"
            label="Max per trade"
            value={config.risk.maxTradeUsd}
            {...RISK_BOUNDS.maxTradeUsd}
            ladder={MAX_TRADE_LADDER}
            format={(value) => formatUsd(value)}
            meaning={`No single trade may move more than ${formatUsd(config.risk.maxTradeUsd)}.`}
            onChange={(maxTradeUsd) => patchRisk({ maxTradeUsd })}
          />
          <RiskSlider
            id="settings-daily-trades"
            label="Max trades per day"
            value={config.risk.maxDailyTrades}
            min={1}
            max={100}
            format={(value) => String(Math.round(value))}
            meaning={`Up to ${formatUsd(config.risk.maxTradeUsd * config.risk.maxDailyTrades)} of new positions a day; sells and exits never count.`}
            onChange={(maxDailyTrades) => patchRisk({ maxDailyTrades: Math.round(maxDailyTrades) })}
          />
          <RiskSlider
            id="settings-position-pct"
            label="Max position size"
            value={config.risk.maxPositionPct}
            min={1}
            max={100}
            format={(value) => `${Math.round(value)}%`}
            meaning={`One token may hold at most ${Math.round(config.risk.maxPositionPct)}% of equity.`}
            onChange={(maxPositionPct) => patchRisk({ maxPositionPct: Math.round(maxPositionPct) })}
          />
          <RiskSlider
            id="settings-data-spend"
            label="Data spend cap per run"
            value={config.risk.maxDataSpendUsdPerRun}
            min={0}
            max={5}
            step={0.05}
            format={(value) => formatUsd(value)}
            meaning={`Once a run has spent ${formatUsd(config.risk.maxDataSpendUsdPerRun)} of Tocker's data budget, further paid calls are refused.`}
            onChange={(maxDataSpendUsdPerRun) => patchRisk({ maxDataSpendUsdPerRun })}
          />
          <RiskSlider
            id="settings-slippage"
            label="Slippage tolerance"
            value={config.risk.slippageBps}
            min={10}
            max={2_000}
            step={10}
            format={(value) => `${Math.round(value)} bps`}
            parse={parseBps}
            // Not "fills worse than this are rejected": see slippage-copy.ts for the one
            // case where the order goes out looser, and why the sentence is shared.
            meaning={slippageMeaning(config.risk.slippageBps)}
            onChange={(slippageBps) => patchRisk({ slippageBps: Math.round(slippageBps) })}
          />
        </div>

        {/*
          Sizing decides how big a ticket is *within* the cap above; the cap is the
          ceiling it can never cross. It is part of this form and saves with the caps in
          the one Save below, so the ceiling and the ticket size are always applied
          together — a second Save button in the same card saved one without the other,
          and the form's own Save then wrote the old sizing back.
        */}
        <div className="border-t border-border/50 pt-4">
          <SizingControls
            value={readSizing(config.risk)}
            maxTradeUsd={config.risk.maxTradeUsd}
            equityUsd={agent.equityUsd}
            onChange={(sizing) => patchRisk({ sizing })}
          />
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border/70 bg-card/30 p-4">
        <h2 className="text-sm font-medium">Exit rules</h2>
        <p className="text-xs text-muted-foreground">
          Checked every five minutes by the exit engine, independent of the model. Changes apply from the next check.
        </p>
        <ExitRulesFields value={config.risk} onChange={(risk) => setConfig((current) => ({ ...current, risk }))} />
      </section>

      {/* `stickyActionbarRef` holds a flag on <html> that adds this bar to the scroll padding
          in globals.css, so a control that takes focus scrolls clear of this bar instead of
          sitting under it, and lifts the toasts above it on a phone. The phone offset matches
          what that padding reserves: the tab bar, then this bar. */}
      <div
        data-sticky-actionbar
        ref={stickyActionbarRef}
        className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom)+0.5rem)] z-10 flex items-center gap-3 rounded-xl border border-border bg-background/90 px-3 py-2.5 backdrop-blur-md md:bottom-4"
      >
        <p className="text-xs text-muted-foreground">
          {dirty ? "Unsaved changes" : "Everything is saved"}
        </p>
        <div className="ml-auto">
          <MorphButton
            size="sm"
            className={MORPH_FOCUS}
            onAction={save}
            disabled={!dirty}
            loadingLabel="Saving…"
            successLabel="Saved"
            // Most refusals are a field the form already flags inline; a server
            // refusal explains itself in a toast, so this stays true for both.
            errorLabel="Check the form"
          >
            Save changes
          </MorphButton>
        </div>
      </div>
    </div>
  );
}
