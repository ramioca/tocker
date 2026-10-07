"use client";

import { AlertTriangle, Coins, KeyRound } from "lucide-react";
import { formatUsd } from "@/components/common/format";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { Field, RiskSlider } from "@/components/agents/builder/field";
import { SPECS } from "@/components/agents/builder/module-specs";
import { providerNames } from "@/components/agents/provider-choice";
import { SimpleSelect } from "@/components/agents/builder/simple-select";
import {
  PAID_STEP_NOT_REFUNDED,
  PAY_PER_USE_DISCLOSURE,
  THINK_SOURCE_LABELS,
  checkUsdc,
  limitCents,
  stopWords,
  suggestedLimits,
  usdcEstimate,
  walletNeedUsd,
  type UsdcSettings,
} from "@/components/agents/thinking";
import {
  MAX_PAID_STEPS,
  PAY_PER_USE_MODELS,
  USDC_DAY_CAP,
  USDC_RUN_CAP,
  WALLET_FLOOR_USD,
  type ThinkSource,
} from "@/lib/x402/inference-types";
import { cn } from "@/lib/utils";

/**
 * How the agent thinks: the owner's own key, or pay per use.
 *
 * Two cards, the key first and marked Recommended, because it is the cheaper way to run
 * and the one most owners should be on; pay-per-use is for someone who has no key. This
 * is rendered only when the server said the viewer may use pay-per-use (or the agent is
 * already on it): without that there is no choice to make, and the forms show the key
 * fields exactly as they did before this existed.
 *
 * The same component in the builder and in the settings form, so the two cannot drift.
 */
export function ThinkSourceChoice({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: ThinkSource;
  onChange: (next: ThinkSource) => void;
}) {
  const options: Array<{ value: ThinkSource; icon: React.ReactNode; hint: string; recommended?: boolean }> = [
    {
      value: "key",
      icon: <KeyRound aria-hidden className="size-3.5" />,
      hint: `The model runs on your own account with ${providerNames()}, and they bill you. Any model, and usually the cheaper way to run.`,
      recommended: true,
    },
    {
      value: "usdc",
      icon: <Coins aria-hidden className="size-3.5" />,
      hint: "No key needed. The agent buys each step of thinking itself, in USDC from its own Solana wallet.",
    },
  ];

  return (
    <div role="group" aria-labelledby={`${idPrefix}-think-source-label`} className="space-y-1.5">
      <p id={`${idPrefix}-think-source-label`} className="text-sm font-medium">
        How it thinks
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              id={`${idPrefix}-think-${option.value}`}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "rounded-xl border p-3 text-left",
                "transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "border-primary/50 bg-primary/8" : "border-border/70 bg-card/30 hover:border-border hover:bg-card/60",
              )}
            >
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                <span className="text-muted-foreground">{option.icon}</span>
                {THINK_SOURCE_LABELS[option.value]}
                {option.recommended ? (
                  <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
                    Recommended
                  </span>
                ) : null}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{option.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One line of the estimate: what it is on the left, the money on the right. */
function EstimateRow({
  label,
  value,
  strong,
  className,
}: {
  label: React.ReactNode;
  value: string;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", className)}>
      <dt className={cn("min-w-0", strong ? null : "text-muted-foreground")}>{label}</dt>
      <dd className={cn("tnum shrink-0 font-mono", strong && "font-medium")}>{value}</dd>
    </div>
  );
}

/**
 * Everything a pay-per-use agent's owner sets and is told: the model, what it is expected
 * to cost at this schedule, the two limits, and what the mode means for their money and
 * their strategy.
 *
 * Nothing here asks the gateway for a price. The figures are estimates from list prices
 * (`usdcEstimate`); the real price of each step is checked against a ceiling at the
 * moment it would be paid, in the run, not on this screen.
 *
 * The limits are the owner's stated maximum, so nothing in here raises one for them. A
 * model or a schedule that no longer fits the limits is said plainly, with one button
 * that sets the suggested pair: a tap, not a side effect.
 */
export function PayPerUsePanel({
  idPrefix,
  usdc,
  intervalMinutes,
  maxSteps,
  chains,
  onChange,
  scheduleMovedFrom = null,
  allowed = true,
  scheduleSection = "Schedule",
}: {
  idPrefix: string;
  usdc: UsdcSettings;
  intervalMinutes: number;
  /** The agent's own steps setting, to say when pay-per-use cuts it short. */
  maxSteps: number;
  chains: readonly string[];
  onChange: (usdc: UsdcSettings) => void;
  /** Set when choosing this mode moved the schedule, so the panel can say so. */
  scheduleMovedFrom?: number | null;
  /** False when the account may not use pay-per-use any more; the agent can still leave it. */
  allowed?: boolean;
  /** What this form calls the place the schedule is set. */
  scheduleSection?: string;
}) {
  const estimate = usdcEstimate(usdc.model, intervalMinutes);
  const check = checkUsdc({ usdc, intervalMinutes, chains });
  const suggested = suggestedLimits(usdc.model, intervalMinutes);
  const offSuggestion = suggested.maxUsdPerRun !== usdc.maxUsdPerRun || suggested.maxUsdPerDay !== usdc.maxUsdPerDay;
  const refusals = [check.errors.chains, check.errors.model, check.errors.maxUsdPerRun, check.errors.maxUsdPerDay].filter(
    (message): message is string => Boolean(message),
  );
  const switchedOff = allowed ? null : stopWords("flag_off");
  const refusalId = `${idPrefix}-usdc-refusal`;

  return (
    <div className="space-y-4">
      {switchedOff ? (
        <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle aria-hidden className="size-4 shrink-0 text-amber-500" />
            {switchedOff.title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{switchedOff.detail}</p>
        </div>
      ) : null}

      <Field
        label="Model"
        htmlFor={`${idPrefix}-usdc-model`}
        hint={estimate.model ? estimate.model.note : "Pick one of the models offered for pay-per-use."}
      >
        <SimpleSelect
          id={`${idPrefix}-usdc-model`}
          value={estimate.model ? usdc.model : null}
          invalid={Boolean(check.errors.model)}
          describedBy={refusals.length > 0 ? refusalId : undefined}
          placeholder="Choose a model"
          options={PAY_PER_USE_MODELS.map((model) => ({
            value: model.id,
            label: model.label,
            hint: `About ${formatUsd(usdcEstimate(model.id, intervalMinutes).runUsd)} a run`,
          }))}
          // The limits are left as they are: a dearer model shows up below as a refusal
          // or a warning, with the suggested limits one tap away.
          onChange={(model) => onChange({ ...usdc, model })}
        />
      </Field>

      {estimate.model ? (
        // The list holds only its two rows; the sentences sit beside it, not inside it.
        <div className="rounded-xl border border-border/70 bg-card/40 px-3 py-2.5 text-sm">
          <dl>
            <EstimateRow label="A typical run" value={`≈${formatUsd(estimate.runUsd)}`} />
            {intervalMinutes > 0 ? (
              <EstimateRow
                strong
                className="mt-2 border-t border-border/60 pt-2"
                label={
                  <>
                    A day at this schedule{" "}
                    <span className="tnum text-xs font-normal text-muted-foreground">
                      ({intervalLabel(intervalMinutes).toLowerCase()}, about {estimate.runsPerDay} run
                      {estimate.runsPerDay === 1 ? "" : "s"})
                    </span>
                  </>
                }
                value={`≈${formatUsd(estimate.dayUsd)}`}
              />
            ) : null}
          </dl>
          {intervalMinutes > 0 ? null : (
            <p className="mt-2 border-t border-border/60 pt-2 text-muted-foreground">
              Manual runs only: nothing is spent until you press Run now.
            </p>
          )}
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            Estimates from list prices, not a quote. The price of each step is checked against a ceiling before it is
            paid, and the two limits below are never passed.
          </p>
        </div>
      ) : null}

      {scheduleMovedFrom !== null ? (
        <p role="status" className="tnum rounded-xl border border-border/70 bg-card/30 px-3 py-2.5 text-xs leading-relaxed">
          The schedule moved from {intervalLabel(scheduleMovedFrom).toLowerCase()} to{" "}
          {intervalLabel(intervalMinutes).toLowerCase()}, because every run now costs money.{" "}
          <span className="text-muted-foreground">Change it under {scheduleSection} if you want it faster.</span>
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <RiskSlider
          id={`${idPrefix}-usdc-run`}
          label="Limit per run"
          value={usdc.maxUsdPerRun}
          min={USDC_RUN_CAP.min}
          max={USDC_RUN_CAP.max}
          step={0.05}
          spec={SPECS.usdcPerRun}
          meaning={
            check.warnings.maxUsdPerRun ??
            `A run that has spent ${formatUsd(usdc.maxUsdPerRun)} on thinking stops there and keeps what it has done.`
          }
          onChange={(maxUsdPerRun) => onChange({ ...usdc, maxUsdPerRun: limitCents(maxUsdPerRun) })}
        />
        <RiskSlider
          id={`${idPrefix}-usdc-day`}
          label="Limit per day"
          value={usdc.maxUsdPerDay}
          min={USDC_DAY_CAP.min}
          max={USDC_DAY_CAP.max}
          step={0.5}
          spec={SPECS.usdcPerDay}
          meaning={`Once it has spent ${formatUsd(usdc.maxUsdPerDay)} on thinking in a day, the agent waits for 00:00 UTC.`}
          onChange={(maxUsdPerDay) => onChange({ ...usdc, maxUsdPerDay: limitCents(maxUsdPerDay) })}
        />
      </div>

      {refusals.length > 0 ? (
        // Always shown, not only after a failed submit: it is the consequence of the
        // model, the schedule and the limits just chosen, and Create or Save is refused
        // while it stands.
        <div id={refusalId} role="alert" className="space-y-2 rounded-xl border border-destructive/25 bg-destructive/8 p-3.5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle aria-hidden className="size-4 shrink-0 text-destructive" />
            This cannot be saved yet
          </p>
          <ul className="space-y-1">
            {refusals.map((message) => (
              <li key={message} className="tnum text-xs leading-relaxed text-muted-foreground">
                {message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {estimate.model && offSuggestion ? (
        <p className="tnum flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
          <span>
            Suggested for this model and schedule: {formatUsd(suggested.maxUsdPerRun)} a run,{" "}
            {formatUsd(suggested.maxUsdPerDay)} a day.
          </span>
          <button
            type="button"
            onClick={() => onChange({ ...usdc, ...suggested })}
            className="inline-flex h-7 items-center rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Use these limits
          </button>
        </p>
      ) : null}

      <div className="rounded-xl border border-border/70 bg-card/30 p-3.5">
        <p className="text-sm font-medium">What this mode means</p>
        <ul className="tnum mt-1.5 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <li>
            Thinking is paid in USDC from this agent&rsquo;s own Solana wallet, straight to the provider. Tocker never
            holds that money. A paper agent pays too: the trades are pretend, the thinking is not.
          </li>
          <li>
            A run starts only when that wallet holds at least {formatUsd(walletNeedUsd(usdc))} of USDC beyond any
            trading fees it owes: the limit per run plus {formatUsd(WALLET_FLOOR_USD)} that is always left in it. On a
            live agent, {formatUsd(2 * usdc.maxUsdPerRun + WALLET_FLOOR_USD)} is set aside from its trading cash (two
            runs&rsquo; worth plus that {formatUsd(WALLET_FLOOR_USD)}), so a buy cannot leave it unable to think.
          </li>
          <li>
            A pay-per-use run takes at most {MAX_PAID_STEPS} steps
            {maxSteps > MAX_PAID_STEPS ? `, not the ${Math.round(maxSteps)} this agent is set to` : ""}.
          </li>
          <li className="text-foreground/85">{PAY_PER_USE_DISCLOSURE}</li>
          <li className="text-foreground/85">{PAID_STEP_NOT_REFUNDED}</li>
        </ul>
      </div>
    </div>
  );
}
