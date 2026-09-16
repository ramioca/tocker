"use client";

import { useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";
import type { Chain, WalletBalance } from "@/server/types";

const PERCENT_CHIPS = [
  { label: "10%", fraction: 0.1 },
  { label: "25%", fraction: 0.25 },
  { label: "50%", fraction: 0.5 },
  { label: "Max", fraction: 1 },
] as const;

/**
 * Withdraw USDC from the user's embedded wallet to any external address —
 * amount with percentage chips against the available balance, then one explicit
 * confirm. Signing happens client-side with the user's own Privy embedded
 * wallet; the server never holds this key.
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
  const { send, available } = useTransfer();
  const refresh = useRefreshCash();

  const cash = useMemo(() => unifiedCash(wallets), [wallets]);
  const chainCash = cashOn(cash, chain);
  const availableUsdc = chainCash.usdc;
  const parsed = Number(amount);
  const validAmount = Number.isFinite(parsed) && parsed > 0 && parsed <= availableUsdc;
  const destinationOk = isValidAddressForChain(chain, destination);

  const summary = useMemo(
    () =>
      validAmount && destinationOk
        ? `${parsed} USDC → ${truncateAddress(destination.trim(), 6, 6)}`
        : null,
    [validAmount, destinationOk, parsed, destination],
  );

  const confirm = async () => {
    if (!validAmount || !destinationOk || pending) return;
    setPending(true);
    try {
      const result = await send({
        chain,
        asset: "usdc",
        amount: parsed,
        to: destination.trim(),
      });
      toast.success("Withdrawal sent", {
        description: `${truncateAddress(result.hash, 8, 6)} — your balance updates once it confirms.`,
      });
      setAmount("");
      setDestination("");
      onOpenChange(false);
      void refresh();
      void refresh(12_000);
    } catch (error) {
      toast.error("Withdrawal failed", {
        description: error instanceof Error ? error.message : "Your wallet rejected the request.",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Withdraw to crypto wallet</DialogTitle>
          <DialogDescription>
            USDC from your Tocker cash to any address you choose.
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
                  onClick={() =>
                    setAmount(String(Math.floor(availableUsdc * chip.fraction * 100) / 100))
                  }
                  className="h-7 flex-1 rounded-lg border border-border text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <p className="tnum mt-2 text-xs text-muted-foreground">
              {formatUsd(chainCash.usdcUsd)} on {chainLabelFor(chain)} ·{" "}
              {formatUsd(cash.totalUsd)} in total
            </p>
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
            {destination.trim() && !destinationOk ? (
              <p className="mt-1 text-[11px] text-destructive">{addressHintForChain(chain)}</p>
            ) : null}
          </div>

          {available ? null : (
            <p className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
              In-app withdrawals need Privy configured. Export your embedded wallet from Settings
              and send from any wallet for now.
            </p>
          )}

          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!validAmount || !destinationOk || pending || !available}
            className={cn(
              "flex h-10 w-full items-center justify-center rounded-xl bg-primary text-sm font-medium text-primary-foreground",
              "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.98]",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 disabled:active:scale-100",
            )}
          >
            {pending
              ? "Waiting for your wallet to confirm…"
              : summary
                ? `Send ${summary}`
                : "Continue"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
