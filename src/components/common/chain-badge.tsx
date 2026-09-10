import { cn } from "@/lib/utils";
import type { Chain } from "@/server/types";

const CHAIN_LABEL: Record<Chain, string> = {
  solana: "Solana",
  base: "Base",
};

export function chainLabel(chain: Chain): string {
  return CHAIN_LABEL[chain];
}

export function ChainBadge({ chain, className }: { chain: Chain; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          chain === "solana" ? "bg-[oklch(0.75_0.17_160)]" : "bg-[oklch(0.68_0.16_255)]",
        )}
      />
      {CHAIN_LABEL[chain]}
    </span>
  );
}
