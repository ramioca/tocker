/**
 * Chain + model + mode chips. Small, monochrome, never green/red.
 * OWNER: ui-social — dedupe with UI-CORE's equivalent at merge if one exists.
 */
import { knownModelLabel } from "@/lib/agent/models";
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
 * The builder's own name for a model ("GPT-5 mini", "Claude Haiku 4.5"). The chip is
 * small, so the vendor OpenRouter puts in front of a name ("Anthropic: Claude Sonnet 5")
 * is dropped: the model is what the chip is for. Only an id the builder does not list
 * falls back to prettifying the raw id.
 */
export function modelLabel(model: string): string {
  const known = knownModelLabel(model);
  if (known) return known.replace(/^[^:]{1,24}:\s+/, "");
  const bare = model.includes("/") ? model.split("/").slice(1).join("/") : model;
  return bare.replace(/-\d{8}$/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
