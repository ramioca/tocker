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
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Loader2, ShieldAlert, ShieldCheck, XIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { MORPH_FOCUS } from "@/components/common/focus";
import { ChainBadge } from "@/components/common/chain-badge";
import { Address } from "@/components/common/address";
import { formatPriceUsd, formatUsd } from "@/components/common/format";
import { Field } from "@/components/agents/builder/field";
import { ScoreBadge } from "@/components/tokens";
import { placeManualTrade, previewTrade } from "@/server/actions/trading";
import { SizingSummary, TradeReceiptCard } from "@/components/trading";
import { readSizing } from "@/lib/trading/sizing";
import { cn } from "@/lib/utils";
import type { AgentDetail, Chain, TradePreview } from "@/server/types";
import type { AgentRiskWithSizing, TradeReceiptData } from "@/db/schema";

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
  /**
   * The receipt for the fill that just happened. The sheet stays open on it rather than
   * closing straight away: a live trade that just moved real money is exactly the moment
   * someone wants the venue, the slippage and the hash in front of them, not a toast
   * that disappears in four seconds.
   */
  const [receipt, setReceipt] = useState<TradeReceiptData | null>(null);
  const receiptRef = useRef<HTMLHeadingElement>(null);

  const amountUsd = Number(amount);
  const address = tokenAddress.trim();
  const ready = address.length >= 3 && Number.isFinite(amountUsd) && amountUsd > 0;
  // Said at the Size box, not only by the guard at the bottom of the preview: on a phone
  // that line sat under the footer, next to a Buy button that was simply dead. Buys only —
  // a full exit may sell past the cap (see risk.test.ts).
  const maxTrade = agent.config?.risk.maxTradeUsd ?? 0;
  const overCap = side === "buy" && maxTrade > 0 && Number.isFinite(amountUsd) && amountUsd > maxTrade;
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

  // The fill lands at the end of a long form, below the fold on a phone, while the token
  // box above it has just been cleared — which read as the sheet resetting. Take the
  // reader to the receipt instead.
  useEffect(() => {
    if (!receipt) return;
    receiptRef.current?.scrollIntoView({ block: "start" });
    receiptRef.current?.focus({ preventScroll: true });
  }, [receipt]);

  const current = result !== null && result.key === key ? result : null;
  const preview = current?.data ?? null;
  const previewError = current?.error ?? null;
  const previewing = key !== null && current === null;

  /**
   * In flight. A live swap can take longer than the hold button's re-arm, and a second
   * hold during it would be a second real-money order — so the button stays disabled
   * until the server answers, and is remounted (`holdKey`) to re-arm afterwards.
   */
  const [submitting, setSubmitting] = useState(false);
  const [holdKey, setHoldKey] = useState(0);

  const place = useCallback(async () => {
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
        })} ${placed.data.symbol} at ${formatPriceUsd(placed.data.priceUsd)}${placed.data.isPaper ? " · paper" : ""}`,
      },
    );
    setReceipt(placed.data.receipt);
    setTokenAddress("");
    setNote("");
    setResult(null);
    router.refresh();
  }, [agent.id, chain, side, address, amountUsd, note, router]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    try {
      await place();
    } finally {
      setSubmitting(false);
      setHoldKey((k) => k + 1);
    }
  }, [place]);

  const blocked = submitting || !ready || previewing || preview === null || !preview.allowed;
  // One line above the button saying why it is dead, so the reason is in view wherever
  // the form is scrolled to.
  const footerReason = submitting
    ? null
    : previewError !== null
      ? previewError
      : preview !== null && !preview.allowed
        ? overCap
          ? "Over the per-trade cap."
          : preview.reason
        : null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setReceipt(null);
      }}
    >
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

      {/* The primitive sizes a right sheet with `data-[side=right]:` classes, so the
          override has to use the same variant for tailwind-merge to replace them; a
          bare `w-full` lost to its 75% and left 292px on a phone.
          The form scrolls and the footer does not: with the whole sheet scrolling, the
          preview pushed the Buy button below the fold on a phone, so the one control
          the preview exists to inform was the one you could not see. */}
      <SheetContent
        side="right"
        // The primitive's X is pinned over the scrolling form and, scrolled down, sat on the
        // receipt's first row. This one lives in the header row and scrolls away with it.
        showCloseButton={false}
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <SheetHeader>
            <div className="flex items-start justify-between gap-3">
              <SheetTitle>Trade on {agent.name}</SheetTitle>
              <SheetClose render={<Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1.5 shrink-0" />}>
                <XIcon />
                <span className="sr-only">Close</span>
              </SheetClose>
            </div>
            <SheetDescription>
              Your order, its book. It still goes through this agent&rsquo;s score, its caps and its
              blocklist — manual means you choose, not that the rules stop applying.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 px-4 pb-4">
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
                  ? "Paste the mint. A symbol works for tokens Tocker has already seen."
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

            <Field
              label="Size"
              htmlFor="manual-amount"
              hint={`Capped at ${formatUsd(maxTrade)} per trade by this agent's own risk rules.`}
              error={
                overCap
                  ? `Over this agent's ${formatUsd(maxTrade)} cap per trade. Lower it, or raise Max per trade in settings.`
                  : null
              }
            >
              <div className="space-y-2">
                <div className="relative">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-2.5 grid place-items-center font-mono text-sm text-muted-foreground"
                  >
                    $
                  </span>
                  <Input
                    id="manual-amount"
                    value={amount}
                    inputMode="decimal"
                    aria-invalid={overCap || undefined}
                    aria-describedby={overCap ? "manual-amount-error" : undefined}
                    onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
                    className="tnum pl-6 font-mono"
                  />
                </div>
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

            {/* Directly under the size: the verdict belongs next to the inputs it answers. */}
            <PreviewPanel
              preview={preview}
              side={side}
              amountUsd={amountUsd}
              error={previewError}
              loading={previewing}
              ready={ready}
            />

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

            {/* The size the agent's own sizing mode allows right now, and why. Shown next
                to the amount field so a refusal is never the first time anyone sees it. */}
            <SizingSummary
              sizing={readSizing(agent.config?.risk as AgentRiskWithSizing | undefined)}
              maxTradeUsd={agent.config?.risk.maxTradeUsd ?? 0}
              equityUsd={agent.equityUsd}
            />

            {receipt ? (
              <section aria-label="Fill receipt" className="space-y-2">
                <h3
                  ref={receiptRef}
                  tabIndex={-1}
                  className="scroll-mt-4 rounded text-[11px] font-semibold tracking-wide text-muted-foreground uppercase focus:outline-none"
                >
                  Filled
                </h3>
                <TradeReceiptCard receipt={receipt} />
              </section>
            ) : null}
          </div>
        </div>

        <SheetFooter className="border-t border-border/60 bg-background/95 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {preview?.requiresApproval ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              This agent runs in approval mode, but a trade you place yourself is already approved —
              it fills immediately.
            </p>
          ) : null}
          {footerReason ? (
            <p role="status" className="line-clamp-2 text-xs leading-relaxed text-destructive">
              {footerReason}
            </p>
          ) : !ready && !receipt ? (
            <p className="text-xs text-muted-foreground">Paste a token and a size to preview.</p>
          ) : null}
          {receipt && !ready ? (
            // After a fill the token box is empty, so the order button could only sit there
            // disabled. The next thing to do is start another one.
            <Button
              className="w-full"
              size="lg"
              onClick={() => {
                setReceipt(null);
                document.getElementById("manual-token")?.focus();
              }}
            >
              Place another trade
            </Button>
          ) : isLive ? (
            <HoldToConfirmButton
              key={holdKey}
              size="md"
              disabled={blocked}
              resetDelay={0}
              duration={1_600}
              label={`Hold to ${side} ${formatUsd(Number.isFinite(amountUsd) ? amountUsd : 0)}`}
              confirmedLabel="Sending…"
              icon={<ArrowLeftRight size={14} strokeWidth={2} />}
              onConfirm={() => void submit().catch(() => undefined)}
              className="w-full justify-center border-primary/40 bg-primary/10 text-foreground hover:bg-primary/15 dark:border-primary/40 dark:bg-primary/10 dark:text-foreground dark:hover:bg-primary/15"
            />
          ) : (
            <MorphButton
              size="md"
              className={cn("w-full", MORPH_FOCUS)}
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
  side,
  amountUsd,
  error,
  loading,
  ready,
}: {
  preview: TradePreview | null;
  side: "buy" | "sell";
  amountUsd: number;
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

  const tokens =
    preview.estimatedToken === null
      ? "—"
      : `${preview.estimatedToken.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${preview.token.symbol}`;

  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 bg-card/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{preview.token.symbol}</span>
        <ChainBadge chain={preview.token.chain} />
        {/* A symbol can resolve to a copycat; the address is what actually gets bought. */}
        <Address address={preview.token.address} lead={4} tail={4} label={`${preview.token.symbol} address`} />
        {preview.score ? (
          <ScoreBadge total={preview.score.total} verdict={preview.score.verdict} blockers={preview.score.blockers} />
        ) : (
          <span className="text-[11px] text-muted-foreground">unscored</span>
        )}
        {loading ? <Loader2 aria-hidden className="size-3 text-muted-foreground motion-safe:animate-spin" /> : null}
      </div>

      {/* One column: a token count like 157,232,704.4 BONK needs the width. A buy gets
          tokens; a sell gives them up and gets dollars, so it says both. */}
      <dl className="grid gap-y-1.5 text-xs">
        <Row label="Price" value={formatPriceUsd(preview.priceUsd)} />
        <Row label={side === "buy" ? "You get ≈" : "You sell ≈"} value={tokens} />
        {side === "sell" ? <Row label="You receive ≈" value={formatUsd(amountUsd)} /> : null}
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
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="tnum min-w-0 text-right font-mono break-words">{value}</dd>
    </div>
  );
}
