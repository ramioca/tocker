"use client";

import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/agents/builder/simple-select";
import { FullAddress } from "@/components/common/address";
import { formatUsd, truncateAddress } from "@/components/common/format";
import { checkWithdrawAmount, floorCents, maxAmountText } from "./withdraw-amount";
import { WithdrawEmpty, agentWithdrawHref } from "./withdraw-empty";
import { WithdrawReceipt, receiptDescription, receiptTitle, type WithdrawalReceipt } from "./withdraw-receipt";
import { useRefreshCash, useSyncWallets } from "@/components/wallets/use-cash";
import { useTransfer } from "@/components/wallets/use-transfer";
import { destinationProblemForChain, normalizeAddressForChain } from "@/lib/wallet-address";
import {
  NETWORK_WORDING,
  cashOn,
  chainLabelFor,
  preferredDepositChain,
  unifiedCash,
  type AgentCash,
} from "@/lib/wallets/funding";
import { quoteSponsoredWithdrawal } from "@/server/actions/sponsored-withdraw";
import type { Chain, WalletBalance } from "@/server/types";
import { sanitizeUsdInput } from "./usd-input";
import { cn } from "@/lib/utils";
import { MORPH_FOCUS } from "@/components/common/focus";
import { shownCashTotal } from "@/components/wallets/cash-display";

const PERCENT_CHIPS = [
  { label: "10%", fraction: 0.1 },
  { label: "25%", fraction: 0.25 },
  { label: "50%", fraction: 0.5 },
  { label: "Max", fraction: 1 },
] as const;

/** Solana's floor until the quote says otherwise — the server enforces its own. */
const DEFAULT_SOLANA_MIN = 1;
/** Long enough that a paste resolves once; short enough that the fee is there when they look. */
const QUOTE_DEBOUNCE_MS = 300;

type Quote =
  | { address: string; status: "ready"; newAccount: boolean; feeUsdc: number; minAmountUsdc: number }
  | { address: string; status: "error"; message: string };


/**
 * Withdraw USDC from the user's embedded wallet to any external address —
 * amount with percentage chips against the available balance, then one explicit
 * hold to confirm. Signing happens client-side with the user's own Privy embedded
 * wallet; the server never holds this key.
 *
 * Nobody here holds gas. The network fee is Tocker's on both chains (Privy sponsors it
 * on Base, Tocker's fee wallet pays it on Solana), and the modal says so. The one cost a
 * Solana withdrawal can carry is opening the recipient's USDC account when it has never
 * held USDC: a small one-time USDC fee, quoted as the address is typed and shown before
 * the hold — never SOL, and never a surprise.
 *
 * A withdrawal is per-chain even though the balance above it is unified: the
 * USDC has to leave from where it actually is, and the chain picker says so. It
 * opens on the chain holding the most USDC (the same pick Deposit makes), so "Max"
 * is never a zero while the cash sits on the other chain.
 *
 * Only the user's own wallets can be sent from here. Money inside an agent is counted in
 * the top bar's number but has to come back to cash first, so the modal is told about
 * the agents too and points at them rather than saying there is nothing to withdraw.
 *
 * The outcome stays in the dialog as a receipt (`WithdrawReceipt`) until it is dismissed.
 */
export function WithdrawModal({
  open,
  onOpenChange,
  wallets,
  agents,
  onDeposit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallets: WalletBalance[];
  /** The user's live agents and what each holds, as the Cash panel lists them. */
  agents?: AgentCash[];
  /** Where an empty balance sends the user instead of an unusable form. */
  onDeposit?: () => void;
}) {
  const cash = useMemo(() => unifiedCash(wallets, agents), [wallets, agents]);
  const [chain, setChain] = useState<Chain>(() => preferredDepositChain(cash));
  const [amount, setAmount] = useState("");
  // "Max" is a mode, not a number typed once: while it is on, the field is worked out
  // from the balance and the fee, so a fee that arrives after the tap lowers the amount
  // by itself. Typing, another chip, a chain change and a fresh open all turn it off.
  const [maxed, setMaxed] = useState(false);
  const [destination, setDestination] = useState("");
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<WithdrawalReceipt | null>(null);
  // Remounts the hold button after every attempt. It stays mounted with the dialog, and
  // with no reset delay it would otherwise still read "Sending…" on the next open.
  const [attempt, setAttempt] = useState(0);
  const [quote, setQuote] = useState<Quote | null>(null);
  const { send, available } = useTransfer();
  const refresh = useRefreshCash();
  const syncWallets = useSyncWallets();
  const [syncing, setSyncing] = useState(false);

  // Whether the dialog is open when a send comes back, which can be long after the hold:
  // a receipt set on a closed dialog would be shown to nobody, so that case still toasts.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Every open starts clean, on the chain the cash is on: an address typed last time
  // (for the other chain, perhaps) is not one to carry into a new withdrawal, and neither
  // is the last receipt. Adjusted during render, as DepositSheet does, so the old values
  // never paint.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setChain(preferredDepositChain(cash));
      setAmount("");
      setMaxed(false);
      setDestination("");
      setQuote(null);
      setReceipt(null);
    }
  }

  const chainCash = cashOn(cash, chain);
  const availableUsdc = chainCash.usdc;
  const target = destination.trim();
  // The same check the server makes, checksum included: a mixed-case Base address with
  // one wrong letter is refused here, in words, rather than by viem after the hold.
  //
  // On Base it is also the only check there is (the transfer is signed and sent in the
  // browser), so the user's own address is refused here: it would "send" and change
  // nothing. On Solana the quote below refuses it on the server.
  const ownBaseAddress = cashOn(cash, "base").address;
  const addressProblem =
    destinationProblemForChain(chain, destination) ??
    (chain === "base" && ownBaseAddress && target.toLowerCase() === ownBaseAddress.toLowerCase()
      ? "That's your own Tocker wallet on Base. Paste the address you want the USDC to go to."
      : null);
  const destinationOk = addressProblem === null;

  // Solana only: what sending to this address costs, if anything. A quote belongs to one
  // address, so a stale one is simply not "current" — no reset needed when typing.
  const needsQuote = chain === "solana" && destinationOk;
  const current = needsQuote && quote?.address === target ? quote : null;
  const quoteLoading = needsQuote && current === null;

  useEffect(() => {
    if (!needsQuote || current !== null || !open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void quoteSponsoredWithdrawal({ toAddress: target })
        .then((result) => {
          if (cancelled) return;
          setQuote(
            result.ok
              ? { address: target, status: "ready", ...result.data }
              : { address: target, status: "error", message: result.error },
          );
        })
        .catch(() => {
          if (cancelled) return;
          setQuote({ address: target, status: "error", message: "Couldn't check that address. Try again." });
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [needsQuote, current, target, open]);

  const ready = current?.status === "ready" ? current : null;
  const quoteError = current?.status === "error" ? current.message : null;
  // The server has no Solana wallet on record for this user: the fix is a sync, which
  // can be done right here rather than by finding Deposit.
  const needsSync = quoteError !== null && /sync wallets/i.test(quoteError);

  const syncAndRequote = async () => {
    setSyncing(true);
    try {
      await syncWallets();
      setQuote(null);
    } catch {
      toast.error("Couldn't sync your wallets", { description: "Try again in a moment." });
    } finally {
      setSyncing(false);
    }
  };
  const feeUsdc = ready?.feeUsdc ?? 0;
  const minAmount = chain === "solana" ? (ready?.minAmountUsdc ?? DEFAULT_SOLANA_MIN) : 0;
  // One value for the input and for the check, so what is on screen is what is signed.
  const fieldAmount = maxed ? maxAmountText(availableUsdc, feeUsdc) : amount;
  // `sendable` is the balance floored to a cent: the figure every line below shows, so
  // typing back what is on screen always passes the check.
  const { spendable, sendable, parsed, entered, underMinimum, overBalance, validAmount } = checkWithdrawAmount({
    amount: fieldAmount,
    availableUsdc,
    feeUsdc,
    minAmount,
  });
  // Less on Solana than the smallest withdrawal: no amount can pass, so the form says so
  // before anyone types instead of after.
  const belowMinimum = chain === "solana" && sendable < minAmount;
  const quoteReady = chain !== "solana" || ready !== null;
  const canSend = validAmount && destinationOk && quoteReady && !pending && available;

  const confirm = async () => {
    // A quote that went stale mid-hold lands here; reset the button or it sits at "Sending…".
    if (!canSend) {
      setAttempt((n) => n + 1);
      return;
    }
    // What this hold agreed to. The dialog can be closed and reopened while the send is
    // in flight, which resets the form underneath it.
    const sending = {
      chain,
      amount: parsed,
      // Checksummed on Base: viem refuses an all-uppercase address that EIP-55 allows.
      to: normalizeAddressForChain(chain, target),
    };
    setPending(true);
    try {
      const result = await send({ ...sending, asset: "usdc", purpose: "withdraw", maxFeeUsdc: feeUsdc });
      const fee = result.feeUsdc ?? 0;
      setAmount("");
      setMaxed(false);
      setDestination("");
      setQuote(null);
      if (openRef.current) {
        // An uncertain send errored but may already be on its way. Not a failure and not
        // a "hold again" — a second withdrawal would carry a fresh blockhash and could
        // land as well. The receipt says how long to wait before it cannot.
        setReceipt({ kind: result.uncertain ? "unconfirmed" : "sent", ...sending, feeUsdc: fee, hash: result.hash });
      } else if (result.uncertain) {
        // Closed mid-send: the outcome still has to reach them. The blockhash is what
        // bounds the wait: two minutes and it cannot land.
        toast.warning("Withdrawal not confirmed yet", {
          description: `${truncateAddress(result.hash, 8, 6)} — the network didn't confirm it while Tocker was watching, and it may still arrive. If your balance hasn't dropped within two minutes, it didn't go, and you can send it again.`,
          duration: 15_000,
        });
      } else {
        toast.success("Withdrawal sent", {
          description: `${truncateAddress(result.hash, 8, 6)} — ${
            fee > 0 ? `includes the ${formatUsd(fee)} account fee; ` : ""
          }your balance updates once it confirms.`,
        });
      }
      void refresh();
      void refresh(12_000);
      // Base is read from Privy's indexer, which can trail the chain by minutes.
      if (sending.chain === "base") void refresh(45_000);
      if (result.uncertain) void refresh(120_000);
    } catch (error) {
      // The quote may be what went stale (the account was opened, SOL moved). Dropping it
      // makes the modal ask again, so the fee on screen is the fee the next hold agrees to.
      setQuote(null);
      if (error instanceof Error && error.name === "TransferStatusUnknown") {
        // The request that submits the signed transfer got no answer, so it may have gone.
        // Never "failed": that invites a second hold on top of a first that landed.
        toast.warning("Withdrawal status unknown", { description: error.message, duration: 15_000 });
        void refresh();
        void refresh(12_000);
        void refresh(120_000);
      } else {
        toast.error("Withdrawal failed", {
          description: error instanceof Error ? error.message : "Your wallet rejected the request.",
        });
      }
    } finally {
      setPending(false);
      setAttempt((n) => n + 1);
    }
  };

  // One line under the amount: what is wrong with it (`amountHint`, in red), or else
  // what the reader needs to know to enter one (`amountHelp`).
  let amountHint: ReactNode = null;
  let amountHelp: ReactNode;
  if (belowMinimum) {
    // The reason, not just the rule, and the same sentence whatever was typed: with this
    // balance every amount is either under the minimum or over what is there.
    const reason = `${
      feeUsdc > 0
        ? `After the ${formatUsd(feeUsdc)} new account fee you can send ${formatUsd(sendable)} on ${chainLabelFor(chain)}.`
        : `You have ${formatUsd(sendable)} on ${chainLabelFor(chain)}.`
    } The smallest withdrawal there is ${formatUsd(minAmount)}, because Tocker pays the network fee.`;
    if (entered) amountHint = reason;
    else amountHelp = reason;
  } else if (underMinimum) {
    amountHint = `The smallest withdrawal on ${chainLabelFor(chain)} is ${formatUsd(minAmount)}.`;
  } else if (overBalance) {
    amountHint =
      feeUsdc > 0
        ? `With the ${formatUsd(feeUsdc)} account fee, the most you can send here is ${formatUsd(sendable)}.`
        : `The most you can send on ${chainLabelFor(chain)} is ${formatUsd(sendable)}.`;
  } else if (maxed && feeUsdc > 0) {
    // Why the amount just dropped under their thumb.
    amountHelp = `Max is ${formatUsd(sendable)} after the ${formatUsd(feeUsdc)} new account fee.`;
  } else if (destinationOk && !entered) {
    // The address is in and the hold is still disabled: say what it is waiting for.
    amountHelp = `Enter an amount to send. You have ${formatUsd(sendable)} on ${chainLabelFor(chain)}.`;
  } else {
    amountHelp = `${formatUsd(sendable)} on ${chainLabelFor(chain)} · ${formatUsd(shownCashTotal(cash))} across your wallets`;
  }

  const empty = cash.totalUsd === 0;
  // Agents holding nothing are not somewhere to send the reader.
  const fundedAgents = cash.agents.filter((agent) => agent.equityUsd > 0);
  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Scrolls inside itself when it is taller than the screen: with an address in, the
          cost box open and the notes under each field, the hold button would otherwise
          sit below the fold of a small phone with no way to reach it. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{receipt ? receiptTitle(receipt) : "Withdraw to crypto wallet"}</DialogTitle>
          <DialogDescription className={receipt ? "tnum" : undefined}>
            {receipt
              ? receiptDescription(receipt)
              : "USDC from your Tocker cash to any address you choose. Network fees are on us."}
          </DialogDescription>
        </DialogHeader>
        {/* Always mounted, so the outcome is announced when it arrives: the toast that used
            to say it is gone, and a region inserted with its text already in it is skipped. */}
        <span role="status" aria-live="polite" className="sr-only">
          {receipt ? `${receiptTitle(receipt)}. ${receiptDescription(receipt)}` : ""}
        </span>

        {receipt ? (
          <WithdrawReceipt receipt={receipt} onDone={close} />
        ) : empty ? (
          <WithdrawEmpty
            agents={fundedAgents}
            inAgentsUsd={cash.inAgentsUsd}
            onDeposit={onDeposit}
            onNavigate={close}
          />
        ) : (
        /* min-w-0: a grid item's floor is its content, so one long unbreakable child
           would otherwise widen the whole form past the dialog's padding. */
        <div className="min-w-0 space-y-3">
          <div>
            <label htmlFor="withdraw-chain" className="mb-1 block text-xs text-muted-foreground">
              Chain
            </label>
            <SimpleSelect
              id="withdraw-chain"
              value={chain}
              options={(wallets.length ? wallets : [{ chain: "base" as Chain }]).map((entry) => ({
                value: entry.chain,
                label: chainLabelFor(entry.chain),
                // What can leave from there, so the pick is made with the number in view.
                hint: `${formatUsd(floorCents(cashOn(cash, entry.chain).usdc))} USDC`,
              }))}
              // Nothing the hold agreed to can change under a send in flight.
              disabled={pending}
              onChange={(next) => {
                setChain(next as Chain);
                // An address for one chain is never valid on the other, and neither is its Max.
                setDestination("");
                setQuote(null);
                setMaxed(false);
              }}
            />
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Sent as USDC on {NETWORK_WORDING[chain].network}. The receiving wallet or exchange must be set to
              the same network.
            </p>
          </div>

          <div>
            <label htmlFor="withdraw-amount" className="mb-1 block text-xs text-muted-foreground">
              Amount (USDC)
            </label>
            {/* The unit on both sides, as the builder and manual trade show it: a bare field
                beside "$12.34 USDC" and "Hold to send $120.50" left the reader to guess. */}
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-2.5 grid place-items-center font-mono text-sm text-muted-foreground"
              >
                $
              </span>
              <Input
                id="withdraw-amount"
                value={fieldAmount}
                disabled={pending}
                // No role="alert" on the hint: it would announce on every keystroke.
                aria-invalid={amountHint ? true : undefined}
                aria-describedby={amountHint ? "withdraw-amount-error" : "withdraw-amount-help"}
                inputMode="decimal"
                placeholder="0.00"
                onChange={(event) => {
                  setMaxed(false);
                  setAmount(sanitizeUsdInput(event.target.value));
                }}
                className="tnum pr-12 pl-6 font-mono"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-2.5 grid place-items-center text-xs text-muted-foreground"
              >
                USDC
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              {PERCENT_CHIPS.map((chip) => {
                const isMax = chip.fraction === 1;
                return (
                  <button
                    key={chip.label}
                    type="button"
                    // No fraction of a balance under the minimum can be sent.
                    disabled={pending || belowMinimum}
                    aria-pressed={isMax ? maxed : undefined}
                    onClick={() => {
                      setMaxed(isMax);
                      // Against what can actually leave: the balance, less the account fee
                      // when this address needs one. Cents always, so a chip reads 120.50
                      // like every other amount here, not 120.5. Max keeps no number of its
                      // own (see `maxed`), so leaving the mode leaves an empty field rather
                      // than a figure worked out for another chain.
                      setAmount(isMax ? "" : floorCents(spendable * chip.fraction).toFixed(2));
                    }}
                    className={cn(
                      "h-7 flex-1 rounded-lg border border-border text-xs text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
                      isMax && maxed && "bg-muted/60 text-foreground",
                    )}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
            {amountHint ? (
              <p id="withdraw-amount-error" className="tnum mt-2 text-xs text-destructive">
                {amountHint}
              </p>
            ) : (
              <p id="withdraw-amount-help" className="tnum mt-2 text-xs text-muted-foreground">
                {amountHelp}
              </p>
            )}
            {cash.inAgentsUsd > 0 ? (
              // The top bar counts this money, and this form cannot send it.
              <p className="tnum mt-1 text-xs text-muted-foreground">
                Another {formatUsd(cash.inAgentsUsd)} is in your agents.{" "}
                <Link
                  href={fundedAgents.length === 1 ? agentWithdrawHref(fundedAgents[0].slug) : "/agents"}
                  onClick={close}
                  className="rounded underline underline-offset-2 transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  Move it to your cash
                </Link>{" "}
                to withdraw it.
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="withdraw-destination"
              className="mb-1 block text-xs text-muted-foreground"
            >
              Destination address
            </label>
            <Input
              id="withdraw-destination"
              value={destination}
              disabled={pending}
              placeholder={chain === "base" ? "0x…" : "Solana address"}
              onChange={(event) => setDestination(event.target.value)}
              // Addresses are pasted, never suggested from form history — that is where
              // a poisoned look-alike would come from.
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={target && addressProblem ? true : undefined}
              aria-describedby={target && addressProblem ? "withdraw-destination-error" : undefined}
              // The primitive's size, not "text-xs": 16px on phones, where iOS zooms into
              // any focused field smaller than that.
              className="font-mono"
            />
            {target && addressProblem ? (
              <p id="withdraw-destination-error" className="mt-1 text-[11px] text-destructive">
                {addressProblem}
              </p>
            ) : null}
            {quoteError ? (
              <p className="mt-1 text-[11px] leading-relaxed text-destructive">
                {quoteError}{" "}
                {needsSync ? (
                  <button
                    type="button"
                    onClick={() => void syncAndRequote()}
                    disabled={syncing}
                    className="underline underline-offset-2 hover:text-foreground disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {syncing ? "Syncing…" : "Sync wallets"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setQuote(null)}
                    className="underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    Check again
                  </button>
                )}
              </p>
            ) : null}
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Tocker can&rsquo;t attach a memo or tag. If your exchange asks for one on USDC deposits, send to a
              personal wallet instead.
            </p>
          </div>

          {destinationOk && !quoteError ? (
            <div
              role="group"
              aria-label="What this withdrawal costs"
              aria-live="polite"
              className="space-y-1.5 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-xs"
            >
              {/* Every character, before the hold: a vanity look-alike matches the first
                  and last few, so a truncated address is not something to check against. */}
              <div className="space-y-0.5 border-b border-border/60 pb-1.5">
                <span className="text-muted-foreground">Sending to</span>
                <FullAddress address={target} className="flex" />
              </div>
              <FeeRow label="Network fee" value="Covered by Tocker" />
              {quoteLoading ? (
                <FeeRow
                  label="Recipient account"
                  value={<span className="text-muted-foreground motion-safe:animate-pulse">Checking…</span>}
                />
              ) : null}
              {feeUsdc > 0 ? (
                <div className="animate-in fade-in slide-in-from-top-1 duration-200 ease-out motion-reduce:animate-none">
                  <FeeRow label="New account fee" value={`${formatUsd(feeUsdc)} USDC`} />
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    One time. This address has never held USDC on Solana, so its USDC account has to
                    be opened first.
                  </p>
                </div>
              ) : null}
              {validAmount ? (
                <div className="space-y-1.5 border-t border-border/60 pt-1.5">
                  <FeeRow label="They receive" value={`${formatUsd(parsed)} USDC`} />
                  {feeUsdc > 0 ? (
                    <FeeRow label="From your cash" value={formatUsd(parsed + feeUsdc)} strong />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {available ? null : (
            <p className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
              Withdrawals aren&rsquo;t available in this environment yet.
            </p>
          )}

          {/* A hold, not a click: the signature is silent now (no wallet popup), so this
              gesture is the confirmation, and money leaving the app deserves one. The label
              carries the amount only — the full destination is spelled out above, where a
              look-alike address can actually be checked, and a nowrap label with both
              overflowed a phone. It never says "Sent": the hold ends before anything is
              signed, so it holds at a pending label and the receipt reports the outcome. */}
          <HoldToConfirmButton
            key={attempt}
            duration={1_400}
            resetDelay={0}
            disabled={!canSend}
            icon={<ArrowUpRight size={14} strokeWidth={2} />}
            label={pending ? "Sending…" : validAmount ? `Hold to send ${formatUsd(parsed)}` : "Hold to send"}
            confirmedLabel="Sending…"
            onConfirm={() => void confirm()}
            className={cn(
              MORPH_FOCUS,
              "h-10 w-full justify-center rounded-xl border-primary/40 bg-primary/10 text-sm font-medium text-foreground hover:bg-primary/15 dark:border-primary/40 dark:bg-primary/10 dark:text-foreground dark:hover:bg-primary/15",
              // Neutral, not the library's emerald: nothing has succeeded yet.
              pending &&
                "border-border bg-muted text-muted-foreground dark:border-border dark:bg-muted dark:text-muted-foreground",
            )}
          />
          {pending ? (
            // A co-signed Solana send waits for the network; say so, or 20 seconds of
            // "Sending…" reads as a hang and the window gets closed.
            <p role="status" className="text-center text-[11px] leading-relaxed text-muted-foreground">
              Sending. This usually takes under 15 seconds. Keep this window open.
            </p>
          ) : null}
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FeeRow({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "tnum font-medium text-foreground" : "tnum text-foreground"}>{value}</span>
    </div>
  );
}
