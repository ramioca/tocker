"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { formatUsd } from "@/components/common/format";
import { setAgentWalletBudget } from "@/server/actions/wallets";

/**
 * The wallet-layer budget. This is not the risk config: those caps live in app
 * code, this one lives in a Privy policy attached to the wallet itself. The
 * wallet refuses to sign an over-cap USDC transfer no matter who asks — the
 * model, a buggy run loop, or a compromised server route.
 */
export function BudgetCard({
  agentId,
  initialPerTxUsd,
  hasRealWallets,
}: {
  agentId: string;
  initialPerTxUsd: number | null;
  hasRealWallets: boolean;
}) {
  const [applied, setApplied] = useState(initialPerTxUsd);
  const [amount, setAmount] = useState(initialPerTxUsd ? String(initialPerTxUsd) : "");
  const [pending, setPending] = useState(false);

  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed >= 1 && parsed <= 100_000;
  const dirty = valid && parsed !== applied;

  const save = async () => {
    if (!dirty || pending) return;
    setPending(true);
    try {
      const result = await setAgentWalletBudget({ agentId, perTxUsd: parsed });
      if (result.ok) {
        setApplied(result.data.perTxUsd);
        toast.success("Wallet budget applied", {
          description: `The wallet now refuses any USDC transfer above ${formatUsd(result.data.perTxUsd)}.`,
        });
      } else {
        toast.error("Budget not applied", { description: result.error });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="rounded-xl border border-border/70 bg-card/30 p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck aria-hidden className="size-4 text-primary" />
        <h2 className="text-sm font-medium">Wallet budget</h2>
        {applied ? (
          <span className="ml-auto rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
            enforced at the wallet
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        A hard cap enforced by the wallet itself, via a Privy policy: no single USDC
        transfer above this amount gets signed — independent of the risk config, the
        model, and this app&rsquo;s code. Key export is always denied.
      </p>

      {hasRealWallets ? (
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="budget-per-tx" className="mb-1 block text-xs text-muted-foreground">
              Max USDC per transaction
            </label>
            <Input
              id="budget-per-tx"
              value={amount}
              inputMode="decimal"
              placeholder="250"
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
              className="tnum font-mono"
            />
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || pending}
            className="h-9 shrink-0 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
          >
            {pending ? "Applying…" : applied ? "Update" : "Apply"}
          </button>
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          This agent runs on paper wallets — there is nothing on-chain to cap yet. The
          policy is applied automatically when real wallets exist.
        </p>
      )}

      {applied ? (
        <p className="tnum mt-2 text-[11px] text-muted-foreground">
          Current cap: {formatUsd(applied)} per transaction, on every chain this agent
          trades.
        </p>
      ) : null}
    </section>
  );
}
