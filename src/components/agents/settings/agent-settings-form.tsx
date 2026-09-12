"use client";

import { useState } from "react";
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
import { INTERVAL_PRESETS } from "@/components/agents/builder/types";
import { EmptyState } from "@/components/common/empty-state";
import { setAgentStatusAction, updateAgentAction } from "@/components/agents/agent-actions";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { cn } from "@/lib/utils";
import type { AgentConfig } from "@/db/schema";
import type { AgentDetail } from "@/server/types";

/**
 * `AgentDetail.config` is null for anyone who is not the owner, so the form
 * cannot be built at all without one. The settings route is owner-gated, but
 * the type is the real contract — refuse rather than fabricate a config.
 */
export function AgentSettingsForm({ agent, config }: { agent: AgentDetail; config?: AgentConfig | null }) {
  const resolved = config ?? agent.config;
  if (!resolved) {
    return (
      <EmptyState
        title="This agent's settings are not yours to see"
        description="A strategy belongs to whoever wrote it. Its record is public; its recipe is not."
      />
    );
  }
  return <SettingsForm agent={agent} initialConfig={resolved} />;
}

function SettingsForm({
  agent,
  initialConfig,
}: {
  agent: AgentDetail;
  initialConfig: AgentConfig;
}) {
  const router = useRouter();
  const [name, setName] = useState(agent.name);
  const [tagline, setTagline] = useState(agent.tagline ?? "");
  const [isPublic, setIsPublic] = useState(agent.isPublic);
  const [config, setConfig] = useState<AgentConfig>(initialConfig);

  const dirty =
    name !== agent.name ||
    tagline !== (agent.tagline ?? "") ||
    isPublic !== agent.isPublic ||
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
      config,
    });
    if (!result.ok) {
      toast.error("Not saved", { description: result.error });
      throw new Error(result.error);
    }
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

      <section className="space-y-3 rounded-xl border border-border/70 bg-card/30 p-4">
        <h2 className="text-sm font-medium">Risk</h2>
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
        </div>
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
