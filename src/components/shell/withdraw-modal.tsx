"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { encodeFunctionData, parseUnits } from "viem";
import { useSendTransaction } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
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
import { cn } from "@/lib/utils";
import type { Chain, WalletBalance } from "@/server/types";

/** Base USDC mint — the same constant the funding drawer uses. */
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const PERCENT_CHIPS = [
  { label: "10%", fraction: 0.1 },
  { label: "25%", fraction: 0.25 },
  { label: "50%", fraction: 0.5 },
  { label: "Max", fraction: 1 },
] as const;

const ME_WALLETS_QUERY_KEY = ["me-wallets"] as const;

function usdcAmount(wallet: WalletBalance | undefined): number {
  const usdc = wallet?.balances.find((b) => b.asset === "usdc");
  return usdc?.amount ?? 0;
}

/**
 * Withdraw USDC from the user's embedded wallet to any external address —
 * fomo's withdraw card: amount with percentage chips against the available
 * balance, then one explicit confirm. Signing happens client-side with the
 * user's own Privy embedded wallet; the server never holds this key.
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
  const { sendTransaction } = useSendTransaction();
  const queryClient = useQueryClient();

  const wallet = wallets.find((entry) => entry.chain === chain) ?? wallets[0];
  const available = usdcAmount(wallet);
  const parsed = Number(amount);
  const validAmount = Number.isFinite(parsed) && parsed > 0 && parsed <= available;
  const destinationOk =
    chain === "base"
      ? /^0x[a-fA-F0-9]{40}$/.test(destination.trim())
      : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(destination.trim());

  const summary = useMemo(
    () => (validAmount && destinationOk ? `${parsed} USDC → ${truncateAddress(destination.trim(), 6, 6)}` : null),
    [validAmount, destinationOk, parsed, destination],
  );

  const confirm = async () => {
    if (!validAmount || !destinationOk || pending) return;
    if (chain === "solana") {
      toast.info("Solana withdrawals are not in-app yet", {
        description:
          "They land with the runtime workstream. For now, export your embedded wallet in Settings and send from any Solana wallet.",
      });
      return;
    }

    setPending(true);
    try {
      const result = await sendTransaction({
        to: BASE_USDC,
        data: encodeFunctionData({
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [destination.trim() as `0x${string}`, parseUnits(amount, 6)],
        }),
        chainId: 8453,
      });
      toast.success("Withdrawal sent", {
        description: `${truncateAddress(result.hash, 8, 6)} — your balance updates once it confirms.`,
      });
      setAmount("");
      setDestination("");
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ME_WALLETS_QUERY_KEY });
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
          <DialogDescription>USDC from your Tocker cash wallet to any address you choose.</DialogDescription>
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
                label: entry.chain === "solana" ? "Solana" : "Base",
              }))}
              onChange={(next) => setChain(next as Chain)}
            />
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
                  onClick={() => setAmount(String(Math.floor(available * chip.fraction * 100) / 100))}
                  className="h-7 flex-1 rounded-lg border border-border text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <p className="tnum mt-2 text-xs text-muted-foreground">
              Available balance {formatUsd(available)}
            </p>
          </div>

          <div>
            <label htmlFor="withdraw-destination" className="mb-1 block text-xs text-muted-foreground">
              Destination address
            </label>
            <Input
              id="withdraw-destination"
              value={destination}
              placeholder={chain === "base" ? "0x…" : "Solana address"}
              onChange={(event) => setDestination(event.target.value)}
              className="font-mono text-xs"
            />
          </div>

          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!validAmount || !destinationOk || pending}
            className={cn(
              "flex h-10 w-full items-center justify-center rounded-xl bg-primary text-sm font-medium text-primary-foreground",
              "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.98]",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 disabled:active:scale-100",
            )}
          >
            {pending ? "Confirming…" : summary ? `Send ${summary}` : "Continue"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
