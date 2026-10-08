"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  CircleAlert,
  CircleDollarSign,
  FlaskConical,
  Info,
  KeyRound,
  Plus,
  Shuffle,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { providerLabel } from "@/lib/agent/providers";
import { ModelPicker } from "@/components/agents/model-picker";
import { KeyPageLink, ProviderHelp, ProviderPicker } from "@/components/agents/provider-picker";
import {
  addKeyLabel,
  keyPlaceholder,
  keyRefusal,
  providerHelp,
  shownKeyError,
  temperatureNote,
} from "@/components/agents/provider-choice";
import { PayPerUsePanel, ThinkSourceChoice } from "@/components/agents/think-source";
import {
  chooseSource,
  dayOverLimit,
  defaultUsdc,
  shownSource,
  stepsAllowed,
  usdcEstimate,
  type UsdcSettings,
} from "@/components/agents/thinking";
import { MAX_PAID_STEPS, USDC_DEFAULT_INTERVAL_MINUTES, type ThinkSource } from "@/lib/x402/inference-types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { ChainBadge } from "@/components/common/chain-badge";
import { ModeBadge } from "@/components/common/mode-badge";
import { FeesCovered } from "@/components/common/fees-covered";
import { formatUsd } from "@/components/common/format";
import { fmtUsdExact } from "@/lib/money";
import { feeForFill, formatFeeRate } from "@/lib/platform/fee";
import { shownUsdc } from "@/components/wallets/cash-display";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { addLlmKeyAction } from "@/components/agents/agent-actions";
import { ExecutionControls } from "@/components/agents/proposals/execution-controls";
import { DataSourcePicker } from "@/components/agents/data-source-picker";
import { ExitRulesFields } from "@/components/agents/exit-rules";
import { UniversePreview } from "@/components/agents/settings/universe-preview";
// From its own file, not the trading barrel, which would bring the price chart and the
// receipts along to the page that creates an agent.
import { SizingControls } from "@/components/trading/sizing-controls";
import { readSizing } from "@/lib/trading/sizing";
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
import type { EditContext } from "./contract";
import { Field, RiskSlider, StepHeading, Toggle } from "./field";
import { SPECS } from "./module-specs";
import { CHOICE_CARD, CHOICE_OFF, CHOICE_ON, IconTile, Mark, TYPE, type Tone } from "./look";
import { slippageMeaning } from "./slippage-copy";
import { UniverseControls } from "./universe-controls";
import { StrategyPresetCards } from "./strategy-preset-cards";
import {
  CUSTOM_STRATEGY,
  applyCustomTo,
  applyPresetTo,
  isCustomPressed,
  presetChanges,
  presetFacts,
} from "./strategy-presets";
import { SimpleSelect } from "./simple-select";
import {
  AVATAR_SEEDS,
  INTERVAL_PRESETS,
  LLM_BOUNDS,
  MAX_AGENT_NAME,
  MAX_TRADE_LADDER,
  firstKeyFor,
  intervalHint,
  launchRadarUsdPerRun,
  onProvider,
  smartMoneyBoardUsdPerRun,
  PAPER_BALANCES,
  RISK_BOUNDS,
  STRATEGY_PRESETS,
  type BuilderDraft,
  type StrategyPreset,
} from "./types";
import { cn } from "@/lib/utils";
import type { AgentRiskWithSizing, PositionSizingConfig } from "@/db/schema";
import type { Chain, DataSourceInfo, LlmKeyRow } from "@/server/types";

export interface StepProps {
  draft: BuilderDraft;
  update: (patch: Partial<BuilderDraft>) => void;
  updateConfig: (patch: Partial<BuilderDraft["config"]>) => void;
  errors: Record<string, string>;
  /** The one-page builder renders its own section headers; steps drop theirs. */
  hideHeading?: boolean;
  /** Set only when the step is editing a saved agent. */
  edit?: EditContext;
}

// ------------------------------------------------------------------ identity

/**
 * As much of a seed as a shuffle keeps in front of its four random characters. Every
 * avatar tile's name is shorter, so a seed that started as a tile is never cut.
 */
const MAX_SEED_BASE = 24;

export function IdentityStep({ draft, update, errors, hideHeading }: StepProps) {
  const shuffled = !(AVATAR_SEEDS as readonly string[]).includes(draft.avatarSeed);
  const [shuffles, setShuffles] = useState(0);
  return (
    <div className="space-y-6">
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
        label="Tagline · optional"
        htmlFor="agent-tagline"
        hint="One line on its edge."
      >
        <Input
          id="agent-tagline"
          value={draft.tagline}
          maxLength={120}
          placeholder="Buys narrative velocity, sells the flip."
          onChange={(event) => update({ tagline: event.target.value })}
        />
      </Field>

      <Field label="Avatar · optional" hint="Picked for you.">
        {/* One row at every width. On phones it scrolls, runs to the screen edge and fades
            out, so the cut-off tile reads as "more this way". */}
        <div className="flex items-center gap-2 max-sm:-mr-4 max-sm:-ml-1 max-sm:overflow-x-auto max-sm:py-1 max-sm:pr-10 max-sm:pl-1 max-sm:[scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-40px),transparent)] max-sm:scroll-pr-10 sm:max-md:gap-1 lg:max-xl:gap-1">
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
                  "shrink-0 rounded-xl p-0.5 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.94] motion-reduce:active:scale-100",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  // The gap keeps the ring visible around an avatar that is itself violet.
                  active
                    ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : "ring-1 ring-transparent hover:ring-white/20",
                )}
              >
                <AgentAvatar seed={seed} name={draft.name || seed} size="lg" className="sm:size-9" />
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              // Re-suffix the base seed rather than appending, so repeat shuffles stay short.
              // A saved agent that never picked an avatar is seeded with its own name,
              // which can be as long as a name may be: cut, so the seed stays one a save
              // accepts.
              const base = draft.avatarSeed.split("-")[0].slice(0, MAX_SEED_BASE);
              update({ avatarSeed: `${base}-${Math.random().toString(36).slice(2, 6)}` });
              setShuffles((n) => n + 1);
            }}
            // A shuffled seed matches none of the tiles, so this tile becomes the preview —
            // otherwise the pick is invisible and every further shuffle looks like a no-op.
            aria-pressed={shuffled}
            aria-label={shuffled ? "Randomise avatar (current: random)" : "Randomise avatar"}
            className={cn(
              "shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              shuffled
                ? "relative rounded-xl p-0.5 ring-2 ring-primary ring-offset-2 ring-offset-background transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.94] motion-reduce:active:scale-100"
                : "grid size-12 place-items-center rounded-xl border border-dashed border-border text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground sm:size-9",
            )}
          >
            {shuffled ? (
              <>
                <AgentAvatar seed={draft.avatarSeed} name={draft.name || "Random"} size="lg" className="sm:size-9" />
                <span className="absolute -right-1.5 -bottom-1.5 grid size-5 place-items-center rounded-full border border-border bg-background text-muted-foreground sm:size-4">
                  <Shuffle aria-hidden className="size-3 sm:size-2.5" />
                </span>
              </>
            ) : (
              <Shuffle aria-hidden className="size-4" />
            )}
          </button>
        </div>
        {/* Keyed so each shuffle inserts a fresh node — identical text would not re-announce. */}
        <span aria-live="polite" className="sr-only">
          {shuffles > 0 ? <span key={shuffles}>New avatar picked</span> : null}
        </span>
      </Field>

      <Toggle
        id="agent-public"
        label="Public"
        description="Anyone can see its trades, its PnL and the one-line reason for each. Your strategy, rules and wallets stay private, and nobody can copy it."
        checked={draft.isPublic}
        onChange={(isPublic) => update({ isPublic })}
      />
    </div>
  );
}

// --------------------------------------------------------------------- brain

type KeyField = "key" | "label" | "workspace";

/** Which field a server error is about, so it sits under that field. */
function keyFieldFor(message: string): KeyField {
  if (/^label/i.test(message)) return "label";
  if (/workspace id/i.test(message)) return "workspace";
  return "key";
}

/**
 * Adds a key for the provider the agent already thinks with. There is deliberately no
 * provider picker in here: a second one, independent of the Brain's, let an Anthropic
 * key be attached to an OpenAI agent, where the key select could not even show it and
 * every run failed. Switch the Brain's provider to add a key for another one.
 *
 * Errors sit under the field they are about, like Settings → Keys, not in toasts: a
 * toast per press stacked copies of the same sentence and left the key box unmarked.
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
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [error, setError] = useState<{ field: KeyField; message: string } | null>(null);
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
        {addKeyLabel(provider)}
      </button>
    );
  }

  const keyId = id ?? `${uid}-key`;
  const errorId = (field: KeyField) => `${uid}-${field}-error`;
  const invalid = (field: KeyField) =>
    error?.field === field ? { "aria-invalid": true, "aria-describedby": errorId(field) } : {};
  const errorFor = (field: KeyField) =>
    error?.field === field ? (
      <p id={errorId(field)} role="alert" className="mt-1 text-xs text-destructive">
        {error.message}
      </p>
    ) : null;
  const edited = (field: KeyField) => {
    if (error?.field === field) setError(null);
  };

  const save = () => {
    if (pending || value.trim() === "") return;
    // Too short, another provider's key, or one without the prefix this provider puts on
    // every key: said here, before the key has been sent anywhere at all.
    const refusal = keyRefusal(provider, value);
    if (refusal) {
      setError({ field: "key", message: refusal });
      return;
    }
    setError(null);
    start(async () => {
      const result = await addLlmKeyAction({
        provider,
        key: value.trim(),
        label: label.trim() || undefined,
        workspaceId: provider === "anthropic" && workspaceId.trim() ? workspaceId.trim() : undefined,
      });
      if (!result.ok) {
        setError({ field: keyFieldFor(result.error), message: shownKeyError(result.error, value) });
        return;
      }
      onAdded({
        id: result.data.id,
        provider,
        label: label.trim() || null,
        last4: result.data.last4,
        createdAt: new Date().toISOString(),
      });
      setOpen(false);
      setValue("");
      setLabel("");
      setWorkspaceId("");
      toast.success("Key saved");
    });
  };

  // Not a <form>: this sits inside the settings page and the builder, so Enter is wired
  // by hand on each box.
  const saveOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    save();
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-border bg-card/40 p-3">
      <div className="flex items-center gap-2">
        <KeyRound aria-hidden className="size-3.5 text-muted-foreground" />
        <p className="text-xs font-medium">New {providerLabel(provider)} key</p>
        <button
          type="button"
          onClick={() => {
            // Cancel means gone: the secret must not sit in state and reappear on reopen.
            setValue("");
            setError(null);
            setOpen(false);
          }}
          aria-label="Cancel"
          className="ml-auto rounded p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>

      <div>
        <label htmlFor={keyId} className="mb-1 block text-xs text-muted-foreground">
          API key
        </label>
        <Input
          id={keyId}
          type="password"
          aria-invalid={error?.field === "key" || undefined}
          aria-describedby={
            [error?.field === "key" ? errorId("key") : null, describedBy].filter(Boolean).join(" ") || undefined
          }
          // Mounted only by pressing "Add", which unmounts that button: without this,
          // focus would fall back to the page.
          autoFocus
          value={value}
          placeholder={keyPlaceholder(provider)}
          // "new-password" is the value Chrome actually honours on a password field;
          // "off" still offers to save the key into the password manager.
          autoComplete="new-password"
          spellCheck={false}
          maxLength={512}
          onChange={(event) => {
            setValue(event.target.value);
            edited("key");
          }}
          onKeyDown={saveOnEnter}
          className="font-mono"
        />
        {errorFor("key")}
      </div>
      <div>
        <label htmlFor={`${uid}-label`} className="mb-1 block text-xs text-muted-foreground">
          Label (optional)
        </label>
        <Input
          id={`${uid}-label`}
          value={label}
          placeholder="Personal key"
          maxLength={40}
          {...invalid("label")}
          onChange={(event) => {
            setLabel(event.target.value);
            edited("label");
          }}
          onKeyDown={saveOnEnter}
        />
        {errorFor("label")}
      </div>
      {provider === "anthropic" ? (
        <div>
          <label htmlFor={`${uid}-workspace`} className="mb-1 block text-xs text-muted-foreground">
            Workspace ID (optional)
          </label>
          <Input
            id={`${uid}-workspace`}
            value={workspaceId}
            placeholder="wrkspc_…"
            autoComplete="off"
            spellCheck={false}
            {...invalid("workspace")}
            onChange={(event) => {
              setWorkspaceId(event.target.value);
              edited("workspace");
            }}
            onKeyDown={saveOnEnter}
            className="font-mono"
          />
          {errorFor("workspace")}
        </div>
      ) : null}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Encrypted at rest. Decrypted only on our servers, when the agent runs and when its model list is
        loaded. It never reaches the browser again.
        {provider === "anthropic"
          ? " Leave the workspace empty: an organization-level Anthropic key gets its workspace detected automatically."
          : ""}
      </p>
      {/* Disabled while empty: an empty save is not a rejected key, and should not look like one. */}
      <button
        type="button"
        disabled={pending || value.trim() === ""}
        onClick={save}
        className="w-full rounded-lg bg-primary py-1.5 text-xs font-medium text-primary-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

/** The two labels the preset sentences borrow, so a card and a toast say "every 5 min" alike. */
const PRESET_LABELS = { interval: intervalLabel, ttl: ttlLabel };

export function ThinkStep({
  draft,
  update,
  updateConfig,
  errors,
  llmKeys,
  onKeyAdded,
  payPerUseAllowed = false,
  hideHeading,
  edit,
}: StepProps & {
  llmKeys: LlmKeyRow[];
  onKeyAdded: (key: LlmKeyRow) => void;
  /**
   * The server's answer for this viewer. False: no choice is shown, only the key fields.
   * For a saved agent it is also true while that agent is saved on pay per use, whoever
   * is allowed what today, so it can always be moved to its owner's key.
   */
  payPerUseAllowed?: boolean;
}) {
  const provider = draft.config.llm.provider;
  const keysForProvider = llmKeys.filter((key) => key.provider === provider);
  const source = shownSource(draft.config, payPerUseAllowed);
  // A draft that says pay-per-use always shows the panel, even one saved without its
  // limits: the panel then opens on the defaults instead of on key fields it cannot use.
  const usdc =
    source === "usdc" ? (draft.config.llm.usdc ?? defaultUsdc(draft.config.schedule.intervalMinutes)) : null;
  /** The interval a switch to pay-per-use moved the schedule from, so switching back can undo it. */
  const [scheduleMovedFrom, setScheduleMovedFrom] = useState<number | null>(null);
  // Forgotten the moment the schedule is anywhere else: from then on it is the owner's
  // own choice, and neither the note in the panel nor a switch back may undo it.
  if (scheduleMovedFrom !== null && draft.config.schedule.intervalMinutes !== USDC_DEFAULT_INTERVAL_MINUTES) {
    setScheduleMovedFrom(null);
  }
  /**
   * The limits last set in this form, put back if the owner returns to pay-per-use. A
   * saved agent starts with the ones it was saved with.
   */
  const rememberedUsdc = useRef<UsdcSettings | null>(edit?.savedConfig.llm.usdc ?? null);
  const switchSource = (next: ThinkSource) => {
    if (next === source) return;
    if (source === "usdc") rememberedUsdc.current = draft.config.llm.usdc ?? null;
    const change = chooseSource(draft.config, next, {
      remembered: rememberedUsdc.current,
      restoreInterval: scheduleMovedFrom,
      // An agent whose saved config names its mode has it named again on the way back,
      // so the switch to a key is written down, not left to be read from a missing field.
      explicitKey: edit ? edit.savedConfig.llm.source !== undefined : undefined,
    });
    updateConfig(change.config);
    setScheduleMovedFrom(change.scheduleMovedFrom);
  };

  return (
    <div className="space-y-5">
      {hideHeading ? null : (
        <StepHeading
        title="Pick its brain"
        blurb="You bring the API key; the agent burns your tokens, not ours. Pick a model that can hold a thesis over a dozen tool calls."
        />
      )}

      {/* Only when the server said this viewer may pay per use. Without it there is no
          choice to make, and the key fields below are the whole section, as before. */}
      {payPerUseAllowed ? <ThinkSourceChoice idPrefix="builder" value={source} onChange={switchSource} /> : null}

      {usdc ? (
        <PayPerUsePanel
          idPrefix="builder"
          usdc={usdc}
          intervalMinutes={draft.config.schedule.intervalMinutes}
          maxSteps={draft.config.llm.maxSteps}
          chains={draft.config.chains}
          // Only a saved agent can be on pay per use after the account lost it. The panel
          // then says so, and the choice above is still how the agent leaves it.
          allowed={edit?.payPerUseStillAllowed}
          onChange={(next) => updateConfig({ llm: { ...draft.config.llm, source: "usdc", usdc: next } })}
          scheduleMovedFrom={scheduleMovedFrom}
          scheduleSection="Schedule & mode"
        />
      ) : (
      <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider" htmlFor="llm-provider">
          <ProviderPicker
            id="llm-provider"
            value={provider}
            // Only while there is a line under the chooser to read out with it.
            describedBy={providerHelp(provider, { hasKey: keysForProvider.length > 0 }) ? "llm-provider-help" : undefined}
            onChange={(nextProvider) => {
              // The provider's own default model: the one that was chosen belongs to the
              // provider being left, and would fail the first run on this one.
              updateConfig({ llm: onProvider(draft.config.llm, nextProvider) });
              // The first key this provider has, not none: with one on file the select
              // sat on "Choose a key" and Create was refused until the only option was
              // picked by hand. With none it stays empty, and adding one is the next step.
              update({ llmKeyId: firstKeyFor(llmKeys, nextProvider) });
            }}
          />
        </Field>

        {/* What the registry notes about this provider, and where its keys are made while
            the account has none. Straight under the chooser on a phone; under the row,
            across both columns, where Provider and Model sit side by side. */}
        <ProviderHelp
          id="llm-provider-help"
          provider={provider}
          hasKey={keysForProvider.length > 0}
          className="-mt-2 sm:order-last sm:col-span-2"
        />

        <Field label="Model" htmlFor="llm-model">
          <ModelPicker
            id="llm-model"
            provider={provider}
            keyId={draft.llmKeyId}
            value={draft.config.llm.model}
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
                label: key.label ?? `${providerLabel(key.provider)} key`,
                hint: `••••${key.last4}`,
              }))}
              onChange={(llmKeyId) => update({ llmKeyId })}
            />
          ) : llmKeys.length === 0 ? (
            // No key on the account at all: someone who skipped the key step lands here,
            // and "No Anthropic key on file yet" said neither what a key is nor where one
            // comes from. The page for the chosen provider's keys is linked under the
            // chooser above; this says what a key is and points there, whichever of the
            // providers is chosen. OpenRouter is still named as the quickest start for
            // someone with no account anywhere, with its link, both read from its row.
            <p className="text-xs leading-5 text-muted-foreground">
              Your agent&rsquo;s model runs on your own account with an AI provider, and they bill you for it. No
              key yet? Create one on the page linked under Provider above, then add it here.
              {provider === "openrouter" ? null : (
                <>
                  {" "}
                  If you have no account with any provider, {providerLabel("openrouter")} is the quickest to start
                  with: create a key at <KeyPageLink provider="openrouter" />, then set Provider to{" "}
                  {providerLabel("openrouter")} above.
                </>
              )}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No {providerLabel(provider)} key on file yet.
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
      </>
      )}

      {/* Tuning is advanced by definition: the defaults are right for nearly
          everyone, so the sliders live one level down (the values still show). */}
      <details className="group rounded-xl border border-border/60 bg-card/20 px-3.5 py-2.5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span>Model tuning · optional</span>
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
          spec={SPECS.temperature}
          meaning={
            // Some providers are sent no temperature, or less than is set here. Where
            // that is so the slider says it, rather than describing an effect it will
            // not have. On Anthropic, OpenAI and OpenRouter the setting is sent as it is.
            (source === "usdc"
              ? null
              : temperatureNote(provider, draft.config.llm.temperature, draft.config.llm.model)) ??
            (draft.config.llm.temperature <= 0.3
              ? "Nearly deterministic. It will reach the same conclusion from the same data, which makes its record readable."
              : draft.config.llm.temperature <= 0.7
                ? "Some variety in how it reasons, without wandering off the strategy."
                : "Creative. Expect it to surprise you — sometimes usefully, sometimes expensively.")
          }
          onChange={(temperature) => updateConfig({ llm: { ...draft.config.llm, temperature } })}
        />
        <RiskSlider
          id="llm-max-steps"
          label="Max steps per run"
          value={draft.config.llm.maxSteps}
          {...LLM_BOUNDS.maxSteps}
          spec={SPECS.maxSteps}
          meaning={
            source === "usdc"
              ? `Up to ${stepsAllowed(Math.round(draft.config.llm.maxSteps), "usdc")} steps before the run is cut off: a pay-per-use run stops at ${MAX_PAID_STEPS} whatever this says, and every step is paid for.`
              : `Up to ${Math.round(draft.config.llm.maxSteps)} tool calls before the run is cut off. More steps means deeper research and a bigger token bill.`
          }
          onChange={(maxSteps) =>
            updateConfig({ llm: { ...draft.config.llm, maxSteps: Math.round(maxSteps) } })
          }
        />
        </div>
      </details>
    </div>
  );
}

// ------------------------------------------------------------------ strategy

export function StrategyStep({
  draft,
  updateConfig,
  errors,
}: StepProps) {
  const pressedPreset = STRATEGY_PRESETS.find((preset) => preset.prompt === draft.config.strategyPrompt) ?? null;
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const applyPreset = (preset: StrategyPreset) => {
    const before = draft.config;
    const next = applyPresetTo(before, preset);
    const changes = presetChanges(before, next, PRESET_LABELS);
    const replacedPrompt = before.strategyPrompt.trim() !== "" && before.strategyPrompt !== preset.prompt;
    updateConfig(next);
    if (!replacedPrompt && changes.length === 0) return;
    // The draft autosaves 400ms later, so without this a hand-written strategy was gone
    // for good the moment a card was tapped to see what it did.
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

  const applyCustom = () => {
    const previous = draft.config.strategyPrompt;
    // Already on Custom with words in the box: those words are the user's own. Tapping the
    // card again takes them to the box and clears nothing.
    if (previous.trim() !== "" && isCustomPressed(previous)) {
      promptRef.current?.focus();
      return;
    }
    // Only the prompt is written, and only the prompt comes back on Undo: a rule changed
    // while the toast is up is not Custom's to take away.
    updateConfig({ strategyPrompt: applyCustomTo(draft.config).strategyPrompt });
    // The card's whole point is the empty box, so that is where the caret goes.
    promptRef.current?.focus();
    if (previous.trim() === "") return;
    toast(`${CUSTOM_STRATEGY.label} applied`, {
      description: "Cleared the strategy prompt.",
      action: { label: "Undo", onClick: () => updateConfig({ strategyPrompt: previous }) },
      duration: 8_000,
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <StrategyPresetCards
          presets={STRATEGY_PRESETS}
          pressedId={pressedPreset?.id ?? null}
          // Read from the same merge a tap would write, so the line cannot promise an
          // agent the preset does not make.
          factsLine={(preset) => presetFacts(applyPresetTo(draft.config, preset), PRESET_LABELS)}
          onApply={applyPreset}
          customPressed={isCustomPressed(draft.config.strategyPrompt)}
          onCustom={applyCustom}
        />
        {/* Screen readers get the same promise from each card's own description, so this
            line stays out of their way. */}
        <p aria-hidden className={cn(TYPE.caption, "text-muted-foreground")}>
          A preset replaces the prompt and sets what it needs. You can undo it.
        </p>
      </div>

      <Field
        label="Strategy"
        htmlFor="strategy-prompt"
        error={errors.strategyPrompt}
        hint="Standing instructions: when to enter, when to exit, what never to do."
      >
        <div className="space-y-1.5">
          <Textarea
            id="strategy-prompt"
            ref={promptRef}
            value={draft.config.strategyPrompt}
            aria-invalid={Boolean(errors.strategyPrompt)}
            aria-describedby={errors.strategyPrompt ? "strategy-prompt-error" : undefined}
            rows={6}
            onChange={(event) => updateConfig({ strategyPrompt: event.target.value })}
            // No text size of its own: the primitive's 16px on phones (iOS zooms into any
            // smaller field) and 14px from md. A "text-xs" here only ever reached phones.
            className="font-mono leading-relaxed"
          />
          <p className={cn(TYPE.caption, "text-right text-muted-foreground")}>
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
  edit,
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
  const chainCount = draft.config.chains.length;
  const radar = launchRadarUsdPerRun(draft.config.universe.discovery, draft.config.chains);
  const board = smartMoneyBoardUsdPerRun(draft.config.universe.discovery, draft.config.chains, draft.config.dataSources);

  return (
    <div className="space-y-5">
      {hideHeading ? null : (
        <StepHeading
        title="What it gets to see"
        blurb="Each source is a paid API the agent calls over x402. Tocker's own wallet pays for the call, not yours — your agent's wallet is for trading — but every source you add is a per-request cost against its data budget for the run."
        />
      )}

      {/* The one-page builder drops the heading above, and with it the only sentence in
          here about who pays: the closed card says "paid by Tocker" and the open one showed
          a price on every source and nothing else. */}
      {hideHeading ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Tocker pays for these calls, not you. Each price is what one call costs; the per-run cap under Risk
          limits is the most a run can spend.
          {selected.size === 0
            ? " No sources selected: the agent buys no research on individual tokens and decides on the launch radar, the free feeds and the free safety checks."
            : ""}
        </p>
      ) : null}

      <DataSourcePicker
        sources={sources}
        // The operator's notes, such as which platform wallet pays for a source. The page
        // that creates an agent is never told who is an operator, so they show only here.
        isAdmin={edit?.isAdmin}
        chains={draft.config.chains as Chain[]}
        selected={draft.config.dataSources}
        onChange={(dataSources) => updateConfig({ dataSources })}
      />

      {/* The radar is picked under the hunting ground, not here, but it is paid from the
          same budget — so it gets its own line rather than hiding inside "sources". */}
      <dl className="rounded-xl border border-border/70 bg-card/40 px-3 py-2.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">
            {selected.size} source{selected.size === 1 ? "" : "s"}, one call each
          </dt>
          <dd className="tnum font-mono">{formatUsd(estimate)}</dd>
        </div>
        {radar > 0 ? (
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">
              Paid launch radar, {chainCount} chain{chainCount === 1 ? "" : "s"}
            </dt>
            <dd className="tnum font-mono">{formatUsd(radar)}</dd>
          </div>
        ) : null}
        {/* The same for the smart money board: a feed, switched on under the hunting
            ground, bought once a chain from this budget. */}
        {board > 0 ? (
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">
              Smart money board, {chainCount} chain{chainCount === 1 ? "" : "s"}
            </dt>
            <dd className="tnum font-mono">{formatUsd(board)}</dd>
          </div>
        ) : null}
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-border/60 pt-2">
          <dt>Estimated cost per run</dt>
          <dd className="tnum font-mono font-medium">≈{formatUsd(estimate + radar + board)}</dd>
        </div>
      </dl>
    </div>
  );
}

// ------------------------------------------------------------------ universe

export function UniverseStep({ draft, updateConfig, errors, hideHeading, edit }: StepProps) {
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
        dataSources={draft.config.dataSources}
        errors={errors}
        onChains={(chains) => updateConfig({ chains })}
        onUniverse={(patch) => updateConfig({ universe: { ...universe, ...patch } })}
      />

      {/* What these floors would have let through, read from the saved agent's own score
          history, so there is none to show before an agent exists. Under the controls,
          not above them: it is the consequence of what was just moved. Debounced, and
          nothing waits on it. */}
      {edit ? <UniversePreview agentId={edit.agentId} universe={universe} chains={draft.config.chains} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------- risk

/**
 * Position sizing, which only a saved agent has on this step. `SizingControls` keeps its
 * own copy of the value from the moment it mounts, so that a half-typed percentage is not
 * clamped under the cursor. That copy would go on showing an edit after the agent's
 * settings were put back to what is saved, and the next change would be made on top of
 * it. So the controls start again whenever the value is changed by any hand but their own.
 */
function SavedAgentSizing({
  risk,
  equityUsd,
  onChange,
}: {
  risk: AgentRiskWithSizing;
  equityUsd: number | null;
  onChange: (sizing: PositionSizingConfig) => void;
}) {
  const sizing = readSizing(risk);
  const current = JSON.stringify(sizing);
  /** The value the controls were mounted with, or last reported. */
  const [held, setHeld] = useState(current);
  const [mounts, setMounts] = useState(0);
  if (held !== current) {
    setHeld(current);
    setMounts((count) => count + 1);
  }
  return (
    <SizingControls
      key={mounts}
      value={sizing}
      maxTradeUsd={risk.maxTradeUsd}
      equityUsd={equityUsd}
      onChange={(next) => {
        // Read back the way the next render will read it, so this change is not taken
        // for somebody else's.
        setHeld(JSON.stringify(readSizing({ ...risk, sizing: next })));
        onChange(next);
      }}
    />
  );
}

export function RiskStep({
  draft,
  updateConfig,
  hideHeading,
  feeBps = 0,
  edit,
}: StepProps & {
  /** Tocker's fee in basis points of each fill, from the server; 0 when it is off. */
  feeBps?: number;
}) {
  const risk = draft.config.risk;
  const patch = (next: Partial<typeof risk>) => updateConfig({ risk: { ...risk, ...next } });
  // What the book will actually be worth on day one, so the caps can be checked
  // against it here rather than discovered as a refusal on the first tick. A saved agent
  // has a book already, so its caps are checked against its equity; while there is no
  // figure for that, nothing is said about it. Nothing is said either when it sizes its
  // tickets as a share of that equity: both sentences take every ticket to be the cap
  // itself, which is only so for a fixed one, and the sizing block below says what the
  // next ticket would be.
  const fundedUsd = edit
    ? readSizing(risk).mode === "fixed_usd"
      ? (edit.equityUsd ?? 0)
      : 0
    : draft.funding.mode === "fund"
      ? draft.funding.amountUsd
      : draft.paperStartingUsd;
  const startsWith = edit
    ? `its ${formatUsd(fundedUsd)} of equity`
    : draft.funding.mode === "fund"
      ? `the ${formatUsd(fundedUsd)} you are funding`
      : `its ${formatUsd(fundedUsd)} paper balance`;
  const ticketSharePct = fundedUsd > 0 ? Math.ceil((risk.maxTradeUsd / fundedUsd) * 100) : 0;
  const positionCapTooLow = ticketSharePct > 0 && ticketSharePct > risk.maxPositionPct;
  // The fee is the same share of every ticket, so it is said as its rate, with the
  // amount it comes to on the ticket being sized here, printed as it is and not to the
  // nearest cent. An illustration from the server's rate: what a fill is charged is
  // worked out on the server when it fills.
  const feeNote =
    feeBps > 0
      ? ` Tocker's fee is ${formatFeeRate(feeBps)} of each fill: ${fmtUsdExact(feeForFill(risk.maxTradeUsd, feeBps))} on a ticket this size.`
      : "";

  const exitRules = (
    <div className="space-y-2">
      <h3 id="risk-exits" tabIndex={-1} className="scroll-mt-24 text-sm font-medium">Exit rules</h3>
      <p className="text-xs text-muted-foreground">
        Enforced every five minutes by the exit engine, whether or not the model is running. A stop that waits for a human is not a stop.
      </p>
      <ExitRulesFields value={risk} onChange={(next) => updateConfig({ risk: next })} />
    </div>
  );

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
          ladder={MAX_TRADE_LADDER}
          spec={SPECS.maxTradeUsd}
          meaning={
            fundedUsd > 0 && risk.maxTradeUsd > fundedUsd
              ? `A single trade can never move more than ${formatUsd(risk.maxTradeUsd)} — but that is more than ${startsWith}, so every trade would be refused for lack of cash.${feeNote}`
              : `A single trade can never move more than ${formatUsd(risk.maxTradeUsd)}, whatever the model asks for.${feeNote}`
          }
          onChange={(maxTradeUsd) => patch({ maxTradeUsd })}
        />

        <RiskSlider
          id="risk-daily-trades"
          label="Max trades per day"
          value={risk.maxDailyTrades}
          min={1}
          max={100}
          spec={SPECS.maxDailyTrades}
          meaning={`Worst case it spends ${formatUsd(risk.maxTradeUsd * Math.round(risk.maxDailyTrades))} of turnover in a day before it is cut off.`}
          onChange={(maxDailyTrades) => patch({ maxDailyTrades: Math.round(maxDailyTrades) })}
        />

        <RiskSlider
          id="risk-position-pct"
          label="Max position size"
          value={risk.maxPositionPct}
          min={1}
          max={100}
          spec={SPECS.maxPositionPct}
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
          spec={SPECS.maxDataSpendUsdPerRun}
          meaning={`Once a run has spent ${formatUsd(risk.maxDataSpendUsdPerRun)} of Tocker's data budget, further paid calls are refused and it decides with what it has.`}
          onChange={(maxDataSpendUsdPerRun) => patch({ maxDataSpendUsdPerRun })}
        />

        <RiskSlider
          id="risk-slippage"
          label="Slippage tolerance"
          value={risk.slippageBps}
          min={10}
          max={2_000}
          step={10}
          spec={SPECS.slippageBps}
          // The fifth card, with the longest sentence: full width rather than a hole beside it.
          className="sm:col-span-2"
          meaning={slippageMeaning(risk.slippageBps)}
          onChange={(slippageBps) => patch({ slippageBps: Math.round(slippageBps) })}
        />
      </div>

      {/* Sizing decides how big a ticket is within the cap above; the cap is the ceiling
          it can never cross. It is saved with the caps, in the same Save, so the ceiling
          and the ticket size are always applied together. Its preview is worked out from
          the agent's equity, which an agent that does not exist yet has none of.

          It shares the exit rules' place among the step's children and adds none of its
          own: every slider here takes its generated id from where it sits among them, and
          the builder, which has no sizing, must keep the ids it had. */}
      {edit ? (
        <>
          <div className="border-t border-border/50 pt-4">
            <SavedAgentSizing risk={risk} equityUsd={edit.equityUsd} onChange={(sizing) => patch({ sizing })} />
          </div>
          {exitRules}
        </>
      ) : (
        exitRules
      )}
    </div>
  );
}

// ----------------------------------------------------------- schedule & mode

export function ScheduleStep({
  draft,
  update,
  updateConfig,
  hideHeading,
  payPerUseAllowed = false,
  edit,
}: StepProps & {
  /** The server's answer for this viewer; see `ThinkStep`. */
  payPerUseAllowed?: boolean;
}) {
  const usdc = shownSource(draft.config, payPerUseAllowed) === "usdc" ? (draft.config.llm.usdc ?? null) : null;
  // On pay per use each choice says what it is expected to cost on the chosen model.
  const payPerUseModel = usdc?.model ?? null;
  // What the chosen interval is expected to cost in a day, and whether that is more than
  // the daily limit: the same comparison `checkUsdc` refuses a create or a save on, so
  // this line and that refusal never disagree.
  const day = usdc ? usdcEstimate(usdc.model, draft.config.schedule.intervalMinutes) : null;
  const overDailyLimit = usdc !== null && day !== null && day.model !== null && dayOverLimit(day, usdc);
  return (
    <div className="space-y-5">
      {hideHeading ? null : (
        <StepHeading
        title="How often it wakes up"
        blurb="Every tick costs LLM tokens and data credits whether it trades or not. Slower is usually smarter."
        />
      )}

      {/* The heading this replaces was the only place the builder said a run costs the
          owner anything; the one-page builder hides it. */}
      <Field
        label="Interval"
        hint={
          hideHeading
            ? payPerUseModel
              ? "Every run pays for its own thinking in USDC from the agent's wallet, whether or not it trades. Tocker pays for its data."
              : `Every run bills model tokens to your ${providerLabel(draft.config.llm.provider)} key, whether or not it trades. Tocker pays for its data.`
            : undefined
        }
      >
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
                {/* Tabular figures only where the hint is a price; the key hints are set as they were. */}
                <span
                  className={cn(
                    "mt-0.5 block text-xs leading-relaxed text-muted-foreground",
                    payPerUseModel && "tnum",
                  )}
                >
                  {intervalHint(preset, payPerUseModel)}
                </span>
              </button>
            );
          })}
        </div>
        {/* Each choice already prices itself; this is the one thing they cannot say. It
            sits where the interval is chosen because the limit it breaks is set on
            another step, and without it the first sign would be a refused Create or Save. */}
        {overDailyLimit ? (
          <p role="status" className="tnum flex items-start gap-1.5 text-xs leading-relaxed text-destructive">
            <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>
              About {day.runsPerDay} run{day.runsPerDay === 1 ? "" : "s"} a day is about {formatUsd(day.dayUsd)} of
              thinking, over its {formatUsd(usdc.maxUsdPerDay)} daily limit. Raise the limit under How it thinks, or
              run it less often.
            </span>
          </p>
        ) : null}
      </Field>

      {/* Only a funded agent headed for the checklist has its schedule held (the create
          sends `holdSchedule`). With "Go live after creating" off it ticks on paper, sized
          to the money it is funded with, so saying "no paper ticks" there was untrue.
          A saved agent gets none of the three: what it started with was settled when it
          was created, and no save changes it. */}
      {edit ? null : draft.funding.mode === "fund" && draft.goLive ? (
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
        hint={
          edit
            ? "Approval applies from the next tick, and a proposal the agent already made keeps the time limit it was created with."
            : "You can change this any time in settings. Approval is how most people run their first live agent."
        }
      >
        <ExecutionControls
          idPrefix="builder-execution"
          execution={draft.config.execution}
          onChange={(execution) => updateConfig({ execution })}
        />
      </Field>

      {/* The mode and whether it is running are not this step's to set once the agent
          exists: neither is part of a save, and both are shown, and changed, above the steps. */}
      {edit ? null : (
      <>
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
      </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ funding

/** An icon per funding choice, keyed by the option's value; a value with none shows no tile. */
const CHOICE_ICON: Record<string, { icon: LucideIcon; tone: Tone }> = {
  paper: { icon: FlaskConical, tone: "plain" },
  fund: { icon: CircleDollarSign, tone: "blue" },
};

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
    <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
      {options.map((option) => {
        const active = option.value === value;
        const look = CHOICE_ICON[option.value];
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(CHOICE_CARD, active ? CHOICE_ON : CHOICE_OFF)}
          >
            <span className="flex items-center gap-2.5">
              {look ? (
                <IconTile tone={look.tone}>
                  <look.icon strokeWidth={2} />
                </IconTile>
              ) : null}
              <span className={cn(TYPE.heading, "min-w-0 flex-1")}>{option.label}</span>
              <Mark on={active} />
            </span>
            <span className="tnum block text-[13px] leading-5 text-muted-foreground">{option.hint}</span>
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
  /**
   * What is typed in each split box. Kept as text for the same reason as the custom
   * amount: a box that re-renders the parsed number turns "7." into "7" before the "5"
   * arrives, and an emptied box into "0".
   */
  const [legText, setLegText] = useState<Partial<Record<Chain, string>>>({});

  const { plan, cash, wallets, loading } = useFundingPlan({
    mode: funding.mode,
    amountUsd: funding.amountUsd,
    chains,
    split: funding.split,
  });

  const patch = (next: Partial<BuilderDraft["funding"]>) =>
    update({ funding: { ...funding, ...next } });

  const setAmount = (amountUsd: number) => patch({ amountUsd, split: null });

  /**
   * A custom split is the amount: what the legs add up to is what gets signed, so the
   * total moves with them. Otherwise the summary, the commit bar and the plan all kept
   * quoting the old figure while a different one waited to be signed.
   */
  const setLeg = (chain: Chain, value: number) => {
    const split: Partial<Record<Chain, number>> = {};
    for (const entry of chains) {
      split[entry] =
        entry === chain ? value : (funding.split?.[entry] ?? plan?.legs.find((l) => l.chain === entry)?.usdc ?? 0);
    }
    const total = Object.values(split).reduce<number>((sum, usdc) => sum + (usdc ?? 0), 0);
    patch({ split, amountUsd: round(total, 2) });
    setCustomAmount("");
  };

  const paper = funding.mode === "paper";
  const presetPressed = !funding.split && FUND_PRESETS.some((preset) => preset === funding.amountUsd);
  // The summary and the commit bar both quote `amountUsd`, so some control on screen has
  // to show it too. A restored draft can carry an amount no preset matches, and a custom
  // split sets one; the box shows it rather than sitting empty next to four unpressed buttons.
  const customValue = customAmount !== "" || presetPressed ? customAmount : String(funding.amountUsd);
  const customError =
    customLeft && customAmount !== "" && !(Number(customAmount) >= MIN_FUND_USD)
      ? `Enter an amount of at least ${formatUsd(MIN_FUND_USD)}.`
      : null;

  return (
    <div className="space-y-4">
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
        // An aside, not a third choice: no box, so only the two cards above look tappable.
        <div className="flex gap-2.5">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-[13px] leading-5 font-medium">Paper agents skip funding</p>
            <p className="mt-0.5 max-w-[60ch] text-[13px] leading-5 text-muted-foreground">
              Its wallets are still created, and they stay empty until you put something in them.
              When the record convinces you, fund it from its settings page and switch to live —
              nothing here is a one-way door.
            </p>
          </div>
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
                      <span className="tnum">{formatUsd(shownUsdc(chainCash.usdcUsd))}</span>
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
                      setLegText({});
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
                    setLegText({});
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
                          value={legText[chain] ?? (leg ? String(leg.usdc) : "")}
                          inputMode="decimal"
                          onChange={(event) => {
                            const next = event.target.value.replace(/[^0-9.]/g, "");
                            // One decimal point, the same rule as the custom amount above.
                            if (next.split(".").length > 2) return;
                            setLegText((current) => ({ ...current, [chain]: next }));
                            setLeg(chain, Number(next) || 0);
                          }}
                          className="tnum h-9 w-24 font-mono"
                        />
                      </div>
                    </div>
                  );
                })}
                {funding.split ? (
                  <p className="tnum text-right text-xs text-muted-foreground">
                    Total <span className="font-mono text-foreground">{formatUsd(funding.amountUsd)}</span> USDC
                  </p>
                ) : null}
                {funding.split ? (
                  <button
                    type="button"
                    onClick={() => {
                      setLegText({});
                      patch({ split: null });
                    }}
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
