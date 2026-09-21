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
 * ## W7 H13 — this is off by default
 *
 * Funding is **not** enabled on this Privy app: the public app config reports
 * `fiat_on_ramp_enabled: false` and carries no `funding_config` (probed 2026-09-21),
 * and the bundle throws "Wallet funding is not enabled" before a modal ever opens. A
 * primary button that always fails is worse than no button, so the onramp now hides
 * behind `NEXT_PUBLIC_ONRAMP_ENABLED=1` and sits *below* Receive, which needs no
 * configuration and is how the operator will actually deposit.
 *
 * Turn the flag on only after enabling funding in the Privy dashboard.
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

/**
 * Card/exchange funding is on for this deployment.
 *
 * Two gates, both needed: Privy has to exist at all, and the operator has to have
 * turned funding on in the Privy dashboard and said so here. There is no way to read
 * the second from the browser, which is exactly why it is a flag.
 */
export const ONRAMP_AVAILABLE =
  Boolean(PRIVY_APP_ID) && process.env.NEXT_PUBLIC_ONRAMP_ENABLED === "1";

// Picked once at module load: the env vars cannot change at runtime, and Privy's
// hooks throw outside a PrivyProvider, which is exactly what renders when this
// app has no app id.
export function OnrampButton(props: OnrampProps) {
  if (!ONRAMP_AVAILABLE) return null;
  return <PrivyOnramp {...props} />;
}
