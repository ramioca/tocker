"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/common/status-badge";
import { formatUsd } from "@/components/common/format";
import { Field, RiskSlider, Toggle } from "@/components/agents/builder/field";
import { UniverseControls } from "@/components/agents/builder/universe-controls";
import { AddKeyInline } from "@/components/agents/builder/steps";
import { SimpleSelect } from "@/components/agents/builder/simple-select";
import { DEFAULT_MODELS } from "@/lib/agent/config";
import { DataSourcePicker } from "@/components/agents/data-source-picker";
import { ExecutionControls } from "@/components/agents/proposals/execution-controls";
import { ExitRulesFields } from "@/components/agents/exit-rules";
import { INTERVAL_PRESETS } from "@/components/agents/builder/types";
import { EmptyState } from "@/components/common/empty-state";
import { setAgentStatusAction, updateAgentAction } from "@/components/agents/agent-actions";
import { SizingControls } from "@/components/trading";
import { readSizing } from "@/lib/trading/sizing";
import { setPositionSizing } from "@/server/actions/trading";
import { noteBudgetChangeAction } from "@/server/actions/security";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { cn } from "@/lib/utils";
import type { AgentConfig } from "@/db/schema";
import type { AgentDetail, DataSourceInfo, LlmKeyRow } from "@/server/types";

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
}: {
  agent: AgentDetail;
  config?: AgentConfig | null;
  /** The x402 catalogue, for the Data section. Server-fetched by the page. */
  sources?: DataSourceInfo[];
  /** The owner's API keys, for the Brain section. Server-fetched by the page. */
  llmKeys?: LlmKeyRow[];
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
  return <SettingsForm agent={agent} initialConfig={resolved} sources={sources} llmKeys={llmKeys} />;
}

function SettingsForm({
  agent,
  initialConfig,
  sources,
  llmKeys,
}: {
  agent: AgentDetail;
  initialConfig: AgentConfig;
  sources: DataSourceInfo[];
  llmKeys: LlmKeyRow[];
}) {
  const router = useRouter();
  const [name, setName] = useState(agent.name);
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
    JSON.stringify(config) !== JSON.stringify(initialConfig);

  const save = async () => {
    if (name.trim().length < 2) {
      toast.error("The name is too short");
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
    const result = await setAgentStatusAction(agent.id, next);
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

  const patchRisk = (patch: Partial<AgentConfig["risk"]>) =>
    setConfig((current) => ({ ...current, risk: { ...current.risk, ...patch } }));

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border/70 bg-card/30 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">Status</h2>
          <StatusBadge status={agent.status} />
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
          {agent.status === "active"
            ? `Running ${intervalLabel(config.schedule.intervalMinutes).toLowerCase()}. Next tick ${
                agent.nextRunAt ? "is scheduled" : "unscheduled"
              }.`
            : "Paused agents keep their positions and history; they just stop waking up."}
        </p>
      </section>

      <section className="space-y-4 rounded-xl border border-border/70 bg-card/30 p-4">
        <h2 className="text-sm font-medium">Identity</h2>

        <Field label="Name" htmlFor="settings-name">
          <Input id="settings-name" value={name} onChange={(event) => setName(event.target.value)} />
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

      <section className="space-y-4 rounded-xl border border-border/70 bg-card/30 p-4">
        <h2 className="text-sm font-medium">Strategy</h2>
        <Textarea
          value={config.strategyPrompt}
          rows={8}
          onChange={(event) =>
            setConfig((current) => ({ ...current, strategyPrompt: event.target.value }))
          }
          className="font-mono text-xs leading-relaxed"
          aria-label="Strategy prompt"
        />
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
        <div className="space-y-2">
          <span className="block text-xs text-muted-foreground">API key</span>
          {keysForProvider.length > 0 ? (
            <SimpleSelect
              value={llmKeyId}
              placeholder="Choose a key"
              options={keysForProvider.map((key) => ({
                value: key.id,
                label: key.label ?? `${key.provider} key`,
                hint: `••••${key.last4}`,
              }))}
              onChange={(next) => setLlmKeyId(next)}
            />
          ) : (
            <p className="text-xs text-muted-foreground">No {config.llm.provider} key on file yet.</p>
          )}
          <AddKeyInline
            onAdded={(key) => {
              setKeys((current) => [key, ...current]);
              setLlmKeyId(key.id);
            }}
          />
          {llmKeyId === null ? (
            <p className="text-xs text-destructive">No key attached: every run will fail until one is chosen.</p>
          ) : null}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border/70 bg-card/30 p-4">
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
      </section>

      <section id="data" className="scroll-mt-20 space-y-4 rounded-xl border border-border/70 bg-card/30 p-4">
        <div>
          <h2 className="text-sm font-medium">Data it buys</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Paid over x402 from Tocker&apos;s platform wallet on the chain it trades, charged to its data budget. Only
            sources payable on this agent&apos;s chains are offered.
          </p>
        </div>
        <DataSourcePicker
          sources={sources}
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
            min={10}
            max={5_000}
            step={10}
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
            meaning={`Up to ${formatUsd(config.risk.maxTradeUsd * config.risk.maxDailyTrades)} of turnover a day.`}
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
            meaning={`x402 calls are refused past ${formatUsd(config.risk.maxDataSpendUsdPerRun)} in a single run.`}
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
            meaning={`Fills worse than ${(config.risk.slippageBps / 100).toFixed(2)}% off the quote are rejected on chain. Launch-day memecoins usually need 300–500 bps; Jupiter picks tighter when the pool allows.`}
            onChange={(slippageBps) => patchRisk({ slippageBps: Math.round(slippageBps) })}
          />
        </div>

        {/*
          Sizing decides how big a ticket is *within* the cap above; the cap is the
          ceiling it can never cross. It saves through its own action rather than the
          form's Save, so the ceiling and the ticket size can never be half-applied
          against each other.
        */}
        <div className="border-t border-border/50 pt-4">
          <SizingControls
            value={readSizing(config.risk)}
            maxTradeUsd={config.risk.maxTradeUsd}
            equityUsd={agent.equityUsd}
            onSave={async (next) => {
              const result = await setPositionSizing(agent.id, next);
              if (!result.ok) return result.error;
              router.refresh();
              return null;
            }}
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

      <div className="sticky bottom-20 z-10 flex items-center gap-3 rounded-xl border border-border bg-background/90 px-3 py-2.5 backdrop-blur-md md:bottom-4">
        <p className="text-xs text-muted-foreground">
          {dirty ? "Unsaved changes" : "Everything is saved"}
        </p>
        <div className="ml-auto">
          <MorphButton
            size="sm"
            onAction={save}
            disabled={!dirty}
            loadingLabel="Saving…"
            successLabel="Saved"
            errorLabel="Failed"
          >
            Save changes
          </MorphButton>
        </div>
      </div>
    </div>
  );
}
