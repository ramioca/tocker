"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { TransferFundsCard } from "@/components/spectrumui/transfer-funds-card";
import { Address } from "@/components/common/address";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatTokenAmount, formatUsd, truncateAddress } from "@/components/common/format";
import { CashTotal } from "@/components/wallets/cash-summary";
import { DepositSheet } from "@/components/wallets/deposit-sheet";
import { useRefreshCash, useUserWallets } from "@/components/wallets/use-cash";
import { useTransfer } from "@/components/wallets/use-transfer";
import { useSession } from "@/hooks/use-session";
import {
  FUND_PRESETS,
  NATIVE_SYMBOL,
  NETWORK_WORDING,
  cashOn,
  chainLabelFor,
  floorTo,
  gasBlockerFor,
} from "@/lib/wallets/funding";
import {
  recordFundingIntents,
  settleFundingIntent,
} from "@/server/actions/wallets";
import { cn } from "@/lib/utils";
import type { Chain, WalletBalance } from "@/server/types";

/** Privy is only wired once an app id exists; until then this is a copy-address flow. */
const PRIVY_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

interface FundProps {
  agentId: string;
  agentName: string;
  /** The agent's own server wallets, one per enabled chain. */
  wallets: WalletBalance[];
}

/**
 * Funding moves real value, so the flow is deliberately plain: pick chain and
 * asset, type an amount, read the card back, confirm once. Nothing animates
 * except the card's own press feedback.
 *
 * The amount is checked against the user's actual balance on that chain before
 * they are asked to sign — an over-ask becomes a deposit prompt rather than a
 * failed transaction and a wasted signature.
 */
function FundBody({ agentId, agentName, wallets }: FundProps) {
  const { ready, session } = useSession();
  const { data } = useUserWallets(Boolean(ready && session));
  const [chain, setChain] = useState<Chain>(wallets[0]?.chain ?? "base");
  // USDC only. Gas on both legs is somebody else's job now — Privy's sponsor pays the
  // user→agent transfer (B1) and the platform Solana wallet pays the agent's trades
  // (B2) — so the "SOL · gas" toggle that used to sit here only ever queued a transfer
  // nobody needed. Anyone who really wants to hand the agent gas can send it to the
  // address on the Wallets card.
  const asset = "usdc" as const;
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAsset, setDepositAsset] = useState<"usdc" | "native">("usdc");
  /** Set when the transfer failed because nobody could pay the network fee. */
  const [gasBlocked, setGasBlocked] = useState<string | null>(null);
  const { send, available } = useTransfer();
  const refresh = useRefreshCash();

  const target = wallets.find((entry) => entry.chain === chain) ?? wallets[0];
  const myCash = data?.cash;
  const myChain = myCash ? cashOn(myCash, chain) : null;
  const nativeSymbol = NATIVE_SYMBOL[chain];
  const assetSymbol = asset === "usdc" ? "USDC" : nativeSymbol;
  const availableHere = myChain ? (asset === "usdc" ? myChain.usdc : myChain.native) : 0;

  const parsed = Number(amount);
  const positive = Number.isFinite(parsed) && parsed > 0;
  const overBalance = positive && myChain !== null && parsed > availableHere;
  const valid = positive && Boolean(target) && !overBalance;

  const summary = useMemo(
    () => [
      { label: "Network", value: NETWORK_WORDING[chain].network },
      { label: "Network fee", value: "sponsored — Tocker pays it" },
      {
        label: "Agent receives",
        value: positive ? `${parsed} ${assetSymbol}` : `— ${assetSymbol}`,
        emphasized: true,
      },
    ],
    [chain, parsed, positive, assetSymbol],
  );

  const confirm = async () => {
    if (!valid || !target || pending) return;
    setPending(true);
    setGasBlocked(null);

    const recorded = await recordFundingIntents({
      agentId,
      transfers: [{ chain, asset, amount: parsed, amountUsd: asset === "usdc" ? parsed : undefined }],
    });
    const intentId = recorded.ok ? recorded.data.ids[0] : undefined;

    try {
      const result = await send({ chain, asset, amount: parsed, to: target.address });
      if (intentId) {
        void settleFundingIntent({ id: intentId, status: "sent", txHash: result.hash });
      }
      toast.success("Funding sent", {
        description: `${truncateAddress(result.hash, 8, 6)} — balances update once it confirms.`,
      });
      setAmount("");
      void refresh();
      void refresh(12_000);
    } catch (error) {
      // `useTransfer` has already turned an SDK failure into a sentence; all that is
      // left is to decide whether the fix is a deposit (no gas) or nothing (cancelled).
      const message = error instanceof Error ? error.message : "Your wallet rejected the request.";
      if (intentId) {
        void settleFundingIntent({ id: intentId, status: "failed", error: message });
      }
      const needsGas = /network fee|sponsorship|SOL|ETH/i.test(message) && !/cancelled/i.test(message);
      if (needsGas) setGasBlocked(message);
      toast.error("Transfer failed", { description: message });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3 rounded-xl border border-border/50 bg-background/40 px-3 py-2.5">
        <span className="text-xs text-muted-foreground">Your cash</span>
        <span className="text-right">
          <CashTotal cash={myCash} size="sm" />
          {myChain ? (
            <span className="tnum block text-[11px] text-muted-foreground">
              {formatUsd(myChain.usdcUsd)} · {formatTokenAmount(myChain.native)} {nativeSymbol} on{" "}
              {chainLabelFor(chain)}
            </span>
          ) : null}
        </span>
      </div>

      <div>
        <span className="mb-1 block text-xs text-muted-foreground">Chain</span>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-border/60 bg-muted/20 p-1">
          {wallets.map((wallet) => (
            <button
              key={wallet.chain}
              type="button"
              aria-pressed={wallet.chain === chain}
              onClick={() => setChain(wallet.chain)}
              className={cn(
                "h-8 rounded-lg text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                wallet.chain === chain
                  ? "bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {chainLabelFor(wallet.chain)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="fund-amount" className="mb-1 block text-xs text-muted-foreground">
          Amount
        </label>
        <Input
          id="fund-amount"
          value={amount}
          inputMode="decimal"
          placeholder={asset === "usdc" ? "25" : "0.01"}
          onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
          className="tnum font-mono"
        />
        {asset === "usdc" ? (
          <div className="mt-2 flex items-center gap-1.5">
            {FUND_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(String(preset))}
                className="tnum h-7 flex-1 rounded-lg border border-border text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                ${preset}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAmount(String(floorTo(availableHere, 2)))}
              className="h-7 flex-1 rounded-lg border border-border text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Max
            </button>
          </div>
        ) : null}
      </div>

      {overBalance ? (
        <div className="space-y-2 rounded-xl border border-destructive/25 bg-destructive/8 p-3">
          <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0 text-destructive" />
            <span>
              You have {asset === "usdc" ? formatUsd(availableHere) : `${formatTokenAmount(availableHere)} ${nativeSymbol}`}{" "}
              on {chainLabelFor(chain)}. Deposit more, or send less — this never quietly sends the
              smaller amount.
            </span>
          </p>
          <button
            type="button"
            onClick={() => {
              setDepositAsset("usdc");
              setDepositOpen(true);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus aria-hidden className="size-3.5" />
            Deposit USDC on {chainLabelFor(chain)}
          </button>
        </div>
      ) : null}

      {gasBlocked ? (
        <div className="space-y-2 rounded-xl border border-destructive/25 bg-destructive/8 p-3">
          <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0 text-destructive" />
            <span>{gasBlocked}</span>
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {gasBlockerFor(chain).message}
          </p>
          <button
            type="button"
            onClick={() => {
              setDepositAsset("native");
              setDepositOpen(true);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus aria-hidden className="size-3.5" />
            Deposit {nativeSymbol} on {chainLabelFor(chain)}
          </button>
        </div>
      ) : null}

      <TransferFundsCard
        title={`Fund ${agentName}`}
        description="From your embedded wallet to the agent's own wallet. The agent signs its own trades from there."
        amountLabel="Sending"
        currencySymbol={asset === "usdc" ? "$" : ""}
        amount={amount || "0"}
        fromLabel="From"
        fromAccount="Your embedded wallet"
        toLabel="To"
        toAccount={target ? `${agentName} · ${truncateAddress(target.address, 6, 6)}` : "—"}
        summary={summary}
        buttonLabel={
          pending
            ? "Waiting for your wallet to confirm…"
            : available
              ? `Send ${assetSymbol}`
              : "Privy is not configured"
        }
        onConfirm={() => void confirm()}
        className={cn(!valid && "opacity-90")}
      />

      <DepositSheet
        open={depositOpen}
        onOpenChange={setDepositOpen}
        wallets={data?.wallets ?? []}
        cash={data?.cash}
        initialChain={chain}
        initialAsset={depositAsset}
      />
    </div>
  );
}

function FundFallback({ agentName, wallets }: Omit<FundProps, "agentId">) {
  return (
    <div className="space-y-3">
      <p className="rounded-xl border border-border/70 bg-card/40 p-3 text-sm leading-relaxed text-muted-foreground">
        In-app funding needs Privy configured (<code className="font-mono">NEXT_PUBLIC_PRIVY_APP_ID</code>
        ). Until then, send USDC to {agentName}&apos;s addresses from any wallet — the agent trades
        from whatever lands there.
      </p>
      <ul className="space-y-2">
        {wallets.map((wallet) => (
          <li
            key={wallet.walletId}
            className="space-y-1.5 rounded-xl border border-border/70 bg-card/40 px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-3">
              <ChainBadge chain={wallet.chain} />
              <Address address={wallet.address} label={`${wallet.chain} address`} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {NETWORK_WORDING[wallet.chain].asset} · {NETWORK_WORDING[wallet.chain].network}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FundAgentDrawer({
  agentId,
  agentName,
  wallets,
  trigger,
}: FundProps & { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          (trigger as React.ReactElement) ?? (
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Fund
            </button>
          )
        }
      />
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-sm">Fund {agentName}</SheetTitle>
          <SheetDescription className="text-xs">
            The agent pays for its own data and trades from these wallets.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {PRIVY_CONFIGURED ? (
            <FundBody agentId={agentId} agentName={agentName} wallets={wallets} />
          ) : (
            <FundFallback agentName={agentName} wallets={wallets} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
