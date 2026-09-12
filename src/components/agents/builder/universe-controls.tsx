"use client";

import { useState } from "react";
import { Check, Plus, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import type { Chain } from "@/server/types";
import { AnimatedSwitch } from "@/components/spectrumui/animated-switch";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ChainBadge } from "@/components/common/chain-badge";
import { ScoreBadge, VerdictScale } from "@/components/tokens/score-badge";
import {
  VERDICT_META,
  formatCompactUsd,
  formatHolders,
  formatHours,
  formatMinutes,
  verdictForScore,
  verdictTint,
} from "@/components/tokens";
import { cn } from "@/lib/utils";
import { Field } from "./field";
import { SimpleSelect } from "./simple-select";
import {
  DISCOVERY_FEEDS,
  UNIVERSE_PRESETS,
  type BlocklistEntry,
  type DiscoveryFeedId,
  type UniverseConfig,
} from "./types";

// --------------------------------------------------------------- ladders

/**
 * Liquidity, holders and age are log-ish: the difference between $1k and $5k
 * matters far more than between $500k and $600k. A linear slider over those
 * ranges is a lie, so each one moves along a ladder of numbers a trader would
 * actually type.
 */
const LIQUIDITY_LADDER = [
  1_000, 2_500, 5_000, 10_000, 15_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000,
];
const HOLDER_LADDER = [0, 25, 50, 100, 150, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 100_000];
const MIN_AGE_LADDER = [0, 5, 15, 30, 60, 120, 360, 720, 1_440, 4_320, 10_080];
const MAX_AGE_LADDER = [1, 6, 12, 24, 72, 168, 720, 2_160, 8_760];

function nearestIndex(ladder: number[], value: number): number {
  let best = 0;
  let bestDelta = Infinity;
  ladder.forEach((entry, index) => {
    const delta = Math.abs(entry - value);
    if (delta < bestDelta) {
      best = index;
      bestDelta = delta;
    }
  });
  return best;
}

/** A slider over a fixed ladder of values, so every stop is a number worth having. */
function LadderSlider({
  id,
  label,
  ladder,
  value,
  format,
  meaning,
  onChange,
  disabled,
  action,
}: {
  id: string;
  label: string;
  ladder: number[];
  value: number;
  format: (value: number) => string;
  meaning: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  action?: React.ReactNode;
}) {
  const index = nearestIndex(ladder, value);
  return (
    <GateShell
      id={id}
      label={label}
      display={format(ladder[index])}
      meaning={meaning}
      disabled={disabled}
      action={action}
    >
      <Slider
        id={id}
        value={[index]}
        min={0}
        max={ladder.length - 1}
        step={1}
        disabled={disabled}
        onValueChange={(next) => {
          const first = Array.isArray(next) ? next[0] : next;
          if (typeof first === "number") onChange(ladder[first]);
        }}
      />
    </GateShell>
  );
}

function LinearSlider({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  format,
  meaning,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (value: number) => string;
  meaning: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <GateShell id={id} label={label} display={format(value)} meaning={meaning} disabled={disabled}>
      <Slider
        id={id}
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(next) => {
          const first = Array.isArray(next) ? next[0] : next;
          if (typeof first === "number") onChange(first);
        }}
      />
    </GateShell>
  );
}

/** Shared chrome so every gate reads the same way: name, value, control, sentence. */
function GateShell({
  id,
  label,
  display,
  meaning,
  children,
  disabled,
  action,
}: {
  id: string;
  label: string;
  display: string;
  meaning: string;
  children: React.ReactNode;
  disabled?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-card/30 p-3",
        disabled && "opacity-55",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="flex items-center gap-2">
          <output htmlFor={id} className="tnum font-mono text-sm">
            {display}
          </output>
          {action}
        </span>
      </div>
      {/* No transition on the slider itself — a dragged control must track the
          finger exactly, and 150ms of easing reads as lag. */}
      <div className="mt-3">{children}</div>
      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{meaning}</p>
    </div>
  );
}

// ------------------------------------------------------------- copy helpers

function feedLabel(id: DiscoveryFeedId): string {
  return DISCOVERY_FEEDS.find((feed) => feed.id === id)?.label.toLowerCase() ?? id;
}

function listSentence(items: string[]): string {
  if (items.length === 0) return "nothing";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The whole universe as one sentence. Nothing here is estimated or invented. */
export function universeSentence(universe: UniverseConfig, chains: Chain[]): string {
  const where = listSentence(chains.map((chain) => (chain === "solana" ? "Solana" : "Base")));
  const feeds = listSentence(universe.discovery.map(feedLabel));
  const verdict = VERDICT_META[verdictForScore(universe.minScore)].label.toLowerCase();

  const gates = [
    `at least ${formatCompactUsd(universe.minLiquidityUsd)} of liquidity`,
    universe.minHolderCount > 0 ? `${formatHolders(universe.minHolderCount)} holders or more` : null,
    universe.minAgeMinutes > 0 ? `at least ${formatMinutes(universe.minAgeMinutes)} old` : null,
    universe.maxAgeHours !== null ? `no older than ${formatHours(universe.maxAgeHours)}` : null,
    `top-10 wallets under ${Math.round(universe.maxTop10HolderPct)}%`,
    `buy tax under ${Math.round(universe.maxBuyTaxPct)}%`,
  ].filter((entry): entry is string => entry !== null);

  const authorities =
    universe.requireMintRevoked && universe.requireFreezeRevoked
      ? " Mint and freeze authorities must both be revoked."
      : universe.requireMintRevoked
        ? " The mint authority must be revoked; a live freeze authority is allowed."
        : universe.requireFreezeRevoked
          ? " The freeze authority must be revoked; a live mint authority is allowed."
          : " Live mint and freeze authorities are both allowed — the deployer can print supply or freeze your wallet.";

  const blocked =
    universe.blocklist.length > 0
      ? ` ${universe.blocklist.length} token${universe.blocklist.length === 1 ? " is" : "s are"} blocked outright.`
      : "";

  return `On ${where}, from ${feeds}: buy nothing scoring under ${Math.round(universe.minScore)} — ${verdict} and up — with ${listSentence(gates)}.${authorities}${blocked}`;
}

const BALANCED = UNIVERSE_PRESETS.find((preset) => preset.id === "balanced")!.values;

/**
 * How this bar compares with the shipped default. This is the honest version of
 * "40 tokens a day clear this" — we cannot know the count until the agent has
 * actually swept, and inventing one would be worse than saying nothing.
 */
export function compareToBalanced(universe: UniverseConfig): {
  tighter: string[];
  looser: string[];
} {
  const tighter: string[] = [];
  const looser: string[] = [];

  const note = (label: string, delta: number) => {
    if (delta > 0) tighter.push(label);
    else if (delta < 0) looser.push(label);
  };

  note("score", Math.sign(universe.minScore - BALANCED.minScore));
  note("liquidity", Math.sign(universe.minLiquidityUsd - BALANCED.minLiquidityUsd));
  note("holders", Math.sign(universe.minHolderCount - BALANCED.minHolderCount));
  note("minimum age", Math.sign(universe.minAgeMinutes - BALANCED.minAgeMinutes));
  note("top-10 share", Math.sign(BALANCED.maxTop10HolderPct - universe.maxTop10HolderPct));
  note("buy tax", Math.sign(BALANCED.maxBuyTaxPct - universe.maxBuyTaxPct));
  if (universe.maxAgeHours !== null && BALANCED.maxAgeHours === null) tighter.push("maximum age");
  if (universe.maxAgeHours === null && BALANCED.maxAgeHours !== null) looser.push("maximum age");

  return { tighter, looser };
}

// -------------------------------------------------------------- the control

export function UniverseControls({
  chains,
  universe,
  onChains,
  onUniverse,
  errors = {},
  idPrefix = "universe",
  className,
}: {
  chains: Chain[];
  universe: UniverseConfig;
  onChains: (chains: Chain[]) => void;
  onUniverse: (patch: Partial<UniverseConfig>) => void;
  errors?: Record<string, string>;
  idPrefix?: string;
  className?: string;
}) {
  const id = (suffix: string) => `${idPrefix}-${suffix}`;
  const verdict = verdictForScore(universe.minScore);
  const verdictMeta = VERDICT_META[verdict];
  const baseEnabled = chains.includes("base");

  const activePreset = UNIVERSE_PRESETS.find((preset) =>
    (Object.keys(preset.values) as Array<keyof typeof preset.values>).every((key) => {
      const a = preset.values[key];
      const b = universe[key];
      return Array.isArray(a) && Array.isArray(b)
        ? a.length === b.length && a.every((entry, index) => entry === b[index])
        : a === b;
    }),
  );

  const toggleChain = (chain: Chain) => {
    const next = chains.includes(chain)
      ? chains.filter((value) => value !== chain)
      : [...chains, chain];
    if (next.length === 0) {
      toast.error("It has to trade somewhere", { description: "Keep at least one chain on." });
      return;
    }
    onChains(next);
    onUniverse({ blocklist: universe.blocklist.filter((entry) => next.includes(entry.chain)) });
  };

  const toggleFeed = (feed: DiscoveryFeedId) => {
    const next = universe.discovery.includes(feed)
      ? universe.discovery.filter((value) => value !== feed)
      : [...universe.discovery, feed];
    if (next.length === 0) {
      toast.error("It needs somewhere to look", {
        description: "With no feeds on, the sweep returns nothing and the agent never trades.",
      });
      return;
    }
    onUniverse({ discovery: next });
  };

  const comparison = compareToBalanced(universe);

  return (
    <div className={cn("space-y-6", className)}>
      {/* ---------------------------------------------------------- presets */}
      <Field
        label="Start from a posture"
        hint="Sets everything below in one move. Tune afterwards — nothing is locked."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {UNIVERSE_PRESETS.map((preset) => {
            const active = activePreset?.id === preset.id;
            const implications = [
              `score ${preset.values.minScore}+`,
              `${formatCompactUsd(preset.values.minLiquidityUsd)} liq`,
              preset.values.minAgeMinutes > 0
                ? `${formatMinutes(preset.values.minAgeMinutes)}+ old`
                : "any age",
              preset.values.maxAgeHours === null
                ? null
                : `under ${formatHours(preset.values.maxAgeHours)}`,
            ].filter((entry): entry is string => entry !== null);

            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => onUniverse({ ...preset.values, discovery: [...preset.values.discovery] })}
                className={cn(
                  "flex flex-col gap-1.5 rounded-xl border p-3 text-left",
                  "transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary/50 bg-primary/8"
                    : "border-border/70 bg-card/30 hover:border-border hover:bg-card/60",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{preset.label}</span>
                  {active ? <Check aria-hidden className="size-3.5 text-primary" /> : null}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">{preset.blurb}</span>
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {implications.map((entry) => (
                    <span
                      key={entry}
                      className="tnum rounded border border-border/70 bg-muted/40 px-1.5 py-px font-mono text-[10px] text-muted-foreground"
                    >
                      {entry}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      {/* ----------------------------------------------------------- chains */}
      <Field label="Chains" error={errors.chains} hint="Where it is allowed to look at all.">
        <div className="flex flex-wrap gap-2">
          {(["solana", "base"] as const).map((chain) => {
            const active = chains.includes(chain);
            return (
              <button
                key={chain}
                type="button"
                aria-pressed={active}
                onClick={() => toggleChain(chain)}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                  "transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary/50 bg-primary/8"
                    : "border-border/70 hover:border-border hover:bg-muted/40",
                )}
              >
                <ChainBadge chain={chain} />
                {active ? <Check aria-hidden className="size-3.5 text-primary" /> : null}
              </button>
            );
          })}
        </div>
      </Field>

      {/* -------------------------------------------------------- discovery */}
      <Field
        label="How it finds tokens"
        error={errors.universe}
        hint="Every feed is free and runs on each tick. Only what they surface can ever be scored."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {DISCOVERY_FEEDS.map((feed) => {
            const active = universe.discovery.includes(feed.id);
            return (
              <button
                key={feed.id}
                type="button"
                role="checkbox"
                aria-checked={active}
                onClick={() => toggleFeed(feed.id)}
                className={cn(
                  "flex flex-col gap-1 rounded-xl border p-3 text-left",
                  "transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.99]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary/50 bg-primary/8"
                    : "border-border/70 bg-card/30 hover:border-border hover:bg-card/60",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium">{feed.label}</span>
                  {active ? <Check aria-hidden className="ml-auto size-3.5 text-primary" /> : null}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {feed.description}
                </span>
                <span className="text-[11px] leading-relaxed text-muted-foreground/70">
                  {feed.caveat}
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      {/* ------------------------------------------------------------- bar */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">The bar</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Every token that survives the gates gets a 0-100 composite. This is the number it has
            to beat before your agent is even allowed to consider it.
          </p>
        </div>

        <div
          className="rounded-xl border p-4"
          style={{
            borderColor: verdictTint(verdictMeta.color, 30),
            backgroundColor: verdictTint(verdictMeta.color, 6),
          }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={id("min-score")} className="text-sm font-medium">
              Minimum score
            </label>
            <span className="flex items-baseline gap-2">
              <output
                htmlFor={id("min-score")}
                className="tnum font-mono text-2xl font-semibold"
                style={{ color: verdictMeta.color }}
              >
                {Math.round(universe.minScore)}
              </output>
              <ScoreBadge total={universe.minScore} verdict={verdict} size="sm" />
            </span>
          </div>

          <Slider
            id={id("min-score")}
            className="mt-3"
            value={[universe.minScore]}
            min={0}
            max={100}
            step={1}
            onValueChange={(next) => {
              const first = Array.isArray(next) ? next[0] : next;
              if (typeof first === "number") onUniverse({ minScore: first });
            }}
          />

          <VerdictScale active={verdict} className="mt-3" />

          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
            {Math.round(universe.minScore)} = {verdictMeta.label.toLowerCase()}.{" "}
            {verdictMeta.meaning}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <LadderSlider
            id={id("min-liquidity")}
            label="Minimum liquidity"
            ladder={LIQUIDITY_LADDER}
            value={universe.minLiquidityUsd}
            format={formatCompactUsd}
            meaning={`Below ${formatCompactUsd(universe.minLiquidityUsd)} of pooled depth the agent will not look. Your exit is only as good as this number.`}
            onChange={(minLiquidityUsd) => onUniverse({ minLiquidityUsd })}
          />

          <LadderSlider
            id={id("min-holders")}
            label="Minimum holders"
            ladder={HOLDER_LADDER}
            value={universe.minHolderCount}
            format={(value) => (value === 0 ? "Any" : formatHolders(value))}
            meaning={
              universe.minHolderCount === 0
                ? "No floor. A token held by four wallets is still on the table."
                : `Fewer than ${formatHolders(universe.minHolderCount)} wallets holding means nobody has arrived yet.`
            }
            onChange={(minHolderCount) => onUniverse({ minHolderCount })}
          />

          <LadderSlider
            id={id("min-age")}
            label="Minimum age"
            ladder={MIN_AGE_LADDER}
            value={universe.minAgeMinutes}
            format={(value) => (value === 0 ? "Any" : formatMinutes(value))}
            meaning={
              universe.minAgeMinutes === 0
                ? "It may buy a token seconds after the pool opens. That is the rug window."
                : `The cheapest rug filter there is: most snipe-and-dumps are over inside ${formatMinutes(universe.minAgeMinutes)}.`
            }
            onChange={(minAgeMinutes) => onUniverse({ minAgeMinutes })}
          />

          <LadderSlider
            id={id("max-age")}
            label="Maximum age"
            ladder={MAX_AGE_LADDER}
            value={universe.maxAgeHours ?? 72}
            disabled={universe.maxAgeHours === null}
            format={(value) => formatHours(value)}
            meaning={
              universe.maxAgeHours === null
                ? "No ceiling — a token from 2021 is as eligible as one from this morning."
                : `Anything older than ${formatHours(universe.maxAgeHours)} is ignored, however well it scores. This is how you hunt only fresh launches.`
            }
            onChange={(hours) => onUniverse({ maxAgeHours: hours })}
            action={
              <button
                type="button"
                role="switch"
                aria-checked={universe.maxAgeHours === null}
                onClick={() =>
                  onUniverse({ maxAgeHours: universe.maxAgeHours === null ? 72 : null })
                }
                className={cn(
                  "rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                  "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  universe.maxAgeHours === null
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                Any age
              </button>
            }
          />

          <LinearSlider
            id={id("top10")}
            label="Top-10 wallet share"
            value={universe.maxTop10HolderPct}
            min={5}
            max={100}
            step={1}
            format={(value) => `${Math.round(value)}%`}
            meaning={`Refuse anything where the ten biggest wallets hold more than ${Math.round(universe.maxTop10HolderPct)}% of supply — they can end the token in one transaction.`}
            onChange={(maxTop10HolderPct) => onUniverse({ maxTop10HolderPct })}
          />

          <LinearSlider
            id={id("buy-tax")}
            label="Maximum buy tax"
            value={universe.maxBuyTaxPct}
            min={0}
            max={25}
            step={1}
            format={(value) => `${Math.round(value)}%`}
            meaning={
              baseEnabled
                ? `A Base token that charges more than ${Math.round(universe.maxBuyTaxPct)}% to buy is skipped. Solana has no transfer tax, so this only bites on Base.`
                : "Base only — Solana tokens have no transfer tax, so this gate does nothing until you turn Base on."
            }
            onChange={(maxBuyTaxPct) => onUniverse({ maxBuyTaxPct })}
            disabled={!baseEnabled}
          />
        </div>
      </section>

      {/* ------------------------------------------------- non-negotiables */}
      <Field
        label="Non-negotiables"
        hint="Hard gates. They run before scoring and cannot be outscored by a good number."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <AuthoritySwitch
            id={id("mint-revoked")}
            label="Mint authority must be revoked"
            on="Nobody can print more supply after you buy."
            off="The deployer can mint unlimited supply and sell it into your bid. This is the single most common way people get rugged."
            checked={universe.requireMintRevoked}
            onChange={(requireMintRevoked) => onUniverse({ requireMintRevoked })}
          />
          <AuthoritySwitch
            id={id("freeze-revoked")}
            label="Freeze authority must be revoked"
            on="Nobody can stop the agent selling."
            off="The deployer can freeze the agent's account. It would hold a token it is not allowed to sell."
            checked={universe.requireFreezeRevoked}
            onChange={(requireFreezeRevoked) => onUniverse({ requireFreezeRevoked })}
          />
        </div>
      </Field>

      {/* --------------------------------------------------------- blocklist */}
      <BlocklistEditor
        idPrefix={idPrefix}
        chains={chains}
        blocklist={universe.blocklist}
        onChange={(blocklist) => onUniverse({ blocklist })}
      />

      {/* ------------------------------------------------------ read it back */}
      <section className="rounded-xl border border-border/70 bg-card/40 p-3.5">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          What you just described
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground/85">
          {universeSentence(universe, chains)}
        </p>

        {comparison.tighter.length > 0 || comparison.looser.length > 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Against the Balanced default this bar is
            {comparison.tighter.length > 0 ? (
              <> tighter on {listSentence(comparison.tighter)}</>
            ) : null}
            {comparison.tighter.length > 0 && comparison.looser.length > 0 ? " and" : null}
            {comparison.looser.length > 0 ? (
              <> looser on {listSentence(comparison.looser)}</>
            ) : null}
            .
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            This is exactly the Balanced default.
          </p>
        )}

        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/75">
          How many tokens a day actually clear this depends on the market, so we will not guess.
          The first sweep will tell you, on the agent&rsquo;s page.
        </p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function AuthoritySwitch({
  id,
  label,
  on,
  off,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  on: string;
  off: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const warnColor = "oklch(0.72 0.145 75)";

  return (
    <div
      key={id}
      className={cn(
        "rounded-xl border p-3",
        "transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
      )}
      style={
        checked
          ? undefined
          : { borderColor: verdictTint(warnColor, 45), backgroundColor: verdictTint(warnColor, 7) }
      }
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-snug font-medium">{label}</p>
        {/* Spectrum's switch: a spring and an iOS knob stretch. Turning a hard
            gate off is a rare, consequential change — exactly where physics
            earns its place, and nowhere near a hot path. */}
        <AnimatedSwitch
          size="sm"
          checked={checked}
          onCheckedChange={onChange}
          label={`${label}. ${checked ? on : off}`}
          onIcon={<ShieldCheck />}
          offIcon={<ShieldAlert />}
          className={cn(
            "mt-0.5",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-background dark:focus-visible:ring-ring",
            checked ? "bg-primary dark:bg-primary" : "bg-[oklch(0.72_0.145_75)]/55 dark:bg-[oklch(0.72_0.145_75)]/55",
          )}
        />
      </div>

      <p
        className="mt-1.5 flex gap-1.5 text-xs leading-relaxed"
        style={{ color: checked ? "var(--muted-foreground)" : warnColor }}
      >
        {checked ? null : <ShieldAlert aria-hidden className="mt-px size-3.5 shrink-0" />}
        <span>{checked ? on : off}</span>
      </p>
    </div>
  );
}

function BlocklistEditor({
  idPrefix,
  chains,
  blocklist,
  onChange,
}: {
  idPrefix: string;
  chains: Chain[];
  blocklist: BlocklistEntry[];
  onChange: (blocklist: BlocklistEntry[]) => void;
}) {
  const [symbol, setSymbol] = useState("");
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState<Chain>(chains[0] ?? "solana");

  const add = () => {
    const trimmedAddress = address.trim();
    const trimmedSymbol = symbol.trim().toUpperCase();
    if (trimmedSymbol.length === 0 || trimmedAddress.length < 3) return;
    if (blocklist.some((entry) => entry.chain === chain && entry.address === trimmedAddress)) {
      toast.error(`${trimmedSymbol} is already blocked`);
      return;
    }
    if (blocklist.length >= 200) {
      toast.error("Two hundred is the cap");
      return;
    }
    onChange([...blocklist, { chain, address: trimmedAddress, symbol: trimmedSymbol.slice(0, 16) }]);
    setSymbol("");
    setAddress("");
  };

  return (
    <Field
      label="Blocklist"
      hint="The only list, and it subtracts. Everything else on your chains is fair game if it clears the bar."
    >
      <div className="space-y-3">
        {blocklist.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {blocklist.map((entry) => (
              <li key={`${entry.chain}:${entry.address}`}>
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      blocklist.filter(
                        (other) => !(other.chain === entry.chain && other.address === entry.address),
                      ),
                    )
                  }
                  className={cn(
                    "group inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 py-1 pr-1.5 pl-2.5 text-xs",
                    "transition-colors duration-150 hover:border-destructive/40 hover:bg-destructive/10",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <span className="font-medium">{entry.symbol}</span>
                  <span className="text-[10px] text-muted-foreground">{entry.chain}</span>
                  <X aria-hidden className="size-3 opacity-50 group-hover:opacity-100" />
                  <span className="sr-only">Remove {entry.symbol} from the blocklist</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nothing blocked. Add a token here only when you never want to see it again.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-2">
          {chains.length > 1 ? (
            <div className="w-28">
              <label
                htmlFor={`${idPrefix}-block-chain`}
                className="mb-1 block text-xs text-muted-foreground"
              >
                Chain
              </label>
              <SimpleSelect
                id={`${idPrefix}-block-chain`}
                value={chain}
                onChange={(next) => setChain(next as Chain)}
                options={chains.map((entry) => ({
                  value: entry,
                  label: entry === "solana" ? "Solana" : "Base",
                }))}
              />
            </div>
          ) : null}

          <div className="w-24">
            <label
              htmlFor={`${idPrefix}-block-symbol`}
              className="mb-1 block text-xs text-muted-foreground"
            >
              Symbol
            </label>
            <Input
              id={`${idPrefix}-block-symbol`}
              value={symbol}
              maxLength={16}
              placeholder="SCAM"
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            />
          </div>

          <div className="min-w-0 flex-1">
            <label
              htmlFor={`${idPrefix}-block-address`}
              className="mb-1 block text-xs text-muted-foreground"
            >
              Mint or contract address
            </label>
            <Input
              id={`${idPrefix}-block-address`}
              value={address}
              placeholder="EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"
              className="font-mono text-xs"
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
          </div>

          <button
            type="button"
            onClick={add}
            disabled={symbol.trim().length === 0 || address.trim().length < 3}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "hover:bg-muted active:scale-[0.97] disabled:opacity-40",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Plus aria-hidden className="size-3.5" />
            Block
          </button>
        </div>
      </div>
    </Field>
  );
}
