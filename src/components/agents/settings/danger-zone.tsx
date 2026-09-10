"use client";

import { useRouter } from "next/navigation";
import { Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { deleteAgentAction } from "@/components/agents/agent-actions";
import type { AgentDetail } from "@/server/types";

/**
 * Deleting is irreversible and rare, so it gets the slowest interaction in the
 * app: a two-second deliberate hold, snapping back instantly on release.
 */
export function DangerZone({ agent }: { agent: AgentDetail }) {
  const router = useRouter();

  const remove = async () => {
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
        its wallets should be withdrawn first — this does not move them for you.
      </p>
      <div className="mt-3">
        <HoldToConfirmButton
          size="sm"
          duration={2_000}
          label={`Hold to delete ${agent.name}`}
          confirmedLabel="Deleted"
          icon={<Trash2 className="size-3.5" />}
          onConfirm={() => void remove()}
        />
      </div>
    </section>
  );
}
