import { Lock } from "lucide-react";
import type { AgentDetail } from "@/server/types";

/**
 * What a non-owner sees where the owner sees their strategy.
 *
 * This is deliberately not an empty state or an error. The operator's edge being private
 * is the product working as designed, so the panel says so plainly and then spends its
 * space on what *is* public: the shape of the agent, and a pointer at the record.
 *
 * Nothing here comes from `config` — the server already sent `null`. Everything comes
 * from `publicProfile`, which carries only chains, model, cadence and a count.
 */

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/40 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="tnum mt-0.5 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

function cadence(intervalMinutes: number | null): string {
  if (intervalMinutes === null) return "Manual";
  if (intervalMinutes < 60) return `Every ${intervalMinutes}m`;
  if (intervalMinutes % 60 === 0) return `Every ${intervalMinutes / 60}h`;
  return `Every ${Math.floor(intervalMinutes / 60)}h ${intervalMinutes % 60}m`;
}

export function PrivateStrategyPanel({ agent }: { agent: AgentDetail }) {
  const { chains, model, intervalMinutes, dataSourceCount } = agent.publicProfile;

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-xl border border-border/70 bg-card/30 p-5 sm:p-6">
        {/* One soft violet wash, the app's single accent, so the panel reads as a
            deliberate surface rather than a missing one. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 size-52 rounded-full bg-primary/12 blur-3xl"
        />

        <div className="relative flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/60">
            <Lock aria-hidden className="size-4 text-primary" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight">
              @{agent.owner.handle}&rsquo;s strategy is private
            </h3>
            <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
              The prompt, the universe rules, the score thresholds and the data sources it
              pays for stay with the operator who wrote them. A strategy anyone can copy is
              worth nothing to its author — so instead of the recipe, you get the receipts.
            </p>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
              Every fill is public: the token, the size, the price, the score it cleared and
              the one line explaining why. Judge it on the record.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          What is public
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Fact label="Chains" value={chains.length ? chains.join(", ") : "—"} />
          <Fact label="Model" value={model || "—"} />
          <Fact label="Cadence" value={cadence(intervalMinutes)} />
          <Fact
            label="Paid sources"
            value={dataSourceCount === 1 ? "1 source" : `${dataSourceCount} sources`}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          How many sources it buys, never which ones — the queries an operator sends are
          part of the system.
        </p>
      </section>
    </div>
  );
}
