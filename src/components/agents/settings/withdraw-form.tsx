"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/agents/builder/simple-select";
import { truncateAddress } from "@/components/common/format";
import { FullAddress } from "@/components/common/address";
import { useUserWallets } from "@/components/wallets/use-cash";
import { useSession } from "@/hooks/use-session";
import { secureWithdrawAction } from "@/server/actions/security";
import { isValidAddressForChain, addressHintForChain } from "@/lib/wallet-address";
import {
  MIN_SOL_SEND,
  NATIVE_SYMBOL,
  NETWORK_WORDING,
  chainLabelFor,
  hasLeftoverNative,
  nativeKeptBack,
  userFacingTransferError,
  withdrawableNative,
} from "@/lib/wallets/funding";
import { cn } from "@/lib/utils";
import type { AgentDetail, Chain, WalletBalance } from "@/server/types";

function assetAmount(balances: WalletBalance[], chain: Chain, asset: "usdc" | "native"): number | null {
  const wallet = balances.find((w) => w.chain === chain);
  if (!wallet) return null;
  // By symbol, not "whatever is not USDC": a wallet row list can carry other tokens, and
  // the first of those is not the chain's native asset.
  const symbol = asset === "usdc" ? "usdc" : NATIVE_SYMBOL[chain].toLowerCase();
  const row = wallet.balances.find((b) => b.asset.toLowerCase() === symbol);
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
  const { ready, session } = useSession();
  // Already warm on this page — the wallet chip in the top bar uses the same query key.
  const { data: mine } = useUserWallets(Boolean(ready && session));
  const [chain, setChain] = useState<Chain>(agent.chains[0] ?? "base");
  const [asset, setAsset] = useState<"usdc" | "native">("usdc");
  const [amount, setAmount] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [pending, setPending] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  /** The user's own embedded wallet on this chain — where a withdrawal normally goes. */
  const myWallet = useMemo(
    () => (mine?.wallets ?? []).find((wallet) => wallet.chain === chain && wallet.address),
    [mine, chain],
  );

  // USDC is the only thing an agent is ever funded with. SOL or ETH shows up only as a
  // leftover — someone sent some, or it predates Tocker paying every fee — and the form
  // offers it only when there is enough of it to be worth a withdrawal.
  //
  // On Solana the last AGENT_SOL_KEPT stays behind: an agent that pays its own fee is
  // topped up from Tocker's wallet first, and that SOL is not the owner's to take. Offering
  // it would make "withdraw a cent, then withdraw the leftover SOL" a one-click loop that
  // empties the platform's fee wallet a drip at a time.
  const nativeBalance = useMemo(() => assetAmount(balances, chain, "native"), [balances, chain]);
  const leftoverNative = withdrawableNative(chain, nativeBalance);
  const keptNative = nativeKeptBack(chain);
  const offerNative = hasLeftoverNative(leftoverNative);
  const selected: "usdc" | "native" = offerNative ? asset : "usdc";
  const assetLabel = selected === "usdc" ? "USDC" : NATIVE_SYMBOL[chain];
  const usdcAvailable = useMemo(() => assetAmount(balances, chain, "usdc"), [balances, chain]);
  const available = selected === "usdc" ? usdcAvailable : leftoverNative;
  const amountNum = Number(amount);
  /** A SOL withdrawal whose remainder stays with the agent — and pays the fee from there. */
  const keepsNative = selected === "native" && keptNative > 0;

  const addressValid = toAddress.trim().length === 0 || isValidAddressForChain(chain, toAddress);
  const overBalance = available !== null && amount.length > 0 && amountNum > available;
  // Solana will not credit a fresh wallet with less than its rent-exempt minimum.
  const belowSolMinimum =
    selected === "native" && chain === "solana" && amount.length > 0 && amountNum > 0 && amountNum < MIN_SOL_SEND;
  const canReview =
    amount.length > 0 &&
    amountNum > 0 &&
    !overBalance &&
    !belowSolMinimum &&
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
    let result: Awaited<ReturnType<typeof secureWithdrawAction>>;
    try {
      result = await secureWithdrawAction({
        agentId: agent.id,
        chain,
        asset: selected,
        amount: amountNum,
        toAddress: toAddress.trim(),
      });
    } catch {
      // The request itself failed (network drop, deploy): the server may or may not
      // have signed. Say so rather than leaving the button on "Sending…" forever.
      toast.error("Withdrawal status unknown", {
        description: "The connection dropped before Tocker answered. Check the wallet balance and the audit log before retrying.",
      });
      return;
    } finally {
      setPending(false);
    }

    if (!result.ok) {
      // Never the server's raw text: a fee failure there can still read "send SOL to the
      // platform wallet", which is Tocker's to fix and never the owner's. The raw message
      // is in the server log and the audit trail.
      toast.error("Withdrawal failed", { description: userFacingTransferError(result.error, chain, selected) });
      return;
    }

    // W7 H12: `txHash` is null until a step broadcasts, and `pending` is not `sent`.
    // The action id used to be printed here as if it were a signature — it is not one,
    // and no explorer will find it.
    const { txHash, status } = result.data;
    if (status === "succeeded") {
      toast.success("Withdrawal confirmed", {
        description: txHash ? truncateAddress(txHash, 8, 6) : "It landed on chain.",
      });
    } else {
      toast.message("Withdrawal submitted", {
        description: txHash
          ? `${truncateAddress(txHash, 8, 6)} — waiting for it to confirm.`
          : "It is broadcasting. Balances update once it confirms.",
      });
    }
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
        Moves funds out of the agent&apos;s wallet. It can only trade with what is left. A second factor is optional and never required here; every withdrawal is recorded
        in your{" "}
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
              <dd>{chainLabelFor(chain)}</dd>
            </div>
            {keepsNative ? (
              // The agent pays this fee itself, out of the SOL that stays behind — so the
              // row says what stays rather than claiming Tocker covered it.
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Stays in the agent</dt>
                <dd className="tnum font-mono">
                  {keptNative} {NATIVE_SYMBOL[chain]}
                </dd>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Network fee</dt>
                <dd>{NETWORK_WORDING[chain].fees}</dd>
              </div>
            )}
            <div className="flex items-start justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">To</dt>
              <dd className="min-w-0 text-right">
                <FullAddress address={toAddress.trim()} className="justify-end" />
              </dd>
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
          <div className={cn("grid gap-2", offerNative && "grid-cols-2")}>
            <div>
              <label htmlFor="withdraw-chain" className="mb-1 block text-xs text-muted-foreground">
                Chain
              </label>
              <SimpleSelect
                id="withdraw-chain"
                value={chain}
                options={agent.wallets.map((wallet) => ({
                  value: wallet.chain,
                  label: chainLabelFor(wallet.chain),
                }))}
                onChange={(next) => {
                  setChain(next as Chain);
                  // A leftover on one chain says nothing about the other.
                  setAsset("usdc");
                }}
              />
            </div>
            {offerNative ? (
              <div>
                <label htmlFor="withdraw-asset" className="mb-1 block text-xs text-muted-foreground">
                  Asset
                </label>
                <SimpleSelect
                  id="withdraw-asset"
                  value={selected}
                  options={[
                    { value: "usdc", label: "USDC" },
                    { value: "native", label: `Leftover ${NATIVE_SYMBOL[chain]}` },
                  ]}
                  onChange={(next) => setAsset(next as "usdc" | "native")}
                />
              </div>
            ) : null}
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
                  {selected === "native" ? "Leftover" : "Balance"}{" "}
                  {available.toLocaleString("en-US", { maximumFractionDigits: selected === "native" ? 6 : 4 })}{" "}
                  {assetLabel} · Max
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
                More than the agent can withdraw (
                {available?.toLocaleString("en-US", { maximumFractionDigits: selected === "native" ? 6 : 4 })}{" "}
                {assetLabel}).
              </p>
            ) : belowSolMinimum ? (
              <p className="mt-1 text-xs text-destructive">
                Send at least {MIN_SOL_SEND} SOL. Solana refuses less than that to a new wallet.
              </p>
            ) : keepsNative ? (
              <p className="mt-1 text-xs text-muted-foreground">
                The last {keptNative} {NATIVE_SYMBOL[chain]} stays in the agent&apos;s wallet to cover network fees.
              </p>
            ) : null}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor="withdraw-to" className="block text-xs text-muted-foreground">
                Destination address
              </label>
              {myWallet ? (
                <button
                  type="button"
                  onClick={() => setToAddress(myWallet.address ?? "")}
                  className="rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  To my wallet · {truncateAddress(myWallet.address ?? "", 4, 4)}
                </button>
              ) : null}
            </div>
            <Input
              id="withdraw-to"
              value={toAddress}
              placeholder={chain === "solana" ? "7xKX…MpTqL" : "0x9A3f…8d90"}
              aria-invalid={!addressValid}
              onChange={(event) => setToAddress(event.target.value)}
              // Browser form history is where a poisoned look-alike address would be
              // suggested from; addresses are pasted, never autocompleted.
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
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
