"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { encodeFunctionData, parseEther, parseUnits } from "viem";
import { useSendTransaction } from "@privy-io/react-auth";
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
import { SimpleSelect } from "@/components/agents/builder/simple-select";
import { truncateAddress } from "@/components/common/format";
import { cn } from "@/lib/utils";
import type { Chain, WalletBalance } from "@/server/types";

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

/** Privy is only wired once an app id exists; until then this is a copy-address flow. */
const PRIVY_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

interface FundProps {
  agentName: string;
  wallets: WalletBalance[];
}

function Controls({
  chain,
  setChain,
  asset,
  setAsset,
  amount,
  setAmount,
  wallets,
}: {
  chain: Chain;
  setChain: (chain: Chain) => void;
  asset: "usdc" | "native";
  setAsset: (asset: "usdc" | "native") => void;
  amount: string;
  setAmount: (amount: string) => void;
  wallets: WalletBalance[];
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="fund-chain" className="mb-1 block text-xs text-muted-foreground">
            Chain
          </label>
          <SimpleSelect
            id="fund-chain"
            value={chain}
            options={wallets.map((wallet) => ({
              value: wallet.chain,
              label: wallet.chain === "solana" ? "Solana" : "Base",
            }))}
            onChange={(next) => setChain(next as Chain)}
          />
        </div>
        <div>
          <label htmlFor="fund-asset" className="mb-1 block text-xs text-muted-foreground">
            Asset
          </label>
          <SimpleSelect
            id="fund-asset"
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
        <label htmlFor="fund-amount" className="mb-1 block text-xs text-muted-foreground">
          Amount
        </label>
        <Input
          id="fund-amount"
          value={amount}
          inputMode="decimal"
          placeholder="250"
          onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
          className="tnum font-mono"
        />
      </div>
    </div>
  );
}

/**
 * Funding moves real value, so the flow is deliberately plain: pick chain and
 * asset, type an amount, read the card back, confirm once. Nothing animates
 * except the card's own press feedback.
 */
function FundBody({ agentName, wallets }: FundProps) {
  const [chain, setChain] = useState<Chain>(wallets[0]?.chain ?? "base");
  const [asset, setAsset] = useState<"usdc" | "native">("usdc");
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const { sendTransaction } = useSendTransaction();

  const wallet = wallets.find((entry) => entry.chain === chain) ?? wallets[0];
  const nativeSymbol = chain === "solana" ? "SOL" : "ETH";
  const assetSymbol = asset === "usdc" ? "USDC" : nativeSymbol;
  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0 && Boolean(wallet);

  const summary = useMemo(
    () => [
      { label: "Network", value: chain === "solana" ? "Solana" : "Base" },
      { label: "Network fee", value: "paid from your wallet" },
      {
        label: "Agent receives",
        value: valid ? `${parsed} ${assetSymbol}` : `— ${assetSymbol}`,
        emphasized: true,
      },
    ],
    [chain, parsed, valid, assetSymbol],
  );

  const confirm = async () => {
    if (!valid || !wallet || pending) return;
    if (chain === "solana") {
      toast.info("Send SOL or USDC to the agent's Solana address", {
        description:
          "In-app Solana transfers land with the runtime workstream. Copy the address and send from your wallet for now.",
      });
      return;
    }

    setPending(true);
    try {
      const request =
        asset === "native"
          ? { to: wallet.address, value: parseEther(amount) }
          : {
              to: BASE_USDC,
              data: encodeFunctionData({
                abi: ERC20_TRANSFER_ABI,
                functionName: "transfer",
                args: [wallet.address as `0x${string}`, parseUnits(amount, 6)],
              }),
            };

      const result = await sendTransaction({ ...request, chainId: 8453 });
      toast.success("Funding sent", {
        description: `${truncateAddress(result.hash, 8, 6)} — balances update once it confirms.`,
      });
      setAmount("");
    } catch (error) {
      toast.error("Transfer failed", {
        description: error instanceof Error ? error.message : "Your wallet rejected the request.",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <Controls
        chain={chain}
        setChain={setChain}
        asset={asset}
        setAsset={setAsset}
        amount={amount}
        setAmount={setAmount}
        wallets={wallets}
      />

      <TransferFundsCard
        title={`Fund ${agentName}`}
        description="From your embedded wallet to the agent's own wallet. The agent signs its own trades from there."
        amountLabel="Sending"
        currencySymbol={asset === "usdc" ? "$" : ""}
        amount={amount || "0"}
        fromLabel="From"
        fromAccount="Your embedded wallet"
        toLabel="To"
        toAccount={wallet ? `${agentName} · ${truncateAddress(wallet.address, 6, 6)}` : "—"}
        summary={summary}
        buttonLabel={pending ? "Confirming…" : `Send ${assetSymbol}`}
        onConfirm={() => void confirm()}
        className={cn(!valid && "opacity-90")}
      />
    </div>
  );
}

function FundFallback({ agentName, wallets }: FundProps) {
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
            className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/40 px-3 py-2.5"
          >
            <ChainBadge chain={wallet.chain} />
            <Address address={wallet.address} label={`${wallet.chain} address`} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FundAgentDrawer({
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
            <FundBody agentName={agentName} wallets={wallets} />
          ) : (
            <FundFallback agentName={agentName} wallets={wallets} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
