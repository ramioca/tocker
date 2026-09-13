"use client";

/**
 * The operator's own hands on the book.
 *
 * Two things make this more than a form. First, it previews before it trades: paste a
 * mint, pick a size, and you see the score, the quoted price and the risk guard's
 * verdict *before* there is anything to undo. Second, it is honest about being bound by
 * the agent's own rules — when the guard refuses, the reason is the agent's own
 * threshold quoted back at you, with the fix (change the setting) named.
 *
 * Paper gets a morph button. Live money gets hold-to-confirm: the same gesture as
 * switching an agent to live in the first place, for the same reason.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatUsd } from "@/components/common/format";
import { Field } from "@/components/agents/builder/field";
import { ScoreBadge } from "@/components/tokens";
import { placeManualTrade, previewTrade } from "@/server/actions/trading";
import { cn } from "@/lib/utils";
import type { AgentDetail, Chain, TradePreview } from "@/server/types";

const SIZE_PRESETS = [10, 25, 50, 100, 250] as const;

/** Debounce for the preview: every keystroke would re-score the token otherwise. */
const PREVIEW_DEBOUNCE_MS = 500;

export function ManualTradeSheet({ agent }: { agent: AgentDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [chain, setChain] = useState<Chain>(agent.chains[0] ?? "solana");
  const [tokenAddress, setTokenAddress] = useState("");
  const [amount, setAmount] = useState("25");
  const [note, setNote] = useState("");
  /**
   * The preview is keyed by the exact order it describes, so a stale answer for a
   * previous token can never be shown next to the current one — and nothing has to be
   * cleared synchronously when the inputs change.
   */
  const [result, setResult] = useState<{ key: string; data: TradePreview | null; error: string | null } | null>(null);

  const amountUsd = Number(amount);
  const address = tokenAddress.trim();
  const ready = address.length >= 3 && Number.isFinite(amountUsd) && amountUsd > 0;
  const isLive = agent.mode === "live";
  const key = open && ready ? `${chain}|${side}|${address}|${amountUsd}` : null;

  // Preview whenever the order changes. Free: scoring costs nothing and the quote is
  // the same call the executor would make.
  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const answer = await previewTrade({ agentId: agent.id, chain, side, tokenAddress: address, amountUsd });
      if (cancelled) return;
      setResult(
        answer.ok ? { key, data: answer.data, error: null } : { key, data: null, error: answer.error },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, agent.id, chain, side, address, amountUsd]);

  const current = result !== null && result.key === key ? result : null;
  const preview = current?.data ?? null;
  const previewError = current?.error ?? null;
  const previewing = key !== null && current === null;

  const submit = useCallback(async () => {
    const placed = await placeManualTrade({
      agentId: agent.id,
      chain,
      side,
      tokenAddress: address,
      amountUsd,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!placed.ok) {
      toast.error("Trade not placed", { description: placed.error });
      throw new Error(placed.error);
    }
    toast.success(
      `${placed.data.side === "buy" ? "Bought" : "Sold"} ${formatUsd(placed.data.amountUsd)} of ${placed.data.symbol}`,
      {
        description: `${placed.data.amountToken.toLocaleString("en-US", {
          maximumFractionDigits: 2,
        })} ${placed.data.symbol} at ${formatUsd(placed.data.priceUsd)}${placed.data.isPaper ? " · paper" : ""}`,
      },
    );
    setOpen(false);
    setTokenAddress("");
    setNote("");
    setResult(null);
    router.refresh();
  }, [agent.id, chain, side, address, amountUsd, note, router]);

  const blocked = !ready || previewing || preview === null || !preview.allowed;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "hover:bg-muted active:scale-[0.97]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <ArrowLeftRight aria-hidden className="size-3.5" />
            Trade
          </button>
        }
      />

      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Trade on {agent.name}</SheetTitle>
          <SheetDescription>
            Your order, its book. It still goes through this agent&rsquo;s score, its caps and its
            blocklist — manual means you choose, not that the rules stop applying.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          <div className="grid grid-cols-2 gap-2">
            {(["buy", "sell"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={side === option}
                onClick={() => setSide(option)}
                className={cn(
                  "rounded-lg border py-2 text-sm font-medium capitalize",
                  "transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  side === option
                    ? option === "buy"
                      ? "border-[oklch(0.72_0.17_150)]/50 bg-[oklch(0.72_0.17_150)]/10"
                      : "border-[oklch(0.68_0.2_25)]/50 bg-[oklch(0.68_0.2_25)]/10"
                    : "border-border/70 hover:border-border hover:bg-muted/40",
                )}
              >
                {option}
              </button>
            ))}
          </div>

          {agent.chains.length > 1 ? (
            <Field label="Chain">
              <div className="flex flex-wrap gap-2">
                {agent.chains.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={chain === option}
                    onClick={() => setChain(option)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5",
                      "transition-[border-color,background-color] duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      chain === option ? "border-primary/50 bg-primary/8" : "border-border/70 hover:bg-muted/40",
                    )}
                  >
                    <ChainBadge chain={option} />
                  </button>
                ))}
              </div>
            </Field>
          ) : null}

          <Field
            label="Token"
            htmlFor="manual-token"
            hint={
              chain === "solana"
                ? "Paste the mint. A symbol works for tokens Petri has already seen."
                : "Paste the contract address (0x…)."
            }
          >
            <Input
              id="manual-token"
              value={tokenAddress}
              spellCheck={false}
              autoComplete="off"
              placeholder={chain === "solana" ? "DezXAZ8z…B263" : "0x532f27…42E4"}
              onChange={(event) => setTokenAddress(event.target.value)}
              className="font-mono text-xs"
            />
          </Field>

          <Field label="Size" htmlFor="manual-amount" hint={`Capped at ${formatUsd(agent.config?.risk.maxTradeUsd ?? 0)} per trade by this agent's own risk rules.`}>
            <div className="space-y-2">
              <Input
                id="manual-amount"
                value={amount}
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
                className="tnum font-mono"
              />
              <div className="flex flex-wrap gap-1.5">
                {SIZE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(String(preset))}
                    className="tnum rounded-md border border-border/70 px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    ${preset}
                  </button>
                ))}
              </div>
            </div>
          </Field>

          <Field label="Note" htmlFor="manual-note" hint="Published with the fill, like any other trade's rationale. Left blank it reads “Manual trade by the owner.”">
            <Textarea
              id="manual-note"
              value={note}
              rows={2}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Why you are taking this one yourself."
              className="text-xs leading-relaxed"
            />
          </Field>

          <PreviewPanel preview={preview} error={previewError} loading={previewing} ready={ready} />
        </div>

        <SheetFooter>
          {preview?.requiresApproval ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              This agent runs in approval mode, but a trade you place yourself is already approved —
              it fills immediately.
            </p>
          ) : null}
          {isLive ? (
            <HoldToConfirmButton
              size="md"
              disabled={blocked}
              duration={1_600}
              label={`Hold to ${side} ${formatUsd(Number.isFinite(amountUsd) ? amountUsd : 0)}`}
              confirmedLabel="Sent"
              icon={<ArrowLeftRight size={14} strokeWidth={2} />}
              onConfirm={() => void submit().catch(() => undefined)}
              className="w-full justify-center border-primary/40 bg-primary/10 text-foreground hover:bg-primary/15 dark:border-primary/40 dark:bg-primary/10 dark:text-foreground dark:hover:bg-primary/15"
            />
          ) : (
            <MorphButton
              size="md"
              className="w-full"
              disabled={blocked}
              loadingLabel="Routing…"
              successLabel="Filled"
              errorLabel="Refused"
              onAction={submit}
            >
              {side === "buy" ? "Buy" : "Sell"} {formatUsd(Number.isFinite(amountUsd) ? amountUsd : 0)}
            </MorphButton>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Score, guard verdict and quote — the three things worth knowing before committing. */
function PreviewPanel({
  preview,
  error,
  loading,
  ready,
}: {
  preview: TradePreview | null;
  error: string | null;
  loading: boolean;
  ready: boolean;
}) {
  if (!ready) {
    return (
      <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
        Paste a token and a size to see its score and whether your agent&rsquo;s rules allow it.
      </p>
    );
  }

  if (loading && preview === null && error === null) {
    return (
      <p className="flex items-center justify-center gap-2 rounded-lg border border-border/70 px-3 py-4 text-xs text-muted-foreground">
        <Loader2 aria-hidden className="size-3.5 motion-safe:animate-spin" />
        Scoring…
      </p>
    );
  }

  if (error !== null) {
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs leading-relaxed text-destructive">
        {error}
      </p>
    );
  }

  if (preview === null) return null;

  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 bg-card/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{preview.token.symbol}</span>
        <ChainBadge chain={preview.token.chain} />
        {preview.score ? (
          <ScoreBadge total={preview.score.total} verdict={preview.score.verdict} blockers={preview.score.blockers} />
        ) : (
          <span className="text-[11px] text-muted-foreground">unscored</span>
        )}
        {loading ? <Loader2 aria-hidden className="size-3 text-muted-foreground motion-safe:animate-spin" /> : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <Row label="Price" value={formatUsd(preview.priceUsd)} />
        <Row
          label="You get"
          value={
            preview.estimatedToken === null
              ? "—"
              : `${preview.estimatedToken.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${preview.token.symbol}`
          }
        />
        <Row label="Cash" value={formatUsd(preview.cashUsd)} />
        <Row label="Equity" value={formatUsd(preview.equityUsd)} />
      </dl>

      {preview.allowed ? (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-[oklch(0.78_0.15_150)]">
          <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Clears every gate at this size.
        </p>
      ) : (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-destructive">
          <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {preview.reason}
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tnum font-mono">{value}</dd>
    </div>
  );
}
