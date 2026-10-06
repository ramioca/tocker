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
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { usePathname, useSearchParams } from "next/navigation";
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
import { TokenPicker, type PickedToken } from "@/components/trading/token-picker";
import { Textarea } from "@/components/ui/textarea";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { MORPH_FOCUS } from "@/components/common/focus";
import { ChainBadge, chainLabel } from "@/components/common/chain-badge";
import { Address } from "@/components/common/address";
import { formatPreviewFees, formatPriceUsd, formatTokenAmount, formatUsd } from "@/components/common/format";
import { Field } from "@/components/agents/builder/field";
import { SellPositionHost } from "@/components/agents/sell-position";
import { ScoreBadge } from "@/components/tokens";
import { placeManualTrade, previewTrade } from "@/server/actions/trading";
import { TradeReceiptCard } from "@/components/trading";
import { SELL_SLICES, floorCents, sliceLabel, sliceText } from "@/components/trading/sell-amount";
import {
  MaxSlippagePicker,
  RealisedOnSale,
  TradeFailureAlert,
  useRefreshAfterTrade,
} from "@/components/trading/sell-controls";
import {
  PREVIEW_FAILED,
  PREVIEW_PATIENCE_MS,
  PREVIEW_SLOW,
  noQuoteLine,
  realisedOnSale,
  unpreviewedLine,
} from "@/components/trading/sell-preview";
import { safeAction } from "@/lib/safe-action";
import { widerSlippageChoices } from "@/lib/trading/manual-slippage";
import { ORDER_IN_FLIGHT_LOST, isSlippageFailure, outcomeUncertain } from "@/lib/trading/trade-error-copy";
import { cn } from "@/lib/utils";
import type { AgentDetail, Chain, TradePreview } from "@/server/types";
import type { TradeReceiptData } from "@/db/schema";

const SIZE_PRESETS: readonly number[] = [10, 25, 50, 100, 250];

/**
 * Digits and one decimal point, at most two places. The old filter kept every dot, so
 * "1.2.3" read as no amount at all and the form went quietly blank.
 */
function sanitiseAmount(value: string): string {
  return value
    .replace(/[^\d.]/g, "")
    .replace(/(\..*)\./g, "$1")
    .replace(/(\.\d{2}).+/, "$1");
}

/** The resolver's miss, which names both chains' formats and the raw chain id. */
function isUnresolvedToken(error: string): boolean {
  // previewTrade says "Couldn't find"; the resolver's own text (older servers, agent
  // tools) says "Could not resolve".
  return error.startsWith("Couldn't find") || error.startsWith("Could not resolve");
}

/** The first sentence of a longer message, for the one line above the button. */
function firstSentence(text: string): string {
  const match = /^.*?[.!?](?=\s|$)/.exec(text);
  return match ? match[0] : text;
}

/** Debounce for the preview: every keystroke would re-score the token otherwise. */
const PREVIEW_DEBOUNCE_MS = 500;

/**
 * The size chips a buy offers: the fixed ladder, cut at this agent's per-trade cap (a chip
 * the guard will refuse is a trap), plus the cap itself so "as much as it allows" is one tap.
 */
function buyPresets(maxTrade: number): Array<{ value: number; label: string }> {
  const ladder = SIZE_PRESETS.filter((preset) => maxTrade <= 0 || preset <= maxTrade).map((preset) => ({
    value: preset,
    label: `$${preset}`,
  }));
  if (maxTrade > 0 && !ladder.some((preset) => preset.value === maxTrade)) {
    ladder.push({ value: maxTrade, label: `Max ${formatUsd(maxTrade)}` });
  }
  return ladder;
}

export function ManualTradeSheet({ agent }: { agent: AgentDetail }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <TradeSheet agent={agent} triggerRef={triggerRef} />
      {/* The positions table's Sell dialog, rendered from here because this stays mounted
          when a row does not: selling a whole position removes its row with the fill, and
          the result has to outlive it. Owner-only, like everything else in this file.
          Focus comes back to the sheet's button when the row it was opened from is gone. */}
      <SellPositionHost
        agentId={agent.id}
        isPaper={agent.mode !== "live"}
        slippageBps={agent.config?.risk.slippageBps ?? null}
        fallbackFocus={triggerRef}
      />
    </>
  );
}

function TradeSheet({
  agent,
  triggerRef,
}: {
  agent: AgentDetail;
  /** The "Buy / Sell" button, for whoever needs to hand focus back to it. */
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const refreshBook = useRefreshAfterTrade(agent.id);
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [chain, setChain] = useState<Chain>(agent.chains[0] ?? "solana");
  const [picked, setPicked] = useState<PickedToken | null>(null);
  const maxTrade = agent.config?.risk.maxTradeUsd ?? 0;
  // The default size has to be one the guard accepts: $25 against a $10 cap opened the
  // sheet on an error.
  const [amount, setAmount] = useState(() => (maxTrade > 0 && maxTrade < 25 ? String(maxTrade) : "25"));
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
  /** What the sale behind that receipt realised. Null for a buy, or a sell of nothing the book listed. */
  const [realised, setRealised] = useState<{ usd: number; pct: number | null } | null>(null);
  const receiptRef = useRef<HTMLHeadingElement>(null);
  /**
   * The last order's failure, and a wider slippage picked for one sell. Both belong to
   * one token, so both are keyed by it: neither can show up beside, or be sent with, an
   * order for a different one.
   */
  const [failure, setFailure] = useState<{ token: string; text: string } | null>(null);
  const [slippage, setSlippage] = useState<{ token: string; bps: number } | null>(null);
  /** What the agent holds of the token in the box, from the last preview of it. */
  const [holding, setHolding] = useState<{ key: string; valueUsd: number | null; symbol: string } | null>(null);

  const searchParams = useSearchParams();
  const pathname = usePathname();

  // `?trade=buy&chain=solana&token=<mint>` — where a token page's "Buy" lands. Opens the
  // sheet on that order, then drops the params so a refresh or a Back does not re-open it.
  useEffect(() => {
    const wanted = searchParams.get("trade");
    if (wanted !== "buy" && wanted !== "sell") return;
    const wantedChain = searchParams.get("chain");
    const wantedToken = searchParams.get("token")?.trim() ?? "";
    const nextChain = agent.chains.find((option) => option === wantedChain) ?? agent.chains[0] ?? "solana";
    const known = agent.positions.find(
      (position) => position.token.chain === nextChain && position.token.address === wantedToken,
    );
    /* eslint-disable react-hooks/set-state-in-effect -- the URL is the input here; it can only be read after mount */
    setSide(wanted);
    setChain(nextChain);
    if (wantedToken) {
      setPicked({
        chain: nextChain,
        address: wantedToken,
        symbol: known?.token.symbol ?? searchParams.get("sym"),
        name: known?.token.name ?? null,
        logoUrl: known?.token.logoUrl ?? null,
      });
      if (wanted === "sell" && known?.valueUsd) setAmount(sliceText(known.valueUsd, 100));
    }
    setReceipt(null);
    setRealised(null);
    setFailure(null);
    setSlippage(null);
    setOpen(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    const rest = new URLSearchParams(searchParams.toString());
    for (const name of ["trade", "chain", "token", "sym"]) rest.delete(name);
    const query = rest.toString();
    // The History API rather than router.replace: nothing needs re-rendering on the server,
    // and Next keeps useSearchParams in step with replaceState.
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
  }, [searchParams, pathname, agent.chains, agent.positions]);

  // A token picked on the other chain is not this order's token.
  const token = picked && picked.chain === chain ? picked : null;
  const amountUsd = Number(amount);
  const address = token?.address ?? "";
  const amountValid = Number.isFinite(amountUsd) && amountUsd > 0;
  const amountError = amount !== "" && !amountValid ? "Enter an amount above $0, like 25 or 12.50" : null;
  const ready = address.length >= 3 && amountValid;
  const bookPosition = agent.positions.find(
    (position) => position.token.chain === chain && position.token.address === address,
  );
  // Asking for the whole position is asking for everything: the server sells the balance,
  // not a dollar figure the mark has already moved past (same rule as the Sell dialog).
  // Read off the book, which the preview cannot change, so it can ride on the preview too.
  const bookUsd = bookPosition?.valueUsd ?? 0;
  const sellAll = side === "sell" && bookUsd > 0 && amountValid && amountUsd >= floorCents(bookUsd);
  // Said at the Size box, not only by the guard at the bottom of the preview: on a phone
  // that line sat under the footer, next to a Buy button that was simply dead. Buys only —
  // a full exit may sell past the cap (see risk.test.ts).
  const overCap = side === "buy" && maxTrade > 0 && Number.isFinite(amountUsd) && amountUsd > maxTrade;
  const isLive = agent.mode === "live";
  const tokenKey = `${chain}|${address}`;
  // One live sell may run under a wider slippage tolerance than the agent's own. Only a
  // step the action will honour is ever sent; anything else is the agent's setting.
  const agentBps = agent.config?.risk.slippageBps ?? null;
  const widerChoices = side === "sell" && isLive && agentBps !== null ? widerSlippageChoices(agentBps) : [];
  const maxSlippageBps =
    slippage !== null && slippage.token === tokenKey && widerChoices.includes(slippage.bps) ? slippage.bps : null;
  const key = open && ready ? `${chain}|${side}|${address}|${amountUsd}|${maxSlippageBps ?? "agent"}` : null;

  // Preview whenever the order changes. Free: scoring costs nothing and the quote is
  // the same call the executor would make. Asked once per order and never refreshed on
  // its own, for the same reason: a live quote spends the venue's rate limit.
  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    let answered = false;
    const timer = window.setTimeout(async () => {
      // A request that throws (offline, a deploy in flight) becomes an answer like any
      // other, instead of leaving the panel on "Scoring…" for good.
      const answer = await safeAction(
        () =>
          previewTrade({
            agentId: agent.id,
            chain,
            side,
            tokenAddress: address,
            amountUsd,
            sellAll,
            ...(maxSlippageBps === null ? {} : { maxSlippageBps }),
          }),
        PREVIEW_FAILED,
      );
      if (cancelled) return;
      answered = true;
      setResult(
        answer.ok ? { key, data: answer.data, error: null } : { key, data: null, error: answer.error },
      );
      // Kept per token so the sell slices do not blink out while the next size previews.
      if (answer.ok) {
        setHolding({
          key: `${chain}|${address}`,
          valueUsd: answer.data.positionValueUsd,
          symbol: answer.data.token.symbol,
        });
      }
    }, PREVIEW_DEBOUNCE_MS);
    // A preview that never answers must not hold a sell shut. A late answer replaces this.
    const patience = window.setTimeout(() => {
      if (cancelled || answered) return;
      setResult({ key, data: null, error: PREVIEW_SLOW });
    }, PREVIEW_PATIENCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(patience);
    };
  }, [key, agent.id, chain, side, address, amountUsd, sellAll, maxSlippageBps]);

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
  // The book already knows what is held; the preview's figure is fresher when it has one.
  const previewHeld = holding !== null && holding.key === `${chain}|${address}` ? holding : null;
  const held =
    previewHeld ??
    (bookPosition ? { key: `${chain}|${address}`, valueUsd: bookPosition.valueUsd, symbol: bookPosition.token.symbol } : null);
  const heldUsd = side === "sell" ? (held?.valueUsd ?? null) : null;
  // "Everything" is never over the position: the server sells the balance at the mark it
  // reads, whatever this figure was when the page rendered.
  const overPosition = !sellAll && heldUsd !== null && amountValid && amountUsd > heldUsd;
  // The amount only rides on the button when the order can go: "Sell $99,999.00" under
  // "more than the position is worth" read as an offer the sheet was refusing.
  const orderable = amountValid && !overCap && !overPosition && preview?.allowed !== false;
  const orderLabel =
    side === "sell" && sellAll && orderable
      ? `Sell all ${token?.symbol ?? held?.symbol ?? ""}`.trim()
      : `${side === "buy" ? "Buy" : "Sell"}${orderable ? ` ${formatUsd(amountUsd)}` : ""}${
          orderable && (token?.symbol ?? held?.symbol) ? ` of ${token?.symbol ?? held?.symbol}` : ""
        }`;

  /**
   * In flight. A live swap can take longer than the hold button's re-arm, and a second
   * hold during it would be a second real-money order — so the button stays disabled
   * until the server answers, and is remounted (`holdKey`) to re-arm afterwards.
   */
  const [submitting, setSubmitting] = useState(false);
  const [holdKey, setHoldKey] = useState(0);

  const place = useCallback(async () => {
    setFailure(null);
    // Read before the fill: the book this sheet was rendered with is the position as it
    // stood, which is what the sale is measured against.
    const basis = side === "sell" && bookPosition ? bookPosition : null;
    // A request that throws may still have reached the server and filled, so the
    // sentence says to check before trying again. It never re-arms the button in silence.
    const placed = await safeAction(
      () =>
        placeManualTrade({
          agentId: agent.id,
          chain,
          side,
          tokenAddress: address,
          amountUsd,
          ...(sellAll ? { sellAll: true } : {}),
          ...(maxSlippageBps === null ? {} : { maxSlippageBps }),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      ORDER_IN_FLIGHT_LOST,
    );
    // After every attempt: a failed order still wrote a trade row.
    refreshBook();
    if (!placed.ok) {
      setFailure({ token: tokenKey, text: placed.error });
      // "Not placed" is a claim. An order that may have filled does not get that heading.
      toast.error(outcomeUncertain(placed.error) ? "Trade unconfirmed" : "Trade not placed", {
        description: placed.error,
      });
      throw new Error(placed.error);
    }
    toast.success(
      `${placed.data.side === "buy" ? "Bought" : "Sold"} ${formatUsd(placed.data.amountUsd)} of ${placed.data.symbol}`,
      {
        description: `${formatTokenAmount(placed.data.amountToken)} ${placed.data.symbol} at ${formatPriceUsd(placed.data.priceUsd)}${placed.data.isPaper ? " · paper" : ""}`,
      },
    );
    setReceipt(placed.data.receipt);
    setRealised(
      basis
        ? realisedOnSale({
            amountUsd: placed.data.amountUsd,
            amountToken: placed.data.amountToken,
            totalFeeUsd: placed.data.receipt.totalFeeUsd,
            heldToken: basis.amountToken,
            avgCostUsd: basis.avgCostUsd,
          })
        : null,
    );
    setPicked(null);
    setNote("");
    setResult(null);
    // The wider tolerance was for that one order.
    setSlippage(null);
  }, [agent.id, chain, side, address, amountUsd, sellAll, maxSlippageBps, note, bookPosition, tokenKey, refreshBook]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    try {
      await place();
    } finally {
      setSubmitting(false);
      setHoldKey((k) => k + 1);
    }
  }, [place]);

  const unresolved = previewError !== null && isUnresolvedToken(previewError);
  // A buy waits for a preview that allows it. A sell only waits for an answer of some
  // kind: a preview that failed, timed out or could not quote must never be what keeps
  // someone in a position, and the server runs every check again when the order lands.
  // Two answers still stop it, because the order would be refused for the same reason:
  // the guard saying no, and a token that does not resolve.
  const blocked =
    side === "sell"
      ? submitting || !ready || current === null || preview?.allowed === false || unresolved
      : submitting || !ready || previewing || preview === null || !preview.allowed;
  // A sell's preview came back as an error and the button is live anyway.
  const sellUnpreviewed = side === "sell" && previewError !== null && !unresolved;
  // One line above the button saying why it is dead, so the reason is in view wherever
  // the form is scrolled to.
  // Short, because the full text is already in the preview right above it; repeating it
  // here clamped it mid-sentence.
  const footerReason = submitting
    ? null
    : previewError !== null
      ? unresolved
        ? "Token not found."
        : sellUnpreviewed
          ? null
          : firstSentence(previewError)
      : preview !== null && !preview.allowed
        ? overCap
          ? "Over the per-trade cap."
          : overPosition
            ? "Over the position."
            : firstSentence(preview.reason ?? "")
        : null;
  const shownFailure = failure !== null && failure.token === tokenKey ? failure.text : null;
  const widerLeft = widerChoices.some((bps) => bps > (maxSlippageBps ?? agentBps ?? 0));

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setReceipt(null);
          setRealised(null);
          setFailure(null);
          // A wider tolerance is picked for the order in front of you, not kept for later.
          setSlippage(null);
        }
      }}
    >
      <SheetTrigger
        render={
          <button
            ref={triggerRef}
            type="button"
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "hover:bg-muted active:scale-[0.97]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <ArrowLeftRight aria-hidden className="size-3.5" />
            Buy / Sell
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
                  onClick={() => {
                    setSide(option);
                    // Switching a token you hold to Sell offers all of it, like picking it
                    // from the position chips does; a leftover "$25" read as the suggestion.
                    if (option === "sell" && side !== "sell" && bookPosition?.valueUsd) {
                      setAmount(sliceText(bookPosition.valueUsd, 100));
                    }
                  }}
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

            <Field label="Token" htmlFor="manual-token">
              <TokenPicker
                id="manual-token"
                chain={chain}
                side={side}
                value={token}
                holdings={agent.positions}
                onChange={(next) => {
                  setPicked(next);
                  // Picking something you hold on a sell sizes it to the whole position:
                  // "sell my BONK" is the common case, and a smaller slice is one tap away.
                  if (next && side === "sell") {
                    const position = agent.positions.find(
                      (p) => p.token.chain === next.chain && p.token.address === next.address,
                    );
                    if (position?.valueUsd) setAmount(sliceText(position.valueUsd, 100));
                  }
                }}
              />
            </Field>

            <Field
              label="Size"
              htmlFor="manual-amount"
              hint={
                side === "buy"
                  ? `Capped at ${formatUsd(maxTrade)} per trade by this agent's own risk rules.`
                  : held !== null && held.valueUsd !== null
                    ? `You hold ${formatUsd(held.valueUsd)} of ${held.symbol}.`
                    : "Sells are not capped per trade."
              }
              error={
                amountError ??
                (overCap
                  ? `Over this agent's ${formatUsd(maxTrade)} cap per trade. Lower it, or raise Max per trade in settings.`
                  : null)
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
                    aria-invalid={amountError !== null || overCap || undefined}
                    aria-describedby={amountError !== null || overCap ? "manual-amount-error" : undefined}
                    onChange={(event) => setAmount(sanitiseAmount(event.target.value))}
                    className="tnum pl-6 font-mono"
                  />
                </div>
                {side === "buy" ? (
                  <div className="flex flex-wrap gap-1.5">
                    {buyPresets(maxTrade).map((preset) => {
                      const active = amount === String(preset.value);
                      return (
                        <button
                          key={preset.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setAmount(String(preset.value))}
                          className={cn(PRESET_CLASS, active ? PRESET_ACTIVE : PRESET_IDLE)}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                ) : heldUsd !== null && heldUsd > 0 ? (
                  // Floored to the cent (sliceText), so "All" is never a cent over the mark
                  // and refused by the guard. Same slices as the Sell position dialog.
                  <div className="flex flex-wrap gap-1.5">
                    {SELL_SLICES.map((pct) => {
                      const active = amount === sliceText(heldUsd, pct);
                      return (
                        <button
                          key={pct}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setAmount(sliceText(heldUsd, pct))}
                          className={cn(PRESET_CLASS, active ? PRESET_ACTIVE : PRESET_IDLE)}
                        >
                          {sliceLabel(pct)}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </Field>

            {/* Directly under the size: the verdict belongs next to the inputs it answers. */}
            <PreviewPanel
              preview={preview}
              side={side}
              amountUsd={amountUsd}
              chain={chain}
              input={address}
              error={previewError}
              loading={previewing}
              ready={ready}
              widerSlippageLeft={widerLeft}
            />

            {agentBps !== null && widerChoices.length > 0 ? (
              <MaxSlippagePicker
                agentBps={agentBps}
                value={maxSlippageBps}
                onChange={(bps) => setSlippage(bps === null ? null : { token: tokenKey, bps })}
                disabled={submitting}
                labelClassName="text-sm font-medium text-foreground"
              />
            ) : null}

            <Field label="Note" htmlFor="manual-note" hint="Published with the fill, like any other trade's rationale. Left blank it reads “Manual trade by the owner.”">
              <Textarea
                id="manual-note"
                value={note}
                rows={2}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why you are taking this one yourself."
                className="text-base leading-relaxed md:text-xs"
              />
            </Field>

            {receipt ? (
              <section aria-label="Fill receipt" className="space-y-2">
                <h3
                  ref={receiptRef}
                  tabIndex={-1}
                  className="scroll-mt-4 rounded text-[11px] font-semibold tracking-wide text-muted-foreground uppercase focus:outline-none"
                >
                  Filled
                </h3>
                {realised ? <RealisedOnSale usd={realised.usd} pct={realised.pct} /> : null}
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
          {/* The last order's failure, until the next attempt. Here rather than in the
              form: the button it explains is here, and the form may be scrolled away. */}
          {shownFailure !== null ? (
            <TradeFailureAlert
              text={shownFailure}
              settingsHref={`/agents/${agent.slug}/settings#risk`}
              widerSlippage={isSlippageFailure(shownFailure) && widerLeft ? "above" : null}
            />
          ) : null}
          {footerReason ? (
            <p role="status" className="line-clamp-2 text-xs leading-relaxed text-destructive">
              {footerReason}
            </p>
          ) : sellUnpreviewed && !submitting ? (
            // Not a reason the button is dead: it is not. Said so the missing preview is
            // not mistaken for a refusal.
            <p role="status" className="text-xs leading-relaxed text-muted-foreground">
              {unpreviewedLine(firstSentence(previewError ?? ""))}
            </p>
          ) : !ready && !receipt ? (
            <p className="text-xs text-muted-foreground">
              {address.length < 3 ? "Pick a token to preview." : "Enter a size to preview."}
            </p>
          ) : null}
          {receipt && !ready ? (
            // After a fill the token box is empty, so the order button could only sit there
            // disabled. The next thing to do is start another one — or leave: the header
            // and its close button have scrolled away above the receipt.
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <SheetClose render={<Button variant="ghost" size="lg" />}>Done</SheetClose>
              <Button
                size="lg"
                onClick={() => {
                  setReceipt(null);
                  setRealised(null);
                  document.getElementById("manual-token")?.focus();
                }}
              >
                Place another trade
              </Button>
            </div>
          ) : isLive ? (
            <HoldToConfirmButton
              key={holdKey}
              size="md"
              disabled={blocked}
              resetDelay={0}
              duration={1_600}
              label={`Hold to ${orderLabel.toLowerCase()}`}
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
              {orderLabel}
            </MorphButton>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const PRESET_CLASS =
  "tnum rounded-md border px-2 py-1 font-mono text-[11px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
// The chip matching the Size box reads as chosen, as the Sell position dialog's does.
const PRESET_ACTIVE = "border-primary/50 bg-primary/10 text-foreground";
const PRESET_IDLE = "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground";

/** Score, guard verdict and quote — the three things worth knowing before committing. */
function PreviewPanel({
  preview,
  side,
  amountUsd,
  chain,
  input,
  error,
  loading,
  ready,
  widerSlippageLeft,
}: {
  preview: TradePreview | null;
  side: "buy" | "sell";
  amountUsd: number;
  chain: Chain;
  input: string;
  error: string | null;
  loading: boolean;
  ready: boolean;
  /** A wider Max slippage can still be picked under this panel. */
  widerSlippageLeft: boolean;
}) {
  if (!ready) {
    return (
      <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
        Pick a token and a size to see its score and whether your agent&rsquo;s rules allow it.
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
    const unresolved = isUnresolvedToken(error);
    // A sell does not wait on its preview: the order is checked again on the server. So
    // a preview that could not be had is a note, not the red box of a refusal.
    const note = side === "sell" && !unresolved;
    return (
      <p
        className={cn(
          "rounded-lg border px-3 py-2.5 text-xs leading-relaxed",
          note ? "border-border/70 text-muted-foreground" : "border-destructive/30 bg-destructive/5 text-destructive",
        )}
      >
        {unresolved
          ? // The resolver's own text names both chains and the raw chain id; say it for this one.
            `Couldn't find “${input}” on ${chainLabel(chain)}. ${
              chain === "solana"
                ? "Paste the full mint — a symbol only works for a token Tocker has already seen."
                : "Paste the 0x contract address."
            }`
          : note
            ? unpreviewedLine(error)
            : error}
      </p>
    );
  }

  if (preview === null) return null;

  // A sell is shown as the order will be sent: the position's own tokens and the
  // venue's quote for them, not the typed dollars divided by a price.
  const sell = side === "sell" ? (preview.sell ?? null) : null;
  const tokens =
    sell !== null && sell.amountToken !== null
      ? `${formatTokenAmount(sell.amountToken)} ${preview.token.symbol}${sell.fullExit ? " (everything)" : ""}`
      : preview.estimatedToken === null
        ? "—"
        : `${formatTokenAmount(preview.estimatedToken)} ${preview.token.symbol}`;
  // Without a live quote the only honest figure is what the slice is worth at the last
  // price, and it says that is what it is.
  const receive =
    sell !== null && sell.proceedsUsd !== null
      ? formatUsd(sell.proceedsUsd)
      : `${formatUsd(sell?.fullExit && preview.positionValueUsd !== null ? preview.positionValueUsd : amountUsd)} at the last price`;
  const fees = formatPreviewFees(preview.fees);

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
        {/* A refused order moves nothing, so no "you get": a sell past the position listed
            157M tokens the agent never had. */}
        {preview.allowed ? (
          <>
            <Row label={side === "buy" ? "You get ≈" : "You sell ≈"} value={tokens} />
            {side === "sell" ? <Row label="You receive ≈" value={receive} /> : null}
            {sell !== null && sell.minProceedsUsd !== null ? (
              <Row
                label="At worst ≈"
                value={formatUsd(sell.minProceedsUsd)}
                hint="past this the order cancels and nothing is sold"
              />
            ) : null}
            {fees ? <Row label="Fees" value={fees} /> : null}
          </>
        ) : null}
        {/* Today's book, not the result of the order — said so next to post-trade figures. */}
        <Row label="Cash now" value={formatUsd(preview.cashUsd)} />
        <Row label="Equity now" value={formatUsd(preview.equityUsd)} />
      </dl>

      {side === "sell" && preview.allowed && preview.quoted === false ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {/* A slippage refusal shows up here first, before any order: point at the
              choice that fixes it without leaving the sheet. */}
          {noQuoteLine(
            preview.quoteNote && isSlippageFailure(preview.quoteNote) && widerSlippageLeft
              ? `${preview.quoteNote} Or pick a wider Max slippage below.`
              : preview.quoteNote,
          )}
        </p>
      ) : null}

      {preview.allowed ? (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-[oklch(0.78_0.15_150)]">
          <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {/* Sells are not gated on score, so an "Avoid" badge above is not a contradiction. */}
          {side === "sell"
            ? "Within this agent's sell limits — score doesn't gate sells."
            : "Clears every gate at this size."}
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

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="tnum min-w-0 text-right font-mono break-words">
        {value}
        {hint ? <span className="block font-sans text-[11px] text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  );
}
