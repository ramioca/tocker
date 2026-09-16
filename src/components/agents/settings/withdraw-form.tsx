"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/agents/builder/simple-select";
import { truncateAddress } from "@/components/common/format";
import { secureWithdrawAction } from "@/server/actions/security";
import { cn } from "@/lib/utils";
import type { AgentDetail, Chain } from "@/server/types";

/**
 * A withdrawal is irreversible and goes to an address the operator types by hand,
 * so this form does three things beyond taking the numbers:
 *
 *  - it goes through `secureWithdrawAction`, which requires an enrolled second
 *    factor and writes an audit row;
 *  - it validates the destination against the *chosen chain's* address format
 *    before anything is signed, because a Base address pasted into a Solana
 *    withdrawal is money gone; and
 *  - it says the destination back to you, truncated, before you can submit.
 */
export function WithdrawForm({ agent }: { agent: AgentDetail }) {
  const router = useRouter();
  const [chain, setChain] = useState<Chain>(agent.chains[0] ?? "base");
  const [asset, setAsset] = useState<"usdc" | "native">("usdc");
  const [amount, setAmount] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [pending, setPending] = useState(false);

  const destination = toAddress.trim();
  const addressLooksRight =
    chain === "base" ? /^0x[a-fA-F0-9]{40}$/.test(destination) : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(destination);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    const result = await secureWithdrawAction({
      agentId: agent.id,
      chain,
      asset,
      amount: Number(amount),
      toAddress: destination,
    });
    setPending(false);

    if (!result.ok) {
      toast.error("Withdrawal failed", { description: result.error });
      return;
    }
    toast.success("Withdrawal sent", { description: truncateAddress(result.data.txHash, 8, 6) });
    setAmount("");
    router.refresh();
  };

  return (
    <section className="glass rounded-xl border border-border/70 bg-card/30 p-4">
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

      <form onSubmit={submit} className="mt-3 space-y-3">
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
          <label htmlFor="withdraw-amount" className="mb-1 block text-xs text-muted-foreground">
            Amount
          </label>
          <Input
            id="withdraw-amount"
            value={amount}
            inputMode="decimal"
            placeholder="100"
            onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
            className="tnum font-mono"
          />
        </div>

        <div>
          <label htmlFor="withdraw-to" className="mb-1 block text-xs text-muted-foreground">
            Destination address
          </label>
          <Input
            id="withdraw-to"
            value={toAddress}
            placeholder={chain === "solana" ? "7xKX…MpTqL" : "0x9A3f…8d90"}
            onChange={(event) => setToAddress(event.target.value)}
            aria-invalid={destination.length > 0 && !addressLooksRight}
            aria-describedby="withdraw-to-hint"
            className="font-mono text-xs"
          />
          <p id="withdraw-to-hint" className="mt-1 text-xs text-muted-foreground">
            {destination.length === 0 ? (
              <>
                A {chain === "solana" ? "Solana" : "Base"} address. Sending to the wrong chain&rsquo;s address
                loses the funds.
              </>
            ) : addressLooksRight ? (
              <span className="inline-flex items-center gap-1 text-positive">
                <ShieldCheck aria-hidden className="size-3" />
                Sending to {truncateAddress(destination, 8, 6)} on {chain === "solana" ? "Solana" : "Base"}
              </span>
            ) : (
              <span className="text-destructive">
                That is not a {chain === "solana" ? "Solana" : "Base"} address.
              </span>
            )}
          </p>
        </div>

        <button
          type="submit"
          disabled={pending || Number(amount) <= 0 || !addressLooksRight}
          className={cn(
            "inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium",
            "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
            "hover:bg-muted active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {pending ? "Sending…" : "Withdraw"}
        </button>
      </form>
    </section>
  );
}
