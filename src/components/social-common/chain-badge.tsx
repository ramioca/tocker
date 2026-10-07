/**
 * Chain + model + mode chips. Small, monochrome, never green/red.
 * OWNER: ui-social — dedupe with UI-CORE's equivalent at merge if one exists.
 */
import { modelNameOnAnyProvider } from "@/lib/agent/models";
import { cn } from "@/lib/utils";
import type { AgentMode, Chain } from "@/server/types";

const CHAIN_META: Record<Chain, { label: string; dot: string }> = {
  solana: { label: "Solana", dot: "oklch(0.75 0.18 155)" },
  base: { label: "Base", dot: "oklch(0.65 0.19 258)" },
};

const chipClass =
  "inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px] leading-4 font-medium text-muted-foreground";

export function ChainBadge({ chain, className }: { chain: Chain; className?: string }) {
  const meta = CHAIN_META[chain];
  return (
    <span className={cn(chipClass, className)}>
      <span aria-hidden className="size-1.5 rounded-full" style={{ background: meta.dot }} />
      {meta.label}
    </span>
  );
}

export function ChainBadges({ chains, className }: { chains: Chain[]; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      {chains.map((c) => (
        <ChainBadge key={c} chain={c} />
      ))}
    </span>
  );
}

/**
 * The words for an id no list names: the last part of its path, without a date, dashes
 * as spaces, each word capitalised and nothing lower-cased ("GLM-5.3-Turbo" stays GLM).
 *
 * The last part and not everything after the first slash, because a host's id can be a
 * path of several ("accounts/fireworks/models/qwen3p8-max") and the chip is for the
 * model, not for where it is filed. Fireworks writes a version's dot as a "p" between
 * two digits, which is read back as a dot for its ids only.
 */
function fromId(model: string): string {
  const parts = model.split("/").filter(Boolean);
  const last = parts.length > 0 ? parts[parts.length - 1] : model;
  const name = model.startsWith("accounts/") ? last.replace(/(\d)p(?=\d)/g, "$1.") : last;
  return name.replace(/-\d{8}$/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A model's name as its provider's list has it ("GPT-5 mini", "Claude Haiku 4.5",
 * "Gemini 3.8 Flash"). The chip is small, so the vendor OpenRouter puts in front of a
 * name ("Anthropic: Claude Sonnet 5") is dropped: the model is what the chip is for.
 * Only an id no list has falls back to words made from the id.
 *
 * A card carries the model and not the provider, so the name is looked for in every
 * enabled provider's list, the three the builder started with first. That is safe for a
 * name where it would not be for a price: GLM-5.3 is GLM-5.3 on whichever host serves
 * it. It is also why a host's path ("accounts/fireworks/models/glm-5p3") or a
 * vendor-prefixed id ("zai-org/GLM-5.3") reads as the model and never as the path.
 */
export function modelLabel(model: string): string {
  const known = modelNameOnAnyProvider(model);
  if (known) return known.replace(/^[^:]{1,24}:\s+/, "");
  return fromId(model);
}

export function ModelChip({ model, className }: { model: string; className?: string }) {
  return (
    <span className={cn(chipClass, "font-mono text-[10px] tracking-tight", className)} title={model}>
      {modelLabel(model)}
    </span>
  );
}

export function ModeBadge({ mode, className }: { mode: AgentMode; className?: string }) {
  return (
    <span
      className={cn(
        chipClass,
        mode === "live" && "border-primary/40 bg-primary/10 text-primary",
        className,
      )}
    >
      {mode === "live" ? "Live" : "Paper"}
    </span>
  );
}
