import {
  ArrowDownToLine,
  CircleStop,
  KeyRound,
  Pause,
  Play,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import type { AuditKind, AuditRow } from "@/lib/security/types";
import { cn } from "@/lib/utils";

const ICONS: Record<AuditKind, React.ComponentType<{ className?: string }>> = {
  withdraw: ArrowDownToLine,
  budget_change: SlidersHorizontal,
  go_live: Zap,
  go_paper: Pause,
  agent_paused: Pause,
  agent_resumed: Play,
  llm_key_added: KeyRound,
  llm_key_rotated: RotateCcw,
  llm_key_removed: KeyRound,
  kill_switch_on: CircleStop,
  kill_switch_off: Play,
  mfa_enrolled: ShieldCheck,
  mfa_unenrolled: ShieldOff,
  first_trade_preset: SlidersHorizontal,
  manual_run: Play,
};

/** The rows that mean money moved or could now move get the accent. */
const LOUD: ReadonlySet<AuditKind> = new Set<AuditKind>([
  "withdraw",
  "go_live",
  "kill_switch_on",
  "mfa_unenrolled",
  "llm_key_removed",
]);

/**
 * The audit trail, server-rendered: it is a record, it does not need to move, and
 * nothing here is interactive except the agent links.
 */
export function AuditLog({ events }: { events: AuditRow[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={<ScrollText aria-hidden />}
        title="Nothing recorded yet"
        description="Withdrawals, budget changes, mode switches, key changes and the kill switch all land here the moment they happen."
        className="py-10"
      />
    );
  }

  return (
    <ol className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
      {events.map((event) => {
        const Icon = ICONS[event.kind] ?? ScrollText;
        const loud = LOUD.has(event.kind);
        return (
          <li key={event.id} className="flex gap-3 bg-card/30 p-4">
            <span
              className={cn(
                "mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border",
                loud
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/70 bg-muted/40 text-muted-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-6">{event.summary}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                <RelativeTime iso={event.createdAt} />
                <span aria-hidden>·</span>
                <span>{event.ip ?? "no ip"}</span>
                {/* The name is denormalised on the row, so it still reads correctly
                    after the agent is deleted — which is exactly when you need it. */}
                {event.agentName ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="truncate text-foreground/70">{event.agentName}</span>
                  </>
                ) : null}
              </p>
              {event.userAgent ? (
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={event.userAgent}>
                  {event.userAgent}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
