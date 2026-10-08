"use client";

import { useState } from "react";
import { Check, Plus, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import type { Chain } from "@/server/types";
import { AnimatedSwitch } from "@/components/spectrumui/animated-switch";
import { Input } from "@/components/ui/input";
import { ChainBadge } from "@/components/common/chain-badge";
import { addressProblemForChain } from "@/lib/wallet-address";
import { chainLabelFor } from "@/lib/wallets/funding";
import { ScoreBadge, VerdictScale } from "@/components/tokens/score-badge";
import {
  VERDICT_META,
  formatCompactUsd,
  formatHours,
  formatMinutes,
  verdictForScore,
  verdictTint,
} from "@/components/tokens";
import { cn } from "@/lib/utils";
import { Field } from "./field";
import { Module, ModuleAction } from "./module";
import {
  HOLDER_LADDER,
  LIQUIDITY_LADDER,
  MAX_AGE_LADDER,
  MIN_AGE_LADDER,
  SPECS,
} from "./module-specs";
import { SimpleSelect } from "./simple-select";
import { sayCount, sayHours, sayMinutes, sayUsd } from "./typed-value";
import {
  DISCOVERY_FEEDS,
  UNIVERSE_PRESETS,
  missingFeedSource,
  type BlocklistEntry,
  type DiscoveryFeedId,
  type UniverseConfig,
} from "./types";
import { compareToBalanced, universeSentence } from "./universe-copy";

// The sentences that read the universe back live in a file with no React in it, so a
// server component or a test can import them without the controls.
export { compareToBalanced, universeSentence, universeSummary } from "./universe-copy";

function listSentence(items: string[]): string {
  if (items.length === 0) return "nothing";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Feeds are a set: the order they were switched on in changes nothing. */
function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((entry) => b.includes(entry));
}

/** The amber the authority switches warn in. */
const FEED_WARN_COLOR = "oklch(0.72 0.145 75)";

// -------------------------------------------------------------- the control

export function UniverseControls({
  chains,
  universe,
  onChains,
  onUniverse,
  dataSources,
  errors = {},
  idPrefix = "universe",
  className,
}: {
  chains: Chain[];
  universe: UniverseConfig;
  onChains: (chains: Chain[]) => void;
  onUniverse: (patch: Partial<UniverseConfig>) => void;
  /**
   * The agent's paid sources, when the caller knows them. A feed that buys from a source
   * (the smart money board) says so on its card while that source is off.
   */
  dataSources?: readonly string[];
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
      return Array.isArray(a) && Array.isArray(b) ? sameSet<unknown>(a, b) : a === b;
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
        hint="Every feed runs on each tick, and only what they surface can ever be scored. All of them are free except the paid launch radar and the smart money board, which are billed to the data budget."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {DISCOVERY_FEEDS.map((feed) => {
            const active = universe.discovery.includes(feed.id);
            // On, and the source it buys from is off: it would find nothing, silently.
            const sourceOff = active && dataSources !== undefined ? missingFeedSource(feed, dataSources) : null;
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
                <span className="text-[11px] leading-relaxed text-muted-foreground">
                  {feed.caveat}
                </span>
                {sourceOff ? (
                  <span className="flex gap-1.5 text-[11px] leading-relaxed" style={{ color: FEED_WARN_COLOR }}>
                    <ShieldAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                    <span>
                      {sourceOff} is off, so this feed finds nothing and costs nothing. Switch the
                      source on under Data it buys.
                    </span>
                  </span>
                ) : null}
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

        <Module
          id={id("min-score")}
          label="Minimum score"
          size="hero"
          spec={SPECS.minScore}
          value={universe.minScore}
          slider={{ min: 0, max: 100, step: 1 }}
          tint={{
            borderColor: verdictTint(verdictMeta.color, 30),
            backgroundColor: verdictTint(verdictMeta.color, 6),
          }}
          valueColor={verdictMeta.color}
          badge={<ScoreBadge total={universe.minScore} verdict={verdict} size="sm" />}
          footer={<VerdictScale active={verdict} className="mt-3" />}
          meaning={
            <>
              {Math.round(universe.minScore)} = {verdictMeta.label.toLowerCase()}.{" "}
              {verdictMeta.meaning}
            </>
          }
          onChange={(minScore) => {
            if (minScore !== null) onUniverse({ minScore });
          }}
        />

        {/* Liquidity, holders and age are log-ish: the difference between $1k and $5k
            matters far more than between $500k and $600k. A linear slider over those
            ranges is a lie, so each one moves along a ladder of numbers a trader would
            actually type; the value box takes anything in between. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Module
            id={id("min-liquidity")}
            label="Minimum liquidity"
            spec={SPECS.minLiquidityUsd}
            slider={{ ladder: LIQUIDITY_LADDER }}
            value={universe.minLiquidityUsd}
            meaning={`Below ${sayUsd(universe.minLiquidityUsd)} of pooled depth the agent will not look. Your exit is only as good as this number.`}
            onChange={(minLiquidityUsd) => {
              if (minLiquidityUsd !== null) onUniverse({ minLiquidityUsd });
            }}
          />

          <Module
            id={id("min-holders")}
            label="Minimum holders"
            spec={SPECS.minHolderCount}
            slider={{ ladder: HOLDER_LADDER }}
            value={universe.minHolderCount}
            meaning={
              universe.minHolderCount === 0
                ? "No floor. A token held by four wallets is still on the table."
                : `Fewer than ${sayCount(universe.minHolderCount)} wallets holding means nobody has arrived yet.`
            }
            onChange={(minHolderCount) => {
              if (minHolderCount !== null) onUniverse({ minHolderCount });
            }}
          />

          <Module
            id={id("min-age")}
            label="Minimum age"
            spec={SPECS.minAgeMinutes}
            slider={{ ladder: MIN_AGE_LADDER }}
            value={universe.minAgeMinutes}
            meaning={
              universe.minAgeMinutes === 0
                ? "It may buy a token seconds after the pool opens. That is the rug window."
                : `The cheapest rug filter there is: most snipe-and-dumps are over inside ${sayMinutes(universe.minAgeMinutes)}.`
            }
            onChange={(minAgeMinutes) => {
              if (minAgeMinutes !== null) onUniverse({ minAgeMinutes });
            }}
          />

          <Module
            id={id("max-age")}
            label="Maximum age"
            spec={SPECS.maxAgeHours}
            slider={{ ladder: MAX_AGE_LADDER }}
            // null is "Any age": the value box says so and stays typable, and the thumb
            // parks at 72h with the slider off.
            value={universe.maxAgeHours}
            sliderRest={72}
            sliderOff={universe.maxAgeHours === null}
            meaning={
              universe.maxAgeHours === null
                ? "No ceiling — a token from 2021 is as eligible as one from this morning."
                : `Anything older than ${sayHours(universe.maxAgeHours)} is ignored, however well it scores. This is how you hunt only fresh launches.`
            }
            onChange={(maxAgeHours) => onUniverse({ maxAgeHours })}
            action={
              <ModuleAction
                pressed={universe.maxAgeHours === null}
                onClick={() => onUniverse({ maxAgeHours: universe.maxAgeHours === null ? 72 : null })}
              >
                Any age
              </ModuleAction>
            }
          />

          <Module
            id={id("top10")}
            label="Top-10 wallet share"
            spec={SPECS.maxTop10HolderPct}
            slider={{ min: 5, max: 100, step: 1 }}
            value={universe.maxTop10HolderPct}
            meaning={`Refuse anything where the ten biggest wallets hold more than ${Math.round(universe.maxTop10HolderPct)}% of supply — they can end the token in one transaction.`}
            onChange={(maxTop10HolderPct) => {
              if (maxTop10HolderPct !== null) onUniverse({ maxTop10HolderPct });
            }}
          />

          <Module
            id={id("buy-tax")}
            label="Maximum buy tax"
            spec={SPECS.maxBuyTaxPct}
            slider={{ min: 0, max: 25, step: 1 }}
            value={universe.maxBuyTaxPct}
            // Off without Base. The label and the sentence stay at full contrast: they
            // are what says why.
            inactive={!baseEnabled}
            badge={
              baseEnabled ? null : (
                <span className="rounded-md border border-white/[0.12] px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">
                  Base only
                </span>
              )
            }
            meaning={
              baseEnabled
                ? `A Base token that charges more than ${Math.round(universe.maxBuyTaxPct)}% to buy is skipped. Solana has no transfer tax, so this only bites on Base.`
                : "Base only — Solana tokens have no transfer tax, so this gate does nothing until you turn Base on."
            }
            onChange={(maxBuyTaxPct) => {
              if (maxBuyTaxPct !== null) onUniverse({ maxBuyTaxPct });
            }}
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
            .{comparison.feedsDiffer ? " It sweeps different feeds, too." : null}
          </p>
        ) : comparison.feedsDiffer ? (
          <p className="mt-2 text-xs text-muted-foreground">Same bar as Balanced, different feeds.</p>
        ) : activePreset?.id === "balanced" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            This is exactly the Balanced default.
          </p>
        ) : null}

        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
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
  const [addressError, setAddressError] = useState<string | null>(null);
  const addressErrorId = `${idPrefix}-block-address-error`;

  const add = () => {
    const trimmedAddress = address.trim();
    const trimmedSymbol = symbol.trim().toUpperCase();
    if (trimmedSymbol.length === 0 || trimmedAddress.length < 3) return;
    // A block matches on the address, so one that is not a real address on this chain
    // blocks nothing while the summary counts it as "1 blocked".
    const problem = addressProblemForChain(chain, trimmedAddress);
    if (problem) {
      setAddressError(problem);
      return;
    }
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
                  <span className="text-[10px] text-muted-foreground">{chainLabelFor(entry.chain)}</span>
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

        {/* On a phone the address gets a line of its own: squeezed beside Symbol and Block
            it showed ~12 of a mint's 44 characters, too few to check before blocking. */}
        <div className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
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
                onChange={(next) => {
                  setChain(next as Chain);
                  setAddressError(null);
                }}
                options={chains.map((entry) => ({
                  value: entry,
                  label: entry === "solana" ? "Solana" : "Base",
                }))}
              />
            </div>
          ) : null}

          <div className="min-w-24 flex-1 sm:w-24 sm:flex-none">
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
              placeholder="e.g. RUG"
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            />
          </div>

          <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
            <label
              htmlFor={`${idPrefix}-block-address`}
              className="mb-1 block text-xs text-muted-foreground"
            >
              Mint or contract address
            </label>
            <Input
              id={`${idPrefix}-block-address`}
              value={address}
              placeholder={chain === "solana" ? "Paste a mint address" : "0x…"}
              aria-invalid={Boolean(addressError) || undefined}
              aria-describedby={addressError ? addressErrorId : undefined}
              className="font-mono"
              onChange={(event) => {
                setAddress(event.target.value);
                setAddressError(null);
              }}
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
              "inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs sm:w-auto",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "hover:bg-muted active:scale-[0.97] disabled:opacity-40",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Plus aria-hidden className="size-3.5" />
            Block
          </button>
        </div>
        {/* Under the row rather than inside the address column, which would push the
            bottom-aligned Block button down with it. */}
        {addressError ? (
          <p id={addressErrorId} role="alert" className="-mt-1 text-xs text-destructive">
            {addressError}
          </p>
        ) : null}
      </div>
    </Field>
  );
}
