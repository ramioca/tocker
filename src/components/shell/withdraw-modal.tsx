"use client";

import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { formatUsd, truncateAddress } from "@/components/common/format";
import { useRefreshCash } from "@/components/wallets/use-cash";
import { useTransfer } from "@/components/wallets/use-transfer";
import { addressHintForChain, isValidAddressForChain } from "@/lib/wallet-address";
import { NETWORK_WORDING, cashOn, chainLabelFor, unifiedCash } from "@/lib/wallets/funding";
import { quoteSponsoredWithdrawal } from "@/server/actions/sponsored-withdraw";
import type { Chain, WalletBalance } from "@/server/types";

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

const floorCents = (value: number) => Math.floor(value * 100 + 1e-9) / 100;

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
 * USDC has to leave from where it actually is, and the chain picker says so.
 */
export function WithdrawModal({
  open,
  onOpenChange,
  wallets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallets: WalletBalance[];
}) {
  const [chain, setChain] = useState<Chain>(wallets[0]?.chain ?? "base");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [pending, setPending] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const { send, available } = useTransfer();
  const refresh = useRefreshCash();

  const cash = useMemo(() => unifiedCash(wallets), [wallets]);
  const chainCash = cashOn(cash, chain);
  const availableUsdc = chainCash.usdc;
  const target = destination.trim();
  const destinationOk = isValidAddressForChain(chain, destination);

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
  const feeUsdc = ready?.feeUsdc ?? 0;
  const minAmount = chain === "solana" ? (ready?.minAmountUsdc ?? DEFAULT_SOLANA_MIN) : 0;
  const spendable = Math.max(0, availableUsdc - feeUsdc);

  const parsed = Number(amount);
  const entered = Number.isFinite(parsed) && parsed > 0;
  const underMinimum = entered && parsed < minAmount;
  const overBalance = entered && parsed + feeUsdc > availableUsdc + 1e-9;
  const validAmount = entered && !underMinimum && !overBalance;
  const quoteReady = chain !== "solana" || ready !== null;
  const canSend = validAmount && destinationOk && quoteReady && !pending && available;

  const summary = useMemo(
    () => (validAmount && destinationOk ? `${parsed} USDC → ${truncateAddress(target, 6, 6)}` : null),
    [validAmount, destinationOk, parsed, target],
  );

  const confirm = async () => {
    if (!canSend) return;
    setPending(true);
    try {
      const result = await send({
        chain,
        asset: "usdc",
        amount: parsed,
        to: target,
        purpose: "withdraw",
        maxFeeUsdc: feeUsdc,
      });
      const fee = result.feeUsdc ?? 0;
      if (result.uncertain) {
        // The send errored but may already be on its way. Not a failure toast and not a
        // "hold again" — a second withdrawal would carry a fresh blockhash and could land
        // as well. The blockhash is what bounds the wait: two minutes and it cannot land.
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
      setAmount("");
      setDestination("");
      setQuote(null);
      onOpenChange(false);
      void refresh();
      void refresh(12_000);
      if (result.uncertain) void refresh(120_000);
    } catch (error) {
      // The quote may be what went stale (the account was opened, SOL moved). Dropping it
      // makes the modal ask again, so the fee on screen is the fee the next hold agrees to.
      setQuote(null);
      toast.error("Withdrawal failed", {
        description: error instanceof Error ? error.message : "Your wallet rejected the request.",
      });
    } finally {
      setPending(false);
    }
  };

  let amountHint: ReactNode = null;
  if (underMinimum) {
    amountHint = `The smallest withdrawal on ${chainLabelFor(chain)} is ${formatUsd(minAmount)}.`;
  } else if (overBalance) {
    amountHint =
      feeUsdc > 0
        ? `With the ${formatUsd(feeUsdc)} account fee, the most you can send here is ${formatUsd(floorCents(spendable))}.`
        : `You have ${formatUsd(availableUsdc)} on ${chainLabelFor(chain)}.`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Withdraw to crypto wallet</DialogTitle>
          <DialogDescription>
            USDC from your Tocker cash to any address you choose. Network fees are on us.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
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
              }))}
              onChange={(next) => setChain(next as Chain)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Leaves on {NETWORK_WORDING[chain].network}. Make sure the destination accepts it.
            </p>
          </div>

          <div>
            <label htmlFor="withdraw-amount" className="mb-1 block text-xs text-muted-foreground">
              Amount
            </label>
            <Input
              id="withdraw-amount"
              value={amount}
              inputMode="decimal"
              placeholder="0"
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
              className="tnum font-mono"
            />
            <div className="mt-2 flex items-center gap-1.5">
              {PERCENT_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  // Against what can actually leave: the balance, less the account fee
                  // when this address needs one — so "Max" is always sendable.
                  onClick={() => setAmount(String(floorCents(spendable * chip.fraction)))}
                  className="h-7 flex-1 rounded-lg border border-border text-xs text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97]"
                >
                  {chip.label}
                </button>
              ))}
            </div>
            {amountHint ? (
              <p className="tnum mt-2 text-xs text-destructive">{amountHint}</p>
            ) : (
              <p className="tnum mt-2 text-xs text-muted-foreground">
                {formatUsd(chainCash.usdcUsd)} on {chainLabelFor(chain)} · {formatUsd(cash.totalUsd)} in total
              </p>
            )}
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
              placeholder={chain === "base" ? "0x…" : "Solana address"}
              onChange={(event) => setDestination(event.target.value)}
              className="font-mono text-xs"
            />
            {target && !destinationOk ? (
              <p className="mt-1 text-[11px] text-destructive">{addressHintForChain(chain)}</p>
            ) : null}
            {quoteError ? (
              <p className="mt-1 text-[11px] leading-relaxed text-destructive">
                {quoteError}{" "}
                <button
                  type="button"
                  onClick={() => setQuote(null)}
                  className="underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  Check again
                </button>
              </p>
            ) : null}
          </div>

          {destinationOk && !quoteError ? (
            <div
              role="group"
              aria-label="What this withdrawal costs"
              aria-live="polite"
              className="space-y-1.5 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-xs"
            >
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
              {feeUsdc > 0 && validAmount ? (
                <div className="space-y-1.5 border-t border-border/60 pt-1.5">
                  <FeeRow label="They receive" value={`${formatUsd(parsed)} USDC`} />
                  <FeeRow label="From your cash" value={formatUsd(parsed + feeUsdc)} strong />
                </div>
              ) : null}
            </div>
          ) : null}

          {available ? null : (
            <p className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
              In-app withdrawals are not available in this environment. Export your wallet from
              Settings and send from any wallet for now.
            </p>
          )}

          {/* A hold, not a click: the signature is silent now (no wallet popup), so this
              gesture is the confirmation, and money leaving the app deserves one. */}
          <HoldToConfirmButton
            duration={1_400}
            disabled={!canSend}
            label={pending ? "Sending…" : summary ? `Hold to send ${summary}` : "Hold to send"}
            confirmedLabel="Sent"
            onConfirm={() => void confirm()}
            className="h-10 w-full justify-center rounded-xl border-primary/40 bg-primary/10 text-sm font-medium text-foreground hover:bg-primary/15 dark:border-primary/40 dark:bg-primary/10 dark:text-foreground dark:hover:bg-primary/15"
          />
        </div>
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
