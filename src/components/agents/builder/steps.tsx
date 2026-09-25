"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, KeyRound, Plus, Shuffle, X } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_MODELS } from "@/lib/agent/config";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { ChainBadge } from "@/components/common/chain-badge";
import { ModeBadge } from "@/components/common/mode-badge";
import { FeesCovered } from "@/components/common/fees-covered";
import { formatUsd } from "@/components/common/format";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { addLlmKeyAction } from "@/components/agents/agent-actions";
import { ExecutionControls } from "@/components/agents/proposals/execution-controls";
import { DataSourcePicker } from "@/components/agents/data-source-picker";
import { ExitRulesFields } from "@/components/agents/exit-rules";
import { CashTotal } from "@/components/wallets/cash-summary";
import { DepositSheet } from "@/components/wallets/deposit-sheet";
import { useFundingPlan } from "@/components/wallets/use-funding-plan";
import {
  FUND_PRESETS,
  MIN_FUND_USD,
  cashOn,
  chainLabelFor,
  depositTargets,
  round,
  transferLabel,
  transfersFor,
} from "@/lib/wallets/funding";
import { Field, RiskSlider, StepHeading, Toggle } from "./field";
import { UniverseControls } from "./universe-controls";
import { SimpleSelect } from "./simple-select";
import {
  AVATAR_SEEDS,
  INTERVAL_PRESETS,
  LLM_BOUNDS,
  MAX_AGENT_NAME,
  PAPER_BALANCES,
  RISK_BOUNDS,
  STRATEGY_PRESETS,
  type BuilderDraft,
  type StrategyPreset,
} from "./types";
import { cn } from "@/lib/utils";
import type { Chain, DataSourceInfo, LlmKeyRow } from "@/server/types";

export interface StepProps {
  draft: BuilderDraft;
  update: (patch: Partial<BuilderDraft>) => void;
  updateConfig: (patch: Partial<BuilderDraft["config"]>) => void;
  errors: Record<string, string>;
  /** The one-page builder renders its own section headers; steps drop theirs. */
  hideHeading?: boolean;
}

// ------------------------------------------------------------------ identity

export function IdentityStep({ draft, update, errors, hideHeading }: StepProps) {
  return (
    <div className="space-y-5">
      {hideHeading ? null : (
        <StepHeading
        title="Give it a name"
        blurb="This is what shows up in the feed above every trade it makes, so make it something you would follow."
        />
      )}

      <Field label="Name" htmlFor="agent-name" error={errors.name}>
        <Input
          id="agent-name"
          value={draft.name}
          maxLength={MAX_AGENT_NAME}
          placeholder="Momentum Mike"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? "agent-name-error" : undefined}
          onChange={(event) => update({ name: event.target.value })}
        />
      </Field>

      <Field
        label="Tagline"
        htmlFor="agent-tagline"
        hint="One line. What is its edge, in the words you would use to a friend?"
      >
        <Input
          id="agent-tagline"
          value={draft.tagline}
          maxLength={120}
          placeholder="Buys narrative velocity, sells the flip."
          onChange={(event) => update({ tagline: event.target.value })}
        />
      </Field>

      <Field label="Avatar" hint="Deterministic from the seed — no upload, no broken image.">
        <div className="flex flex-wrap items-center gap-2">
          {AVATAR_SEEDS.map((seed) => {
            const active = draft.avatarSeed === seed;
            return (
              <button
                key={seed}
                type="button"
                aria-label={`Avatar ${seed}`}
                aria-pressed={active}
                onClick={() => update({ avatarSeed: seed })}
                className={cn(
                  "rounded-xl p-0.5 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.94]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "ring-2 ring-primary" : "ring-1 ring-transparent hover:ring-border",
                )}
              >
                <AgentAvatar seed={seed} name={draft.name || seed} size="lg" />
              </button>
            );
          })}
          <button
            type="button"
            onClick={() =>
              update({ avatarSeed: `${draft.avatarSeed}-${Math.random().toString(36).slice(2, 6)}` })
            }
            className="grid size-12 place-items-center rounded-xl border border-dashed border-border text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Randomise avatar"
          >
            <Shuffle aria-hidden className="size-4" />
          </button>
        </div>
      </Field>

      <Toggle
        id="agent-public"
        label="Public"
        description="Anyone can see its trades, its PnL and the one-line reason behind each one. Your strategy, your universe rules, your key and your wallets stay yours — there is no way for anyone to copy this agent."
        checked={draft.isPublic}
        onChange={(isPublic) => update({ isPublic })}
      />
    </div>
  );
}

// --------------------------------------------------------------------- brain

const PROVIDER_LABELS: Record<LlmKeyRow["provider"], string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

/**
 * Adds a key for the provider the agent already thinks with. There is deliberately no
 * provider picker in here: a second one, independent of the Brain's, let an Anthropic
 * key be attached to an OpenAI agent, where the key select could not even show it and
 * every run failed. Switch the Brain's provider to add a key for another one.
 */
export function AddKeyInline({
  provider,
  onAdded,
  id,
  describedBy,
}: {
  provider: LlmKeyRow["provider"];
  onAdded: (key: LlmKeyRow) => void;
  /** Set on whichever control is the next thing to press — the trigger, or the key box once open. */
  id?: string;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        id={id}
        type="button"
        aria-describedby={describedBy}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus aria-hidden className="size-3.5" />
        Add an {PROVIDER_LABELS[provider]} key
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card/40 p-3">
      <div className="flex items-center gap-2">
        <KeyRound aria-hidden className="size-3.5 text-muted-foreground" />
        <p className="text-xs font-medium">New {PROVIDER_LABELS[provider]} key</p>
        <button
          type="button"
          onClick={() => {
            // Cancel means gone: the secret must not sit in state and reappear on reopen.
            setValue("");
            setOpen(false);
          }}
          aria-label="Cancel"
          className="ml-auto rounded p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>

      <Input
        id={id}
        type="password"
        aria-label={`${PROVIDER_LABELS[provider]} API key`}
        aria-describedby={describedBy}
        // Mounted only by pressing "Add", which unmounts that button: without this,
        // focus would fall back to the page.
        autoFocus
        value={value}
        placeholder="sk-…"
        // "new-password" is the value Chrome actually honours on a password field;
        // "off" still offers to save the key into the password manager.
        autoComplete="new-password"
        spellCheck={false}
        maxLength={512}
        onChange={(event) => setValue(event.target.value)}
      />
      <Input
        value={label}
        placeholder="Label (optional)"
        maxLength={40}
        onChange={(event) => setLabel(event.target.value)}
      />
      {provider === "anthropic" ? (
        <Input
          value={workspaceId}
          placeholder="Workspace ID (optional — detected automatically)"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setWorkspaceId(event.target.value)}
          className="font-mono"
        />
      ) : null}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Encrypted at rest and decrypted only inside the run loop. It never reaches the browser again.
        {provider === "anthropic"
          ? " Organization-level Anthropic keys get their workspace detected automatically."
          : ""}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await addLlmKeyAction({
              provider,
              key: value,
              label: label || undefined,
              workspaceId: provider === "anthropic" && workspaceId.trim() ? workspaceId.trim() : undefined,
            });
            if (!result.ok) {
              toast.error("Key not saved", { description: result.error });
              return;
            }
            onAdded({
              id: result.data.id,
              provider,
              label: label || null,
              last4: result.data.last4,
              createdAt: new Date().toISOString(),
            });
            setOpen(false);
            setValue("");
            setLabel("");
            toast.success("Key saved");
          })
        }
        className="w-full rounded-lg bg-primary py-1.5 text-xs font-medium text-primary-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {pending ? "Saving…" : "Save key"}
      </button>
    </div>
  );
}

/** How long a proposal waits for you, short enough for a summary line: "5 min", "1 h". */
export function ttlLabel(minutes: number): string {
  return minutes < 60 || minutes % 60 !== 0 ? `${minutes} min` : `${minutes / 60} h`;
}

const CHAIN_NAMES: Record<Chain, string> = { solana: "Solana", base: "Base" };

/**
 * What a strategy preset changed besides the prompt, in the words of the cards below.
 * A preset rewrites whatever its way of trading needs in one tap — chains, sources, even
 * the schedule — and those cards are collapsed, so the toast is where that gets said.
 */
function presetChanges(before: BuilderDraft["config"], next: BuilderDraft["config"]): string[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const changes: string[] = [];
  if (!same([...before.chains].sort(), [...next.chains].sort())) {
    changes.push(
      next.chains.length === 1
        ? `${CHAIN_NAMES[next.chains[0]]} only`
        : next.chains.map((chain) => CHAIN_NAMES[chain]).join(" and "),
    );
  }
  if (!same([...before.dataSources].sort(), [...next.dataSources].sort())) {
    changes.push(`${next.dataSources.length} data source${next.dataSources.length === 1 ? "" : "s"}`);
  }
  if (!same(before.universe, next.universe)) changes.push("its universe");
  if (!same(before.risk, next.risk)) changes.push("its risk limits");
  if (!same(before.schedule, next.schedule)) {
    changes.push(intervalLabel(next.schedule.intervalMinutes).toLowerCase());
  }
  if (!same(before.execution, next.execution)) {
    changes.push(
      next.execution.mode === "approve"
        ? `ask first, ${ttlLabel(next.execution.proposalTtlMinutes)} window`
        : "trades on its own",
    );
  }
  return changes;
}

export function BrainStep({
  draft,
  update,
  updateConfig,
  errors,
  llmKeys,
  onKeyAdded,
  hideHeading,
}: StepProps & { llmKeys: LlmKeyRow[]; onKeyAdded: (key: LlmKeyRow) => void }) {
  const provider = draft.config.llm.provider;
  const models = DEFAULT_MODELS[provider];
  const keysForProvider = llmKeys.filter((key) => key.provider === provider);
  /** The chip under the pointer or focus, whose blurb the line under the row shows. */
  const [hintedPreset, setHintedPreset] = useState<string | null>(null);
  const pressedPreset = STRATEGY_PRESETS.find((preset) => preset.prompt === draft.config.strategyPrompt) ?? null;
  const shownPreset = STRATEGY_PRESETS.find((preset) => preset.id === hintedPreset) ?? pressedPreset;

  const applyPreset = (preset: StrategyPreset) => {
    const before = draft.config;
    const next: BuilderDraft["config"] = {
      ...before,
      strategyPrompt: preset.prompt,
      chains: preset.chains,
      dataSources: preset.dataSources,
      // A preset that is a whole way of trading also sets what it needs;
      // one that only carries a prompt leaves the other steps as they are.
      ...(preset.universe ? { universe: { ...before.universe, ...preset.universe } } : {}),
      ...(preset.risk ? { risk: { ...before.risk, ...preset.risk } } : {}),
      ...(preset.execution ? { execution: preset.execution } : {}),
      ...(preset.schedule ? { schedule: preset.schedule } : {}),
    };
    const changes = presetChanges(before, next);
    const replacedPrompt = before.strategyPrompt.trim() !== "" && before.strategyPrompt !== preset.prompt;
    updateConfig(next);
    if (!replacedPrompt && changes.length === 0) return;
    // The draft autosaves 400ms later, so without this a hand-written strategy was gone
    // for good the moment a chip was tapped to see what it did.
    toast(`${preset.label} applied`, {
      description: [
        replacedPrompt ? "Replaced the strategy prompt." : null,
        changes.length > 0 ? `Also set: ${changes.join(" · ")}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
      action: { label: "Undo", onClick: () => updateConfig(before) },
      duration: 8_000,
    });
  };

  return (
    <div className="space-y-5">
      {hideHeading ? null : (
        <StepHeading
        title="Pick its brain"
        blurb="You bring the API key; the agent burns your tokens, not ours. Pick a model that can hold a thesis over a dozen tool calls."
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider" htmlFor="llm-provider">
          <SimpleSelect
            id="llm-provider"
            value={provider}
            options={[
              { value: "anthropic", label: "Anthropic" },
              { value: "openai", label: "OpenAI" },
              { value: "openrouter", label: "OpenRouter" },
            ]}
            onChange={(next) => {
              const nextProvider = next as typeof provider;
              updateConfig({
                llm: {
                  ...draft.config.llm,
                  provider: nextProvider,
                  model: DEFAULT_MODELS[nextProvider][0].id,
                },
              });
              update({ llmKeyId: null });
            }}
          />
        </Field>

        <Field label="Model" htmlFor="llm-model">
          <SimpleSelect
            id="llm-model"
            value={draft.config.llm.model}
            options={models.map((model) => ({ value: model.id, label: model.label }))}
            onChange={(model) => updateConfig({ llm: { ...draft.config.llm, model } })}
          />
        </Field>
      </div>

      <Field label="API key" htmlFor="llm-key" error={errors.llmKeyId}>
        <div className="space-y-2">
          {keysForProvider.length > 0 ? (
            <SimpleSelect
              id="llm-key"
              invalid={Boolean(errors.llmKeyId)}
              describedBy={errors.llmKeyId ? "llm-key-error" : undefined}
              value={draft.llmKeyId}
              placeholder="Choose a key"
              options={keysForProvider.map((key) => ({
                value: key.id,
                label: key.label ?? `${key.provider} key`,
                hint: `••••${key.last4}`,
              }))}
              onChange={(llmKeyId) => update({ llmKeyId })}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              No {provider} key on file yet.
            </p>
          )}
          <AddKeyInline
            provider={provider}
            // With no key to choose, adding one is the fix, so it is what an error focuses.
            id={keysForProvider.length > 0 ? undefined : "llm-key-add"}
            describedBy={keysForProvider.length === 0 && errors.llmKeyId ? "llm-key-error" : undefined}
            onAdded={(key) => {
              onKeyAdded(key);
              update({ llmKeyId: key.id });
            }}
          />
        </div>
      </Field>

      {/* Tuning is advanced by definition: the defaults are right for nearly
          everyone, so the sliders live one level down (the values still show). */}
      <details className="group rounded-xl border border-border/60 bg-card/20 px-3.5 py-2.5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span>Model tuning</span>
          <span className="tnum font-mono text-xs">
            temp {draft.config.llm.temperature.toFixed(1)} · {Math.round(draft.config.llm.maxSteps)} steps
          </span>
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <RiskSlider
          id="llm-temperature"
          label="Temperature"
          value={draft.config.llm.temperature}
          min={0}
          max={1.5}
          step={0.1}
          format={(value) => value.toFixed(1)}
          meaning={
            draft.config.llm.temperature <= 0.3
              ? "Nearly deterministic. It will reach the same conclusion from the same data, which makes its record readable."
              : draft.config.llm.temperature <= 0.7
                ? "Some variety in how it reasons, without wandering off the strategy."
                : "Creative. Expect it to surprise you — sometimes usefully, sometimes expensively."
          }
          onChange={(temperature) => updateConfig({ llm: { ...draft.config.llm, temperature } })}
        />
        <RiskSlider
          id="llm-max-steps"
          label="Max steps per run"
          value={draft.config.llm.maxSteps}
          {...LLM_BOUNDS.maxSteps}
          format={(value) => String(Math.round(value))}
          meaning={`Up to ${Math.round(draft.config.llm.maxSteps)} tool calls before the run is cut off. More steps means deeper research and a bigger token bill.`}
          onChange={(maxSteps) =>
            updateConfig({ llm: { ...draft.config.llm, maxSteps: Math.round(maxSteps) } })
          }
        />
        </div>
      </details>

      <Field
        label="Strategy"
        htmlFor="strategy-prompt"
        error={errors.strategyPrompt}
        hint="This is the system prompt. Be specific about entries, exits and what it must never do."
      >
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5" onMouseLeave={() => setHintedPreset(null)}>
            {STRATEGY_PRESETS.map((preset) => {
              const active = pressedPreset?.id === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={active}
                  aria-describedby={`strategy-preset-${preset.id}-blurb`}
                  onClick={() => applyPreset(preset)}
                  onFocus={() => setHintedPreset(preset.id)}
                  onBlur={() => setHintedPreset(null)}
                  onMouseEnter={() => setHintedPreset(preset.id)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-xs",
                    "transition-[border-color,background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-primary/50 bg-primary/8 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          {/* Visible, not a `title`: a tooltip never shows on touch, and what a chip does
              is the thing to know before tapping it. Screen readers get each chip's own
              blurb through aria-describedby, so this line stays out of their way. */}
          <p aria-hidden className="text-[11px] leading-4 text-muted-foreground">
            {shownPreset
              ? shownPreset.blurb
              : "Each preset replaces the prompt below and sets what its way of trading needs. You can undo it."}
          </p>
          {STRATEGY_PRESETS.map((preset) => (
            <span key={preset.id} id={`strategy-preset-${preset.id}-blurb`} hidden>
              {preset.blurb} Replaces the strategy prompt; you can undo it.
            </span>
          ))}
          <Textarea
            id="strategy-prompt"
            value={draft.config.strategyPrompt}
            aria-invalid={Boolean(errors.strategyPrompt)}
            aria-describedby={errors.strategyPrompt ? "strategy-prompt-error" : undefined}
            rows={9}
            onChange={(event) => updateConfig({ strategyPrompt: event.target.value })}
            className="font-mono text-xs leading-relaxed"
          />
          <p className="tnum text-right text-[11px] text-muted-foreground">
            {draft.config.strategyPrompt.length} / 8000
          </p>
        </div>
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------- data sources

export function DataStep({
  draft,
  updateConfig,
  sources,
  hideHeading,
}: StepProps & { sources: DataSourceInfo[] }) {
  const selected = new Set(draft.config.dataSources);
  const estimate = useMemo(
    () =>
      sources
        .filter((source) => selected.has(source.id))
        .reduce((sum, source) => sum + (source.priceUsd ?? 0.01), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Set identity changes every render
    [sources, draft.config.dataSources],
  );


  return (
    <div className="space-y-5">
      {hideHeading ? null : (
        <StepHeading
        title="What it gets to see"
        blurb="Each source is a paid API the agent calls over x402. Tocker's own wallet pays for the call, not yours — your agent's wallet is for trading — but every source you add is a per-request cost against its data budget for the run."
        />
      )}

      <DataSourcePicker
        sources={sources}
        chains={draft.config.chains as Chain[]}
        selected={draft.config.dataSources}
        onChange={(dataSources) => updateConfig({ dataSources })}
      />

      <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 px-3 py-2.5">
        <p className="text-sm">
          Estimated cost per run
          <span className="ml-2 text-xs text-muted-foreground">
            {selected.size} source{selected.size === 1 ? "" : "s"}, one call each
          </span>
        </p>
        <p className="tnum font-mono text-sm font-medium">{formatUsd(estimate)}</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ universe

export function UniverseStep({ draft, updateConfig, errors, hideHeading }: StepProps) {
  const universe = draft.config.universe;

  return (
    <div className="space-y-6">
      {hideHeading ? null : (
        <StepHeading
        title="Its hunting ground, and its bar"
        blurb="There is no allowlist. The agent can reach any token on the chains you pick — including one minted a minute ago — so what keeps it honest is where it looks and how high it sets the bar."
        />
      )}

      <UniverseControls
        chains={draft.config.chains}
        universe={universe}
        errors={errors}
        onChains={(chains) => updateConfig({ chains })}
        onUniverse={(patch) => updateConfig({ universe: { ...universe, ...patch } })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------- risk

export function RiskStep({ draft, updateConfig, hideHeading }: StepProps) {
  const risk = draft.config.risk;
  const patch = (next: Partial<typeof risk>) => updateConfig({ risk: { ...risk, ...next } });
  // What the book will actually be worth on day one, so the caps can be checked
  // against it here rather than discovered as a refusal on the first tick.
  const fundedUsd = draft.funding.mode === "fund" ? draft.funding.amountUsd : draft.paperStartingUsd;
  const startsWith =
    draft.funding.mode === "fund" ? `the ${formatUsd(fundedUsd)} you are funding` : `its ${formatUsd(fundedUsd)} paper balance`;
  const ticketSharePct = fundedUsd > 0 ? Math.ceil((risk.maxTradeUsd / fundedUsd) * 100) : 0;
  const positionCapTooLow = ticketSharePct > 0 && ticketSharePct > risk.maxPositionPct;

  return (
    <div className="space-y-4">
      {hideHeading ? null : (
        <StepHeading
        title="The rules it cannot break"
        blurb="These are enforced in code before any trade reaches a chain. The model does not get a vote."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <RiskSlider
          id="risk-max-trade"
          label="Max per trade"
          value={risk.maxTradeUsd}
          {...RISK_BOUNDS.maxTradeUsd}
          format={(value) => formatUsd(value)}
          meaning={
            fundedUsd > 0 && risk.maxTradeUsd > fundedUsd
              ? `A single trade can never move more than ${formatUsd(risk.maxTradeUsd)} — but that is more than ${startsWith}, so every trade would be refused for lack of cash. Type an exact number in the box.`
              : `A single trade can never move more than ${formatUsd(risk.maxTradeUsd)}, whatever the model asks for. Click the number to type an exact amount.`
          }
          onChange={(maxTradeUsd) => patch({ maxTradeUsd })}
        />

        <RiskSlider
          id="risk-daily-trades"
          label="Max trades per day"
          value={risk.maxDailyTrades}
          min={1}
          max={100}
          format={(value) => String(Math.round(value))}
          meaning={`Worst case it spends ${formatUsd(risk.maxTradeUsd * Math.round(risk.maxDailyTrades))} of turnover in a day before it is cut off.`}
          onChange={(maxDailyTrades) => patch({ maxDailyTrades: Math.round(maxDailyTrades) })}
        />

        <RiskSlider
          id="risk-position-pct"
          label="Max position size"
          value={risk.maxPositionPct}
          min={1}
          max={100}
          format={(value) => `${Math.round(value)}%`}
          meaning={
            positionCapTooLow
              ? `A ${formatUsd(risk.maxTradeUsd)} trade on ${startsWith} is ${ticketSharePct}% of equity, above this cap — the risk guard would refuse every buy. Set this to at least ${Math.min(100, ticketSharePct)}%, or lower the max per trade.`
              : risk.maxPositionPct >= 50
                ? "Concentrated. One bad token can take most of the book with it."
                : `No single token may exceed ${Math.round(risk.maxPositionPct)}% of equity, so it must hold at least ${Math.ceil(100 / risk.maxPositionPct)} names when fully invested.`
          }
          onChange={(maxPositionPct) => patch({ maxPositionPct: Math.round(maxPositionPct) })}
        />

        <RiskSlider
          id="risk-data-spend"
          label="Data spend cap per run"
          value={risk.maxDataSpendUsdPerRun}
          min={0}
          max={5}
          step={0.05}
          format={(value) => formatUsd(value)}
          meaning={`Once a run has paid ${formatUsd(risk.maxDataSpendUsdPerRun)} for data, further x402 calls are refused and it must decide with what it has.`}
          onChange={(maxDataSpendUsdPerRun) => patch({ maxDataSpendUsdPerRun })}
        />

        <RiskSlider
          id="risk-slippage"
          label="Slippage tolerance"
          value={risk.slippageBps}
          min={10}
          max={2_000}
          step={10}
          format={(value) => `${Math.round(value)} bps`}
          meaning={`Orders are rejected if the fill would be worse than ${(risk.slippageBps / 100).toFixed(2)}% off the quote. Launch-day memecoins usually need 300–500 bps; Jupiter picks tighter when the pool allows.`}
          onChange={(slippageBps) => patch({ slippageBps: Math.round(slippageBps) })}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Exit rules</h3>
        <p className="text-xs text-muted-foreground">
          Enforced every five minutes by the exit engine, whether or not the model is running. A stop that waits for a human is not a stop.
        </p>
        <ExitRulesFields value={risk} onChange={(next) => updateConfig({ risk: next })} />
      </div>
    </div>
  );
}

// ----------------------------------------------------------- schedule & mode

export function ScheduleStep({ draft, update, updateConfig, hideHeading }: StepProps) {
  return (
    <div className="space-y-5">
      {hideHeading ? null : (
        <StepHeading
        title="How often it wakes up"
        blurb="Every tick costs LLM tokens and data credits whether it trades or not. Slower is usually smarter."
        />
      )}

      <Field label="Interval">
        <div className="grid gap-2 sm:grid-cols-3">
          {INTERVAL_PRESETS.map((preset) => {
            const active = draft.config.schedule.intervalMinutes === preset.minutes;
            return (
              <button
                key={preset.minutes}
                type="button"
                aria-pressed={active}
                onClick={() => updateConfig({ schedule: { intervalMinutes: preset.minutes } })}
                className={cn(
                  "rounded-xl border p-3 text-left",
                  "transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary/50 bg-primary/8"
                    : "border-border/70 bg-card/30 hover:border-border hover:bg-card/60",
                )}
              >
                <span className="block text-sm font-medium">{preset.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  {preset.hint}
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      {/* Only a funded agent headed for the checklist has its schedule held (the create
          sends `holdSchedule`). With "Go live after creating" off it ticks on paper, sized
          to the money it is funded with, so saying "no paper ticks" there was untrue. */}
      {draft.funding.mode === "fund" && draft.goLive ? (
        <div className="rounded-xl border border-border/70 bg-card/30 p-3">
          <p className="text-sm font-medium">Real money only</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            No paper balance. This agent trades the {formatUsd(draft.funding.amountUsd)} USDC you fund it with, and
            it takes no paper ticks in the meantime — its schedule starts the moment you switch it live.
          </p>
        </div>
      ) : draft.funding.mode === "fund" ? (
        <div className="rounded-xl border border-border/70 bg-card/30 p-3">
          <p className="text-sm font-medium">Paper first, on the money you fund</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Until you switch it live it trades paper on this schedule, against the{" "}
            {formatUsd(draft.funding.amountUsd)} you fund it with — there is no separate paper balance to pick.
          </p>
        </div>
      ) : (
      <Field label="Paper starting balance" hint="Fake money, real prices, real fills at real quotes.">
        <div className="flex flex-wrap gap-2">
          {PAPER_BALANCES.map((amount) => {
            const active = draft.paperStartingUsd === amount;
            return (
              <button
                key={amount}
                type="button"
                aria-pressed={active}
                onClick={() => update({ paperStartingUsd: amount })}
                className={cn(
                  "tnum rounded-xl border px-3 py-2 font-mono text-sm",
                  "transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary/50 bg-primary/8"
                    : "border-border/70 hover:border-border hover:bg-muted/40",
                )}
              >
                {amount >= 1_000 ? `$${amount / 1_000}K` : formatUsd(amount)}
              </button>
            );
          })}
        </div>
      </Field>
      )}

      <Field
        label="Execution"
        hint="You can change this any time in settings. Approval is how most people run their first live agent."
      >
        <ExecutionControls
          idPrefix="builder-execution"
          execution={draft.config.execution}
          onChange={(execution) => updateConfig({ execution })}
        />
      </Field>

      <div className="rounded-xl border border-border/70 bg-card/30 p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          Mode
          <ModeBadge mode={draft.funding.mode === "fund" && draft.goLive ? "live" : "paper"} />
          {draft.funding.mode === "fund" && draft.goLive ? (
            <span className="text-xs font-normal text-muted-foreground">after the checklist</span>
          ) : null}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {draft.funding.mode === "fund" && draft.goLive
            ? "Real money only. It is funded on create and you land straight on the live checklist, where a hold-to-confirm switches it on. It never trades paper: nothing runs until that switch."
            : "It starts on paper. Going live is a checklist plus a hold-to-confirm on its settings page — fund it there whenever you are ready, or turn on \"Go live after creating\" under Funding to skip straight to it."}
        </p>
      </div>

      <Toggle
        id="activate-now"
        label="Activate immediately"
        description={
          draft.config.schedule.intervalMinutes === 0
            ? "With a manual schedule this only means the agent is ready — it still waits for you to press Run now."
            : `It will start ticking ${intervalLabel(draft.config.schedule.intervalMinutes).toLowerCase()} as soon as it is created.`
        }
        checked={draft.activate}
        onChange={(activate) => update({ activate })}
      />
    </div>
  );
}

// ------------------------------------------------------------------ funding

function SegmentedChoice({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; hint: string }>;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-xl border p-3 text-left",
              "transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary/50 bg-primary/8"
                : "border-border/70 bg-card/30 hover:border-border hover:bg-card/60",
            )}
          >
            <span className="block text-sm font-medium">{option.label}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              {option.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Funding. The one part of the builder that spends real money, so it defaults to
 * not spending any: every agent is created on paper, and this is where you decide
 * whether it also gets a wallet with something in it.
 *
 * The rule the whole card is built around: never silently fund less than asked.
 * A shortfall on one chain blocks with a deposit CTA, rather than quietly
 * shrinking the number the user typed.
 *
 * USDC is the only thing it ever asks for. There is no gas field and no gas line:
 * network fees are Tocker's, and the plan summary says so once, quietly.
 */
export function FundingStep({ draft, update, hideHeading }: StepProps) {
  const funding = draft.funding;
  const chains = draft.config.chains as Chain[];
  const [depositFor, setDepositFor] = useState<Chain | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  /** Set once the box is left: "at least $5" flashing up on the "2" of "25" is noise. */
  const [customLeft, setCustomLeft] = useState(false);

  const { plan, cash, wallets, loading } = useFundingPlan({
    mode: funding.mode,
    amountUsd: funding.amountUsd,
    chains,
    split: funding.split,
  });

  const patch = (next: Partial<BuilderDraft["funding"]>) =>
    update({ funding: { ...funding, ...next } });

  const setAmount = (amountUsd: number) => patch({ amountUsd, split: null });

  const setLeg = (chain: Chain, value: number) => {
    const current: Partial<Record<Chain, number>> = { ...(funding.split ?? {}) };
    for (const entry of chains) {
      if (current[entry] === undefined) {
        current[entry] = plan?.legs.find((l) => l.chain === entry)?.usdc ?? 0;
      }
    }
    current[chain] = value;
    patch({ split: current });
  };

  const paper = funding.mode === "paper";
  const presetPressed = !funding.split && FUND_PRESETS.some((preset) => preset === funding.amountUsd);
  // The summary and the commit bar both quote `amountUsd`, so some control on screen has
  // to show it too. A restored draft can carry an amount no preset matches; the box shows
  // it rather than sitting empty next to four unpressed buttons.
  const customValue = customAmount !== "" || presetPressed || funding.split ? customAmount : String(funding.amountUsd);
  const customError =
    customLeft && customAmount !== "" && !(Number(customAmount) >= MIN_FUND_USD)
      ? `Enter an amount of at least ${formatUsd(MIN_FUND_USD)}.`
      : null;

  return (
    <div className="space-y-5">
      {hideHeading ? null : (
        <StepHeading
          title="Give it money, or not yet"
          blurb="Every agent is created on paper — fake money, real prices. Funding it now means it is ready the moment you switch it to live."
        />
      )}

      <SegmentedChoice
        value={funding.mode}
        onChange={(mode) => patch({ mode: mode as "paper" | "fund" })}
        options={[
          {
            value: "paper",
            label: "Paper only",
            hint: `It trades ${formatUsd(draft.paperStartingUsd)} of imaginary money at real quotes. Nothing is transferred.`,
          },
          {
            value: "fund",
            label: "Fund with USDC",
            hint: "Move real USDC into its wallets as soon as it is created. You sign each transfer.",
          },
        ]}
      />

      {paper ? (
        <div className="rounded-xl border border-border/70 bg-card/30 p-3.5">
          <p className="text-sm font-medium">Paper agents skip funding</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Its wallets are still created, and they stay empty until you put something in them.
            When the record convinces you, fund it from its settings page and switch to live —
            nothing here is a one-way door.
          </p>
        </div>
      ) : (
        <>
          <Toggle
            id="go-live-after"
            label="Go live after creating"
            description="Once the transfer confirms you land on the live checklist — the same server-side checks and hold-to-confirm as always, just without a paper detour. Off means it waits on paper until you open its settings."
            checked={draft.goLive}
            onChange={(goLive) => update({ goLive })}
          />

          <div className="glass rounded-2xl border border-border/60 px-4 py-3.5">
            <p className="text-[11px] text-muted-foreground">Your cash</p>
            <CashTotal cash={cash} size="lg" className="mt-0.5 block" />
            {cash ? (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {chains.map((chain) => {
                  const chainCash = cashOn(cash, chain);
                  return (
                    <li key={chain} className="flex items-center gap-1.5 text-xs">
                      <ChainBadge chain={chain} />
                      <span className="tnum">{formatUsd(chainCash.usdcUsd)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {loading ? "Reading your wallet balances…" : "Sign in to see your balance."}
              </p>
            )}
          </div>

          <Field
            label="Starting cash"
            htmlFor="fund-custom"
            error={customError}
            hint={`Minimum ${formatUsd(MIN_FUND_USD)}. Below that, fees and slippage eat the position before the strategy gets a say.`}
          >
            <div className="flex flex-wrap gap-2">
              {FUND_PRESETS.map((preset) => {
                const active = funding.amountUsd === preset && !funding.split;
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      // A preset replaces whatever was typed, so the box cannot keep
                      // saying 250 next to a pressed $50.00.
                      setCustomAmount("");
                      setCustomLeft(false);
                      setAmount(preset);
                    }}
                    className={cn(
                      "tnum rounded-xl border px-3 py-2 font-mono text-sm",
                      "transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary/50 bg-primary/8"
                        : "border-border/70 hover:border-border hover:bg-muted/40",
                    )}
                  >
                    {formatUsd(preset)}
                  </button>
                );
              })}
              <div className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 left-2.5 grid place-items-center font-mono text-sm text-muted-foreground"
                >
                  $
                </span>
                <Input
                  id="fund-custom"
                  aria-label="Custom starting cash in USDC"
                  aria-invalid={Boolean(customError)}
                  aria-describedby={customError ? "fund-custom-error" : undefined}
                  value={customValue}
                  inputMode="decimal"
                  placeholder="Custom"
                  onChange={(event) => {
                    const next = event.target.value.replace(/[^0-9.]/g, "");
                    // One decimal point: "1.2.3" is not an amount, so the keystroke is refused
                    // rather than silently read as something else.
                    if (next.split(".").length > 2) return;
                    setCustomAmount(next);
                    setCustomLeft(false);
                    // Emptied, the box asks for nothing, so the amount goes back to one a
                    // button shows. Anything typed is the amount, even one too small: the
                    // funding check then blocks create and this box says why.
                    const parsed = Number(next);
                    setAmount(next === "" ? FUND_PRESETS[0] : Number.isFinite(parsed) ? round(parsed, 2) : 0);
                  }}
                  onBlur={() => setCustomLeft(true)}
                  className="tnum h-10 w-28 pl-6 font-mono"
                />
              </div>
            </div>
          </Field>

          {chains.length > 1 ? (
            <Field
              label="Split across chains"
              hint="There is no bridge yet, so USDC has to come from the chain it is already on. The default follows your balances."
            >
              <div className="space-y-2">
                {chains.map((chain) => {
                  const leg = plan?.legs.find((l) => l.chain === chain);
                  return (
                    <div
                      key={chain}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/40 px-3 py-2.5"
                    >
                      <div>
                        <ChainBadge chain={chain} />
                        <p className="tnum mt-1 text-[11px] text-muted-foreground">
                          you hold {formatUsd(cash ? cashOn(cash, chain).usdc : 0)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">$</span>
                        <Input
                          aria-label={`USDC to send on ${chainLabelFor(chain)}`}
                          value={leg ? String(leg.usdc) : ""}
                          inputMode="decimal"
                          onChange={(event) =>
                            setLeg(chain, Number(event.target.value.replace(/[^0-9.]/g, "")) || 0)
                          }
                          className="tnum h-9 w-24 font-mono"
                        />
                      </div>
                    </div>
                  );
                })}
                {funding.split ? (
                  <button
                    type="button"
                    onClick={() => patch({ split: null })}
                    className="rounded text-xs text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Back to a proportional split
                  </button>
                ) : null}
              </div>
            </Field>
          ) : null}


          {plan && plan.blockers.length > 0 ? (
            <div className="space-y-2 rounded-xl border border-destructive/25 bg-destructive/8 p-3.5">
              <p className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle aria-hidden className="size-4 text-destructive" />
                Not ready to fund
              </p>
              <ul className="space-y-1">
                {plan.blockers.map((blocker, index) => (
                  <li
                    key={`${blocker.kind}-${blocker.chain ?? "all"}-${index}`}
                    className="text-xs leading-relaxed text-muted-foreground"
                  >
                    {blocker.message}
                  </li>
                ))}
              </ul>

              {/* Every reason is listed, but two reasons that lead to the same
                  deposit get one button — one action per thing to do. */}
              <div className="flex flex-wrap gap-2 pt-0.5">
                {depositTargets(plan).map((target) => (
                  <button
                    key={target.chain}
                    type="button"
                    onClick={() => setDepositFor(target.chain)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Plus aria-hidden className="size-3.5" />
                    Deposit USDC on {chainLabelFor(target.chain)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {plan?.ready ? (
            <div className="rounded-xl border border-border/70 bg-card/30 p-3.5">
              <p className="text-sm font-medium">What happens when you create it</p>
              <ol className="mt-1.5 space-y-1 text-xs leading-relaxed text-muted-foreground">
                <li>1. The agent and its wallets are created.</li>
                {transfersFor(plan).map((transfer) => (
                  <li key={`${transfer.chain}-${transfer.asset}`} className="tnum">
                    · You sign a transfer of {transferLabel(transfer)}.
                  </li>
                ))}
                <li>
                  If you reject one of those, the agent still exists — unfunded, and saying so on
                  its settings page. You can finish from there.
                </li>
              </ol>
              <FeesCovered className="mt-2" />
            </div>
          ) : null}

          <DepositSheet
            open={depositFor !== null}
            onOpenChange={(open) => {
              if (!open) setDepositFor(null);
            }}
            wallets={wallets}
            cash={cash}
            initialChain={depositFor ?? "base"}
          />
        </>
      )}
    </div>
  );
}
