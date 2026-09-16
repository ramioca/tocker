"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/agents/builder/simple-select";
import { truncateAddress } from "@/components/common/format";
import { secureWithdrawAction } from "@/server/actions/security";
import { isValidAddressForChain, addressHintForChain } from "@/lib/wallet-address";
import { cn } from "@/lib/utils";
import type { AgentDetail, Chain, WalletBalance } from "@/server/types";

function assetAmount(balances: WalletBalance[], chain: Chain, asset: "usdc" | "native"): number | null {
  const wallet = balances.find((w) => w.chain === chain);
  if (!wallet) return null;
  const row = wallet.balances.find((b) =>
    asset === "usdc" ? b.asset.toLowerCase() === "usdc" : b.asset.toLowerCase() !== "usdc",
  );
  return row ? row.amount : 0;
}

export function WithdrawForm({
  agent,
  balances = [],
}: {
  agent: AgentDetail;
  balances?: WalletBalance[];
}) {
  const router = useRouter();
  const [chain, setChain] = useState<Chain>(agent.chains[0] ?? "base");
  const [asset, setAsset] = useState<"usdc" | "native">("usdc");
  const [amount, setAmount] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [pending, setPending] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const assetLabel = asset === "usdc" ? "USDC" : chain === "solana" ? "SOL" : "ETH";
  const available = useMemo(() => assetAmount(balances, chain, asset), [balances, chain, asset]);
  const amountNum = Number(amount);

  const addressValid = toAddress.trim().length === 0 || isValidAddressForChain(chain, toAddress);
  const overBalance = available !== null && amount.length > 0 && amountNum > available;
  const canReview =
    amount.length > 0 &&
    amountNum > 0 &&
    !overBalance &&
    toAddress.trim().length > 0 &&
    isValidAddressForChain(chain, toAddress);

  /**
   * Goes through `secureWithdrawAction`, not the plain one: a withdrawal requires
   * an enrolled second factor on the account and writes an audit row with the
   * amount, the destination and the resulting transaction hash. The address is
   * re-validated server-side against the chosen chain before anything is signed —
   * a Base address pasted into a Solana withdrawal is money gone.
   */
  const send = async () => {
    setPending(true);
    const result = await secureWithdrawAction({
      agentId: agent.id,
      chain,
      asset,
      amount: amountNum,
      toAddress: toAddress.trim(),
    });
    setPending(false);

    if (!result.ok) {
      toast.error("Withdrawal failed", { description: result.error });
      return;
    }
    toast.success("Withdrawal sent", { description: truncateAddress(result.data.txHash, 8, 6) });
    setAmount("");
    setToAddress("");
    setReviewing(false);
    router.refresh();
  };

  return (
    <section className="rounded-xl border border-border/70 bg-card/30 p-4">
      <div className="flex items-center gap-2">
        <ArrowDownToLine aria-hidden className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Withdraw</h2>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Moves funds out of the agent&apos;s wallet. It can only trade with what is left. Requires a second factor
        on your account and is recorded in your{" "}
        <Link href="/settings/security" className="text-foreground underline underline-offset-2">
          audit log
        </Link>
        .
      </p>

      {reviewing ? (
        <div className="mt-3 space-y-3">
          <dl className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="tnum font-mono font-medium">
                {amount} {assetLabel}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Network</dt>
              <dd>{chain === "solana" ? "Solana" : "Base"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">To</dt>
              <dd className="font-mono text-xs">{truncateAddress(toAddress.trim(), 6, 6)}</dd>
            </div>
          </dl>
          <p className="text-xs text-destructive">
            This sends real funds on-chain and cannot be undone. Check the address.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setReviewing(false)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft aria-hidden className="size-3.5" />
              Back
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void send()}
              className="inline-flex h-8 items-center rounded-lg bg-destructive px-3 text-xs font-semibold text-destructive-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-destructive/90 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {pending ? "Sending…" : `Confirm — send ${amount} ${assetLabel}`}
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canReview) setReviewing(true);
          }}
          className="mt-3 space-y-3"
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="withdraw-chain" className="mb-1 block text-xs text-muted-foreground">
                Chain
              </label>
              <SimpleSelect
                id="withdraw-chain"
                value={chain}
                options={agent.wallets.map((wallet) => ({
                  value: wallet.chain,
                  label: wallet.chain === "solana" ? "Solana" : "Base",
                }))}
                onChange={(next) => setChain(next as Chain)}
              />
            </div>
            <div>
              <label htmlFor="withdraw-asset" className="mb-1 block text-xs text-muted-foreground">
                Asset
              </label>
              <SimpleSelect
                id="withdraw-asset"
                value={asset}
                options={[
                  { value: "usdc", label: "USDC" },
                  { value: "native", label: chain === "solana" ? "SOL" : "ETH" },
                ]}
                onChange={(next) => setAsset(next as "usdc" | "native")}
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor="withdraw-amount" className="block text-xs text-muted-foreground">
                Amount
              </label>
              {available !== null ? (
                <button
                  type="button"
                  onClick={() => setAmount(String(available))}
                  className="tnum rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Balance {available.toLocaleString("en-US", { maximumFractionDigits: 4 })} {assetLabel} · Max
                </button>
              ) : null}
            </div>
            <Input
              id="withdraw-amount"
              value={amount}
              inputMode="decimal"
              placeholder="100"
              aria-invalid={overBalance}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
              className="tnum font-mono"
            />
            {overBalance ? (
              <p className="mt-1 text-xs text-destructive">
                More than the agent holds ({available?.toLocaleString("en-US", { maximumFractionDigits: 4 })} {assetLabel}).
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="withdraw-to" className="mb-1 block text-xs text-muted-foreground">
              Destination address
            </label>
            <Input
              id="withdraw-to"
              value={toAddress}
              placeholder={chain === "solana" ? "7xKX…MpTqL" : "0x9A3f…8d90"}
              aria-invalid={!addressValid}
              onChange={(event) => setToAddress(event.target.value)}
              className="font-mono text-xs"
            />
            {!addressValid ? (
              <p className="mt-1 text-xs text-destructive">{addressHintForChain(chain)}</p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={!canReview}
            className={cn(
              "inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium",
              "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "hover:bg-muted active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            Review withdrawal
          </button>
        </form>
      )}
    </section>
  );
}
