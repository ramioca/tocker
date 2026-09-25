import {
  ArrowDownToLine,
  ChevronDown,
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
import Link from "next/link";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import type { AuditKind, AuditRow } from "@/lib/security/types";
import { cn } from "@/lib/utils";
import { describeUserAgent } from "./user-agent";

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

/** Enough to answer "was that me?" without a 60-row wall on a phone. */
const VISIBLE = 10;

/**
 * The audit trail, server-rendered: it is a record, it does not need to move, and
 * the only interactive part is the native disclosure for the older rows — no client
 * JavaScript. Agent names are plain text: the row carries the name, not the slug.
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

  const recent = events.slice(0, VISIBLE);
  const older = events.slice(VISIBLE);

  return (
    <div className="space-y-3">
      <AuditList events={recent} />
      {older.length > 0 ? (
        <details className="group">
          <summary
            className={cn(
              "inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground",
              "transition-colors duration-150 hover:text-foreground [&::-webkit-details-marker]:hidden",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <ChevronDown
              aria-hidden
              className="size-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-open:rotate-180"
            />
            <span className="tnum group-open:hidden">
              Show {older.length} older event{older.length === 1 ? "" : "s"}
            </span>
            <span className="hidden group-open:inline">Hide older events</span>
          </summary>
          <AuditList events={older} start={VISIBLE + 1} className="mt-3" />
        </details>
      ) : null}
    </div>
  );
}

function AuditList({ events, start, className }: { events: AuditRow[]; start?: number; className?: string }) {
  return (
    <ol
      start={start}
      className={cn("divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70", className)}
    >
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
              {/* Each fact leads with a dot and the row is pulled left by one dot, so the
                  fact that starts a wrapped line has its dot clipped instead of a line
                  ending (or starting) on a stray "·". */}
              <p className="mt-1 overflow-hidden font-mono text-[11px] text-muted-foreground">
                <span className="-ml-[calc(1ch+0.5rem)] flex w-[calc(100%+1ch+0.5rem)] flex-wrap items-center gap-x-2 gap-y-0.5 [&>*]:before:mr-2 [&>*]:before:content-['·']">
                  <span>
                    <RelativeTime iso={event.createdAt} />
                  </span>
                  <span>{event.ip ?? "no ip"}</span>
                  {/* Browser and device, not the raw string: "Mozilla/5.0 (X11; Linux x86_64) Ap…"
                      was cut off before the part that differs. The full string is the tooltip. */}
                  {event.userAgent ? <span title={event.userAgent}>{describeUserAgent(event.userAgent)}</span> : null}
                  {/* The name is denormalised on the row, so it still reads correctly
                      after the agent is deleted — which is exactly when you need it. */}
                  {event.agentName && event.agentSlug ? (
                    <Link
                      href={`/agents/${event.agentSlug}`}
                      className="min-w-0 truncate rounded text-foreground/70 underline decoration-muted-foreground/40 underline-offset-2 transition-colors duration-150 hover:text-foreground hover:decoration-foreground focus-ring"
                    >
                      {event.agentName}
                    </Link>
                  ) : event.agentName ? (
                    <span className="min-w-0 truncate text-foreground/70">{event.agentName}</span>
                  ) : null}
                </span>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
