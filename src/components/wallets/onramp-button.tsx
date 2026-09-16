"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";
import { toast } from "sonner";
import { base } from "viem/chains";
import { useFundWallet as useFundEvmWallet } from "@privy-io/react-auth";
import { useFundWallet as useFundSolanaWallet, useSolanaFundingPlugin } from "@privy-io/react-auth/solana";
import { PRIVY_APP_ID } from "@/components/providers/privy-provider";
import { chainLabelFor } from "@/lib/wallets/funding";
import { cn } from "@/lib/utils";
import { useRefreshCash } from "./use-cash";
import type { Chain } from "@/server/types";

/**
 * Privy's onramp: card or exchange, USDC, straight into the user's embedded
 * wallet on one chain.
 *
 * `useFundWallet` is deprecated upstream in favour of the unified `useAddFunds`,
 * which also surfaces the Stripe onramp — worth migrating once that hook leaves
 * @experimental. Until then these two are the stable, typed path and they
 * already cover card and exchange funding on both chains.
 *
 * Whether any of it works at all depends on funding being switched on in the
 * Privy dashboard for this app. We cannot see that from here, so the button
 * always renders and a rejection is explained rather than swallowed: the
 * Receive panel below it is the path that never needs configuration.
 */

interface OnrampProps {
  chain: Chain;
  address: string;
  /** Pre-fills the amount field in Privy's modal. */
  amountUsd?: number;
  className?: string;
}

function Shell({
  children,
  onClick,
  pending,
  disabled,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  pending?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      className={cn(
        "flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground",
        "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
        "hover:bg-primary/90 active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:opacity-50 disabled:active:scale-100",
        className,
      )}
    >
      <CreditCard aria-hidden className="size-4" />
      {children}
    </button>
  );
}

function PrivyOnramp({ chain, address, amountUsd, className }: OnrampProps) {
  // Registers Privy's Solana funding flow. Harmless on Base, and calling it
  // unconditionally keeps the hook order stable across chain switches.
  useSolanaFundingPlugin();
  const { fundWallet: fundEvm } = useFundEvmWallet();
  const { fundWallet: fundSolana } = useFundSolanaWallet();
  const refresh = useRefreshCash();
  const [pending, setPending] = useState(false);

  const start = async () => {
    if (pending || !address) return;
    setPending(true);
    const amount = amountUsd && amountUsd > 0 ? String(amountUsd) : "25";
    try {
      if (chain === "base") {
        await fundEvm({ address, options: { chain: base, amount, asset: "USDC" } });
      } else {
        await fundSolana({ address, options: { amount, asset: "USDC" } });
      }
      toast.success("Onramp finished", {
        description: "USDC can take a few minutes to land. Your balance updates when it does.",
      });
      // Once now for an instant settle, once later for the usual case.
      void refresh();
      void refresh(15_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The funding flow closed.";
      toast.error("Onramp did not complete", {
        description: `${message} You can still deposit by sending USDC to the address below.`,
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <Shell onClick={() => void start()} pending={pending} disabled={!address} className={className}>
      {pending ? "Opening the funding flow…" : `Buy USDC on ${chainLabelFor(chain)}`}
    </Shell>
  );
}

function UnavailableOnramp({ chain, className }: OnrampProps) {
  return (
    <Shell
      disabled
      onClick={() => undefined}
      className={cn("bg-muted text-muted-foreground hover:bg-muted", className)}
    >
      Card onramp needs Privy configured
      <span className="sr-only">for {chainLabelFor(chain)}</span>
    </Shell>
  );
}

// Picked once at module load: the env var cannot change at runtime, and Privy's
// hooks throw outside a PrivyProvider, which is exactly what renders when this
// app has no app id.
const OnrampImpl = PRIVY_APP_ID ? PrivyOnramp : UnavailableOnramp;

export function OnrampButton(props: OnrampProps) {
  return <OnrampImpl {...props} />;
}

export const ONRAMP_AVAILABLE = Boolean(PRIVY_APP_ID);
