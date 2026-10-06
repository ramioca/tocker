"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { FullAddress } from "@/components/common/address";
import { formatUsd, truncateAddress } from "@/components/common/format";
import { txExplorerUrl } from "@/lib/tokens/links";
import { NETWORK_WORDING } from "@/lib/wallets/funding";
import type { Chain } from "@/server/types";

/** What a cash withdrawal did, kept on screen until the user dismisses it. */
export interface WithdrawalReceipt {
  /**
   * `sent`: the network took it. `unconfirmed`: the broadcast may still land (Solana
   * only), which is never shown as a failure and never as an invitation to resend.
   */
  kind: "sent" | "unconfirmed";
  chain: Chain;
  /** What the recipient gets, in USDC. */
  amount: number;
  /** The one-time new-account fee taken on top of it, or 0. */
  feeUsdc: number;
  to: string;
  hash: string;
}

const EXPLORER_NAME: Record<Chain, string> = { solana: "Solscan", base: "BaseScan" };

const LINK =
  "rounded text-foreground underline underline-offset-2 transition-colors duration-150 hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function receiptTitle(receipt: WithdrawalReceipt): string {
  return receipt.kind === "sent" ? "Withdrawal sent" : "Not confirmed yet";
}

export function receiptDescription(receipt: WithdrawalReceipt): string {
  return receipt.kind === "sent"
    ? `${formatUsd(receipt.amount)} USDC is on its way.`
    : "The network didn't confirm this withdrawal while Tocker was watching. It may still arrive.";
}

/**
 * The outcome of a cash withdrawal, in place of the form.
 *
 * It used to be a four-second toast with a hash nobody could click, after which "did it
 * go?" had no answer anywhere in the app. This stays until it is dismissed, and carries
 * what a person checks afterwards: how much, the whole destination, and the transaction
 * on an explorer.
 */
export function WithdrawReceipt({ receipt, onDone }: { receipt: WithdrawalReceipt; onDone: () => void }) {
  const { kind, chain, amount, feeUsdc, to, hash } = receipt;
  const explorer = txExplorerUrl(chain, hash);

  return (
    // Arrives rather than appears: a fade and 4px of travel, nothing scaled or counted up.
    <div className="min-w-0 space-y-3 animate-in fade-in slide-in-from-bottom-1 duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:animate-none">
      <dl className="space-y-1.5 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-xs">
        {/* Every character, as at the hold: this is what gets checked against the wallet
            or exchange it was meant for. */}
        <div className="space-y-0.5 border-b border-border/60 pb-1.5">
          <dt className="text-muted-foreground">To</dt>
          <dd>
            <FullAddress address={to} className="flex" />
          </dd>
        </div>
        <ReceiptRow label="Network" value={NETWORK_WORDING[chain].network} />
        {feeUsdc > 0 ? (
          <>
            <ReceiptRow label="New account fee" value={`${formatUsd(feeUsdc)} USDC`} />
            {/* "Left" only once it is known to have: an unconfirmed send has not left yet. */}
            <ReceiptRow
              label={kind === "sent" ? "Left your cash" : "From your cash"}
              value={formatUsd(amount + feeUsdc)}
              strong
            />
          </>
        ) : null}
        <ReceiptRow label="Network fee" value={NETWORK_WORDING[chain].fees} />
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-border/60 pt-1.5">
          <dt className="text-muted-foreground">Transaction</dt>
          <dd className="flex items-baseline gap-2">
            <span className="tnum font-mono text-foreground">{truncateAddress(hash, 8, 6)}</span>
            {explorer ? (
              <a href={explorer} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-0.5 ${LINK}`}>
                View on {EXPLORER_NAME[chain]}
                <ArrowUpRight aria-hidden className="size-3" />
              </a>
            ) : null}
          </dd>
        </div>
      </dl>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {kind === "unconfirmed"
          ? "If your balance hasn't dropped within two minutes, it didn't go, and you can send it again. Don't resend before then."
          : chain === "base"
            ? "It usually arrives within a minute. Your Base balance here can take a couple of minutes to catch up."
            : "It usually arrives within a minute. Your cash here updates on its own."}
        {/* Base cash withdrawals are signed and sent in the browser, so there is no row to point at. */}
        {chain === "solana" ? (
          <>
            {" "}
            Recorded in your{" "}
            <Link href="/settings/security" className={LINK}>
              audit log
            </Link>
            .
          </>
        ) : null}
      </p>

      <button
        type="button"
        // The hold button that had focus is gone; without this the keyboard is left on
        // the page behind the dialog.
        autoFocus
        onClick={onDone}
        className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-primary text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        Done
      </button>
    </div>
  );
}

function ReceiptRow({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "tnum text-right font-medium text-foreground" : "tnum text-right text-foreground"}>{value}</dd>
    </div>
  );
}
