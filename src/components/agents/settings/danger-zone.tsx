"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { Input } from "@/components/ui/input";
import { deleteAgentAction } from "@/components/agents/agent-actions";
import { NATIVE_SYMBOL, describeStranded, strandedHoldings } from "@/lib/wallets/funding";
import type { AgentDetail, WalletBalance } from "@/server/types";
import { cn } from "@/lib/utils";

/**
 * Deleting is irreversible and rare, so it gets two gates, in this order:
 *
 *  1. **Type the name.** A hold alone only proves the operator meant to press
 *     *something*. Typing the agent's name proves they know *which* agent they
 *     are on — which is the actual mistake in an app where every settings page
 *     looks identical. The comparison is trimmed and case-insensitive: the point
 *     is recognition, not transcription.
 *  2. **A two-second hold**, which snaps back instantly on release.
 *
 * And before either: an agent that still holds money cannot be deleted at all. The
 * server refuses (`deleteAgent`), and this card says what is left and where to take it
 * out, instead of letting someone type the name and hold for two seconds to be told no.
 */
export function DangerZone({
  agent,
  balances = [],
  onWithdraw,
}: {
  agent: AgentDetail;
  balances?: WalletBalance[];
  /** Show the Withdraw form. It is on this page, so the way there is a callback, never a link that would reload it. */
  onWithdraw: () => void;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const confirmed = typed.trim().toLowerCase() === agent.name.trim().toLowerCase();

  // The same rules the server enforces, over what this page already has: real
  // wallets' USDC and withdrawable SOL/ETH (by amount — a Solana read carries no dollar
  // value for SOL, and "$0" is how 5 SOL used to slip past), plus a live agent's
  // positions. The server's read is the stricter one; this is so the answer comes first.
  const holdings = useMemo(() => {
    const real = balances.filter((wallet) => !wallet.walletId.startsWith("paper_"));
    const amountOf = (wallet: WalletBalance, asset: string) =>
      wallet.balances.find((b) => b.asset.toLowerCase() === asset)?.amount ?? 0;
    return strandedHoldings({
      wallets: real.map((wallet) => ({
        chain: wallet.chain,
        usdc: amountOf(wallet, "usdc"),
        native: amountOf(wallet, NATIVE_SYMBOL[wallet.chain].toLowerCase()),
      })),
      tokens:
        agent.mode === "live" && real.length > 0
          ? agent.positions.map((p) => ({
              chain: p.token.chain,
              symbol: p.token.symbol,
              amountToken: p.amountToken,
              valueUsd: p.valueUsd,
            }))
          : [],
    });
  }, [agent.mode, agent.positions, balances]);
  const stranded = describeStranded(holdings);
  const hasPositions = holdings.some((h) => h.kind === "token");
  const hasWithdrawable = holdings.some((h) => h.kind !== "token");

  // The hold says "Deleting…" until the server answers; a refusal remounts it, holdable again.
  const [attempt, setAttempt] = useState(0);

  const remove = async () => {
    if (!confirmed || stranded) return;
    const result = await deleteAgentAction(agent.id).catch(() => ({
      ok: false as const,
      error: "Could not reach Tocker. Nothing was deleted.",
    }));
    if (!result.ok) {
      toast.error("Not deleted", { description: result.error });
      setAttempt((n) => n + 1);
      return;
    }
    toast.success(`${agent.name} deleted`);
    router.push("/agents");
  };

  return (
    <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-center gap-2">
        <TriangleAlert aria-hidden className="size-4 text-destructive" />
        <h2 className="text-sm font-medium text-destructive">Danger zone</h2>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Deleting removes the agent, its runs, its trade history and its posts. Its wallets
        become unreachable from Tocker, so an agent that still holds money can&apos;t be deleted:
        sell its positions and withdraw first.
      </p>
      {stranded ? (
        <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <p className="font-medium tabular-nums">{stranded}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {hasPositions ? (
              <Link
                href={`/agents/${agent.slug}`}
                className="rounded underline underline-offset-2 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Sell positions
              </Link>
            ) : null}
            {hasWithdrawable ? (
              <button
                type="button"
                onClick={onWithdraw}
                // Drawn like the link beside it; on touch an invisible band makes it 44px tall.
                className="relative rounded underline underline-offset-2 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-3.5"
              >
                Withdraw
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        <label htmlFor="danger-confirm" className="block text-xs text-muted-foreground">
          Type <span className="font-mono text-foreground">{agent.name}</span> to confirm
        </label>
        <Input
          id="danger-confirm"
          value={typed}
          autoComplete="off"
          spellCheck={false}
          disabled={Boolean(stranded)}
          onChange={(event) => setTyped(event.target.value)}
          className={cn("max-w-xs font-mono", confirmed && "border-destructive/50")}
        />
        <div className="pt-1">
          <HoldToConfirmButton
            key={attempt}
            size="sm"
            duration={2_000}
            label={
              stranded ? "Empty the wallet first" : confirmed ? `Hold to delete ${agent.name}` : "Type the name first"
            }
            confirmedLabel="Deleting…"
            resetDelay={0}
            icon={<Trash2 className="size-3.5" />}
            disabled={!confirmed || Boolean(stranded)}
            onConfirm={() => void remove()}
          />
        </div>
      </div>
    </section>
  );
}
