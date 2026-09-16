"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { Input } from "@/components/ui/input";
import { deleteAgentAction } from "@/components/agents/agent-actions";
import { formatUsd } from "@/components/common/format";
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
 */
export function DangerZone({ agent, balances = [] }: { agent: AgentDetail; balances?: WalletBalance[] }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const confirmed = typed.trim().toLowerCase() === agent.name.trim().toLowerCase();

  // Real (non-paper) funds still sitting in the agent's wallets. Deleting strands
  // them, so surface the actual number instead of a generic "should withdraw".
  const heldUsd = balances
    .filter((wallet) => !wallet.walletId.startsWith("paper_"))
    .reduce((sum, wallet) => sum + wallet.balances.reduce((s, b) => s + (b.usd ?? 0), 0), 0);
  const hasFunds = heldUsd >= 0.01;

  const remove = async () => {
    if (!confirmed) return;
    const result = await deleteAgentAction(agent.id);
    if (!result.ok) {
      toast.error("Not deleted", { description: result.error });
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
        Deleting removes the agent, its runs, its trade history and its posts. Any funds still in
        its wallets should be withdrawn first — this does not move them for you, and the wallets
        become unreachable from Tocker once the agent is gone.
      </p>
      {hasFunds ? (
        <p className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          This agent still holds {formatUsd(heldUsd)}. Withdraw it first — deleting will strand these
          funds.
        </p>
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
          placeholder={agent.name}
          onChange={(event) => setTyped(event.target.value)}
          className={cn("max-w-xs font-mono text-xs", confirmed && "border-destructive/50")}
        />
        <div className="pt-1">
          <HoldToConfirmButton
            size="sm"
            duration={2_000}
            label={confirmed ? `Hold to delete ${agent.name}` : "Type the name first"}
            confirmedLabel="Deleted"
            icon={<Trash2 className="size-3.5" />}
            disabled={!confirmed}
            onConfirm={() => void remove()}
          />
        </div>
      </div>
    </section>
  );
}
