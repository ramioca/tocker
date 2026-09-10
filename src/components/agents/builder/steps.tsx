"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, KeyRound, Plus, Shuffle, X } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_MODELS } from "@/lib/agent/config";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { ChainBadge } from "@/components/common/chain-badge";
import { ModeBadge } from "@/components/common/mode-badge";
import { formatUsd } from "@/components/common/format";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { addLlmKeyAction } from "@/components/agents/agent-actions";
import { Field, RiskSlider, StepHeading, Toggle } from "./field";
import { SimpleSelect } from "./simple-select";
import {
  AVATAR_SEEDS,
  INTERVAL_PRESETS,
  PAPER_BALANCES,
  STRATEGY_PRESETS,
  type BuilderDraft,
} from "./types";
import { cn } from "@/lib/utils";
import type { Chain, DataSourceInfo, LlmKeyRow } from "@/server/types";

export interface StepProps {
  draft: BuilderDraft;
  update: (patch: Partial<BuilderDraft>) => void;
  updateConfig: (patch: Partial<BuilderDraft["config"]>) => void;
  errors: Record<string, string>;
}

export interface PopularToken {
  chain: Chain;
  address: string;
  symbol: string;
  name: string | null;
}

// ------------------------------------------------------------------ identity

export function IdentityStep({ draft, update, errors }: StepProps) {
  return (
    <div className="space-y-5">
      <StepHeading
        title="Give it a name"
        blurb="This is what shows up in the feed above every trade it makes, so make it something you would follow."
      />

      <Field label="Name" htmlFor="agent-name" error={errors.name}>
        <Input
          id="agent-name"
          value={draft.name}
          maxLength={48}
          placeholder="Momentum Mike"
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

      <div className="grid gap-2 sm:grid-cols-2">
        <Toggle
          id="agent-public"
          label="Public"
          description="Anyone can see its trades, PnL and reasoning. Your API key and wallets stay private either way."
          checked={draft.isPublic}
          onChange={(isPublic) => update({ isPublic })}
        />
        <Toggle
          id="agent-forkable"
          label="Forkable"
          description="Others can copy the config into their own account. They do not get your key or your wallet."
          checked={draft.isForkable}
          onChange={(isForkable) => update({ isForkable })}
          disabled={!draft.isPublic}
        />
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- brain

function AddKeyInline({ onAdded }: { onAdded: (key: LlmKeyRow) => void }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<"anthropic" | "openai" | "openrouter">("anthropic");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus aria-hidden className="size-3.5" />
        Add a key
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card/40 p-3">
      <div className="flex items-center gap-2">
        <KeyRound aria-hidden className="size-3.5 text-muted-foreground" />
        <p className="text-xs font-medium">New API key</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="ml-auto rounded p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>

      <SimpleSelect
        value={provider}
        onChange={(next) => setProvider(next as typeof provider)}
        options={[
          { value: "anthropic", label: "Anthropic" },
          { value: "openai", label: "OpenAI" },
          { value: "openrouter", label: "OpenRouter" },
        ]}
      />
      <Input
        type="password"
        value={value}
        placeholder="sk-…"
        autoComplete="off"
        onChange={(event) => setValue(event.target.value)}
      />
      <Input
        value={label}
        placeholder="Label (optional)"
        onChange={(event) => setLabel(event.target.value)}
      />
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Encrypted at rest and decrypted only inside the run loop. It never reaches the browser again.
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

export function BrainStep({
  draft,
  update,
  updateConfig,
  errors,
  llmKeys,
  onKeyAdded,
}: StepProps & { llmKeys: LlmKeyRow[]; onKeyAdded: (key: LlmKeyRow) => void }) {
  const provider = draft.config.llm.provider;
  const models = DEFAULT_MODELS[provider];
  const keysForProvider = llmKeys.filter((key) => key.provider === provider);

  return (
    <div className="space-y-5">
      <StepHeading
        title="Pick its brain"
        blurb="You bring the API key; the agent burns your tokens, not ours. Pick a model that can hold a thesis over a dozen tool calls."
      />

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

      <Field label="API key" error={errors.llmKeyId}>
        <div className="space-y-2">
          {keysForProvider.length > 0 ? (
            <SimpleSelect
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
            onAdded={(key) => {
              onKeyAdded(key);
              update({ llmKeyId: key.id });
            }}
          />
        </div>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
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
          min={2}
          max={40}
          format={(value) => String(Math.round(value))}
          meaning={`Up to ${Math.round(draft.config.llm.maxSteps)} tool calls before the run is cut off. More steps means deeper research and a bigger token bill.`}
          onChange={(maxSteps) =>
            updateConfig({ llm: { ...draft.config.llm, maxSteps: Math.round(maxSteps) } })
          }
        />
      </div>

      <Field
        label="Strategy"
        htmlFor="strategy-prompt"
        error={errors.strategyPrompt}
        hint="This is the system prompt. Be specific about entries, exits and what it must never do."
      >
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {STRATEGY_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() =>
                  updateConfig({
                    strategyPrompt: preset.prompt,
                    chains: preset.chains,
                    dataSources: preset.dataSources,
                  })
                }
                title={preset.blurb}
                className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <Textarea
            id="strategy-prompt"
            value={draft.config.strategyPrompt}
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

  const toggle = (id: string) => {
    const next = selected.has(id)
      ? draft.config.dataSources.filter((value) => value !== id)
      : [...draft.config.dataSources, id];
    if (next.length > 12) {
      toast.error("Twelve sources is the cap", {
        description: "More than that and a single run costs more than most trades make.",
      });
      return;
    }
    updateConfig({ dataSources: next });
  };

  return (
    <div className="space-y-5">
      <StepHeading
        title="What it gets to see"
        blurb="Each source is a paid API the agent calls over x402, from its own wallet. It pays per request, so every source you add is a recurring cost."
      />

      <div className="grid gap-2 sm:grid-cols-2">
        {sources.map((source) => {
          const active = selected.has(source.id);
          return (
            <button
              key={source.id}
              type="button"
              role="checkbox"
              aria-checked={active}
              onClick={() => toggle(source.id)}
              className={cn(
                "flex flex-col gap-1.5 rounded-xl border p-3 text-left",
                "transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.99]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary/50 bg-primary/8"
                  : "border-border/70 bg-card/30 hover:border-border hover:bg-card/60",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium">{source.name}</span>
                {active ? (
                  <Check aria-hidden className="size-3.5 text-primary" />
                ) : null}
                <span className="tnum ml-auto font-mono text-[11px] text-muted-foreground">
                  {source.priceUsd === null ? "dynamic" : `$${source.priceUsd.toFixed(3)}`}
                </span>
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {source.description}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="rounded border border-border bg-muted/40 px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                  {source.network}
                </span>
                <span className="rounded border border-border bg-muted/40 px-1.5 py-px text-[10px] capitalize text-muted-foreground">
                  {source.category}
                </span>
                {source.experimental ? (
                  <span className="rounded border border-border px-1.5 py-px text-[10px] uppercase text-muted-foreground">
                    experimental
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

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

// ------------------------------------------------------------ chains & tokens

export function ChainsStep({
  draft,
  updateConfig,
  errors,
  popularTokens,
}: StepProps & { popularTokens: PopularToken[] }) {
  const [symbol, setSymbol] = useState("");
  const [address, setAddress] = useState("");
  const chains = draft.config.chains;
  const allowlist = draft.config.tokenAllowlist;

  const toggleChain = (chain: Chain) => {
    const next = chains.includes(chain)
      ? chains.filter((value) => value !== chain)
      : [...chains, chain];
    updateConfig({
      chains: next,
      tokenAllowlist: allowlist.filter((token) => next.includes(token.chain)),
    });
  };

  const add = (token: { chain: Chain; address: string; symbol: string }) => {
    if (allowlist.some((entry) => entry.chain === token.chain && entry.address === token.address)) {
      return;
    }
    if (allowlist.length >= 50) {
      toast.error("Fifty tokens is the cap");
      return;
    }
    updateConfig({ tokenAllowlist: [...allowlist, token] });
  };

  const remove = (chain: Chain, tokenAddress: string) => {
    updateConfig({
      tokenAllowlist: allowlist.filter(
        (entry) => !(entry.chain === chain && entry.address === tokenAddress),
      ),
    });
  };

  return (
    <div className="space-y-5">
      <StepHeading
        title="Where it can trade"
        blurb="An empty allowlist means the agent may trade anything its data sources surface. That is more freedom than most strategies deserve."
      />

      <Field label="Chains" error={errors.chains}>
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

      <Field
        label="Token allowlist"
        hint={
          allowlist.length === 0
            ? "Empty — the agent may trade any token its data sources surface."
            : `${allowlist.length} token${allowlist.length === 1 ? "" : "s"}. Nothing else can be bought.`
        }
      >
        <div className="space-y-3">
          {allowlist.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {allowlist.map((token) => (
                <li key={`${token.chain}:${token.address}`}>
                  <button
                    type="button"
                    onClick={() => remove(token.chain, token.address)}
                    className="group inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 py-1 pl-2.5 pr-1.5 text-xs transition-colors duration-150 hover:border-destructive/40 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="font-medium">{token.symbol}</span>
                    <span className="text-[10px] text-muted-foreground">{token.chain}</span>
                    <X aria-hidden className="size-3 opacity-50 group-hover:opacity-100" />
                    <span className="sr-only">Remove {token.symbol}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Quick add</p>
            <ul className="flex flex-wrap gap-1.5">
              {popularTokens
                .filter((token) => chains.includes(token.chain))
                .filter(
                  (token) =>
                    !allowlist.some(
                      (entry) => entry.chain === token.chain && entry.address === token.address,
                    ),
                )
                .map((token) => (
                  <li key={`${token.chain}:${token.address}`}>
                    <button
                      type="button"
                      onClick={() =>
                        add({ chain: token.chain, address: token.address, symbol: token.symbol })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Plus aria-hidden className="size-3" />
                      {token.symbol}
                    </button>
                  </li>
                ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="w-24">
              <label htmlFor="token-symbol" className="mb-1 block text-xs text-muted-foreground">
                Symbol
              </label>
              <Input
                id="token-symbol"
                value={symbol}
                maxLength={16}
                placeholder="WIF"
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              />
            </div>
            <div className="min-w-0 flex-1">
              <label htmlFor="token-address" className="mb-1 block text-xs text-muted-foreground">
                Mint or contract address
              </label>
              <Input
                id="token-address"
                value={address}
                placeholder="EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"
                onChange={(event) => setAddress(event.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <button
              type="button"
              disabled={symbol.length === 0 || address.length < 3 || chains.length === 0}
              onClick={() => {
                add({ chain: chains[0], address: address.trim(), symbol: symbol.trim() });
                setSymbol("");
                setAddress("");
              }}
              className="h-9 rounded-lg border border-border px-3 text-xs transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Add
            </button>
          </div>
        </div>
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------- risk

export function RiskStep({ draft, updateConfig }: StepProps) {
  const risk = draft.config.risk;
  const patch = (next: Partial<typeof risk>) => updateConfig({ risk: { ...risk, ...next } });

  return (
    <div className="space-y-4">
      <StepHeading
        title="The rules it cannot break"
        blurb="These are enforced in code before any trade reaches a chain. The model does not get a vote."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <RiskSlider
          id="risk-max-trade"
          label="Max per trade"
          value={risk.maxTradeUsd}
          min={10}
          max={5_000}
          step={10}
          format={(value) => formatUsd(value)}
          meaning={`A single trade can never move more than ${formatUsd(risk.maxTradeUsd)}, whatever the model asks for.`}
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
            risk.maxPositionPct >= 50
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
          id="risk-stop-loss"
          label="Stop loss"
          value={risk.stopLossPct ?? 0}
          min={0}
          max={90}
          format={(value) => (value === 0 ? "Off" : `−${Math.round(value)}%`)}
          meaning={
            (risk.stopLossPct ?? 0) === 0
              ? "No automatic stop. The strategy prompt is the only thing standing between you and a full drawdown."
              : `A position is closed once it is ${Math.round(risk.stopLossPct ?? 0)}% below entry.`
          }
          onChange={(value) => patch({ stopLossPct: value === 0 ? null : Math.round(value) })}
        />

        <RiskSlider
          id="risk-take-profit"
          label="Take profit"
          value={risk.takeProfitPct ?? 0}
          min={0}
          max={300}
          format={(value) => (value === 0 ? "Off" : `+${Math.round(value)}%`)}
          meaning={
            (risk.takeProfitPct ?? 0) === 0
              ? "Winners run until the strategy says otherwise."
              : `Half the reason to hold is gone at +${Math.round(risk.takeProfitPct ?? 0)}% — the position closes there.`
          }
          onChange={(value) => patch({ takeProfitPct: value === 0 ? null : Math.round(value) })}
        />

        <RiskSlider
          id="risk-slippage"
          label="Slippage tolerance"
          value={risk.slippageBps}
          min={10}
          max={2_000}
          step={10}
          format={(value) => `${Math.round(value)} bps`}
          meaning={`Orders are rejected if the fill would be worse than ${(risk.slippageBps / 100).toFixed(2)}% off the quote. Thin memecoins usually need more than 100 bps.`}
          onChange={(slippageBps) => patch({ slippageBps: Math.round(slippageBps) })}
        />
      </div>
    </div>
  );
}

// ----------------------------------------------------------- schedule & mode

export function ScheduleStep({ draft, update, updateConfig }: StepProps) {
  return (
    <div className="space-y-5">
      <StepHeading
        title="How often it wakes up"
        blurb="Every tick costs LLM tokens and data credits whether it trades or not. Slower is usually smarter."
      />

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

      <div className="rounded-xl border border-border/70 bg-card/30 p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          Mode
          <ModeBadge mode="paper" />
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Every agent starts on paper. Going live needs a funded wallet and a deliberate
          hold-to-confirm, so you will do it from settings once the agent has a track record worth
          risking money on.
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
