/**
 * What the agent is waiting on, in one row per blocker.
 *
 * It sits between the header and the proposal list because that is where the eye lands
 * after the name and the number, and because everything it says is time-sensitive: a
 * proposal expiring, a day's buys spent, a provider that stopped answering.
 *
 * Three rules, all of them about staying out of the way:
 *
 *   - **Nothing to say, nothing rendered.** No "all good" row, no empty frame. The
 *     banner exists only when something is wrong, so its presence is information.
 *   - **State, then consequence, then the fix.** The title is what is true, the muted
 *     line under it is what that costs, and the link is the one place to change it.
 *   - **No card chrome.** One hairline around the stack, hairlines between rows, a
 *     4-5% tint for tone. Anything heavier competes with the header above it.
 *
 * A server component on purpose: every string is computed server-side from the owner's
 * own book, it must be readable before hydration, and there is nothing here to animate —
 * this is a row an operator reads once and acts on, not a state change worth noticing.
 */
import Link from "next/link";
import { ArrowUpRight, CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { AgentStatusAction, AgentStatusItem, AgentStatusSeverity } from "@/server/queries/agent-status";
import { cn } from "@/lib/utils";

const ICON = {
  block: CircleAlert,
  warn: TriangleAlert,
  info: Info,
} as const;

/** Colour carries tone; it never carries the meaning on its own — see the sr-only label. */
const TONE: Record<AgentStatusSeverity, { row: string; icon: string; action: string }> = {
  block: {
    row: "bg-destructive/[0.06]",
    icon: "text-destructive",
    action: "border-destructive/35 text-destructive hover:bg-destructive/10",
  },
  warn: {
    row: "bg-amber-500/[0.06]",
    icon: "text-amber-500",
    action: "border-amber-500/35 text-amber-500 hover:bg-amber-500/10",
  },
  info: {
    row: "bg-card/30",
    icon: "text-muted-foreground",
    action: "border-border text-foreground hover:bg-muted",
  },
};

const SPOKEN: Record<AgentStatusSeverity, string> = {
  block: "Blocked:",
  warn: "Warning:",
  info: "Note:",
};

export function AgentStatusBanner({ items }: { items: AgentStatusItem[] }) {
  if (items.length === 0) return null;

  return (
    <section
      aria-label="What this agent is waiting on"
      className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70"
    >
      {items.map((item) => {
        const tone = TONE[item.severity];
        const Icon = ICON[item.severity];
        return (
          <div key={item.kind} className={cn("flex items-start gap-3 px-3.5 py-3", tone.row)}>
            <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone.icon)} />

            <div className="min-w-0 flex-1">
              <p className="tnum text-sm leading-5 font-medium">
                <span className="sr-only">{SPOKEN[item.severity]} </span>
                {item.title}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.detail}</p>
            </div>

            {item.action ? <ActionLink action={item.action} className={tone.action} /> : null}
          </div>
        );
      })}
    </section>
  );
}

/**
 * The fix, one click away. An absolute href is a provider's own console — it opens in a
 * new tab and says so with the arrow, because losing the page you were reading to go
 * top up a billing account is its own small betrayal.
 */
function ActionLink({ action, className }: { action: AgentStatusAction; className: string }) {
  const external = /^https?:\/\//i.test(action.href);
  const classes = cn(
    "mt-0.5 inline-flex shrink-0 items-center gap-1 self-start rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-ring",
    className,
  );

  if (external) {
    return (
      <a href={action.href} target="_blank" rel="noreferrer" className={classes}>
        {action.label}
        <ArrowUpRight aria-hidden className="size-3" />
      </a>
    );
  }

  return (
    <Link href={action.href} className={classes}>
      {action.label}
    </Link>
  );
}
