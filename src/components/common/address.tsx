"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { truncateAddress } from "./format";

export function useCopy(resetMs = 1_600) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), resetMs);
    return () => window.clearTimeout(id);
  }, [copied, resetMs]);

  const copy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, []);

  return { copied, copy };
}

/**
 * A wallet address is a thing people copy, not a thing people read. The truncated
 * form is mono so the visible characters line up between rows, and the whole
 * control is the copy target.
 */
export function Address({
  address,
  className,
  lead = 6,
  tail = 6,
  label,
}: {
  address: string;
  className?: string;
  lead?: number;
  tail?: number;
  label?: string;
}) {
  const { copied, copy } = useCopy();

  return (
    <button
      type="button"
      onClick={() => void copy(address)}
      aria-label={`Copy ${label ?? "address"} ${address}`}
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 font-mono text-xs text-muted-foreground",
        "transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
        "hover:border-border hover:bg-muted/60 hover:text-foreground active:scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <span className="tnum">{truncateAddress(address, lead, tail)}</span>
      {copied ? (
        <Check aria-hidden className="size-3 text-positive" />
      ) : (
        <Copy aria-hidden className="size-3 opacity-50 group-hover:opacity-100" />
      )}
      <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
