"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { truncateAddress } from "./format";

export function useCopy(resetMs = 1_600) {
  const [copied, setCopied] = useState(false);
  // The clipboard is refused on an insecure origin, with permission denied and in some
  // in-app browsers. A button that just stays "Copy" then looks broken, so the caller
  // gets to say it failed and what to do instead.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied && !failed) return;
    // A failure carries an instruction ("select it instead"), which takes longer to read
    // than a tick does.
    const id = window.setTimeout(
      () => {
        setCopied(false);
        setFailed(false);
      },
      failed ? Math.max(resetMs, 4_000) : resetMs,
    );
    return () => window.clearTimeout(id);
  }, [copied, failed, resetMs]);

  const copy = useCallback(async (value: string) => {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setFailed(false);
      setCopied(true);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  }, []);

  return { copied, failed, copy };
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
  const { copied, failed, copy } = useCopy();
  const what = label ?? "address";

  // A refused clipboard (in-app browsers, a strict Permissions-Policy) used to leave the
  // copy icon in place and say nothing, and whoever was funding an agent pasted whatever
  // was on their clipboard before. The toast is for sight; the status below is for
  // screen readers, which never heard "Copied" either — the button's static label hid it.
  useEffect(() => {
    if (failed) toast.error(`Couldn't copy the ${what}. Select it and copy it by hand.`);
  }, [failed, what]);

  return (
    <>
      <button
        type="button"
        onClick={() => void copy(address)}
        aria-label={`Copy ${what} ${address}`}
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
        ) : failed ? (
          <X aria-hidden className="size-3 text-destructive" />
        ) : (
          <Copy aria-hidden className="size-3 opacity-50 group-hover:opacity-100" />
        )}
      </button>
      {/* A sibling, not a child: `sr-only` takes it out of flow, so a caller's flex row
          or grid cell is unchanged. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? `Copied the ${what}` : failed ? `Couldn't copy the ${what}` : ""}
      </span>
    </>
  );
}

/**
 * The whole address, for the moment before money moves.
 *
 * A truncated `7xKX…pTqL` is exactly what address poisoning forges: the attacker grinds
 * a vanity address with the same first and last characters and plants it in the
 * victim's history. So every confirm step shows every character, in groups of four with
 * alternating weight so the eye can walk it against the source instead of skimming it.
 */
export function FullAddress({ address, className }: { address: string; className?: string }) {
  const groups = address.match(/.{1,4}/g) ?? [];
  return (
    <span className={cn("inline-flex font-mono text-xs leading-relaxed", className)}>
      {/* One click or long-press selects every character — the fallback when the
          clipboard refuses. The groups are inline-blocks spaced by margin, not a flex row
          with a gap: flex items copy out one per line, and a pasted address with nine
          line breaks in it is not the address. */}
      <span className="select-all">
        {/* An aria-label on a plain span is ignored, so the address is real text for a
            screen reader, kept out of the selection so it is not copied twice. */}
        <span className="sr-only select-none">{address}</span>
        {groups.map((group, index) => (
          <span
            key={index}
            aria-hidden
            className={cn(
              "inline-block",
              index < groups.length - 1 && "mr-1",
              index % 2 === 0 ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {group}
          </span>
        ))}
      </span>
    </span>
  );
}
