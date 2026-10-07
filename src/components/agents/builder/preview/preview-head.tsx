import { AgentAvatar } from "@/components/common/agent-avatar";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { chainLabelFor } from "@/lib/wallets/funding";
import { cn } from "@/lib/utils";
import type { Chain } from "@/server/types";
import { REQUIRED_PLACE, type Place } from "../contract";
import type { BuilderDraft } from "../types";

/** The small mono label over each block of the agent card. */
export const KICKER = "font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase";

/**
 * Block A of the agent card: the avatar, the name, the tagline, who can see it, and how
 * often it runs on which chains. The name is the way to the name field, because for
 * three steps out of four it reads "Unnamed agent" and the field is on the last one.
 */
export function PreviewHead({
  draft,
  onGo,
  disabled = false,
  className,
  style,
}: {
  draft: BuilderDraft;
  onGo: (place: Place) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const name = draft.name.trim();
  const tagline = draft.tagline.trim();
  const chains = draft.config.chains.map((chain) => chainLabelFor(chain as Chain)).join(" and ");
  const meta = [intervalLabel(draft.config.schedule.intervalMinutes), chains].filter(Boolean).join(" · ");

  return (
    <div className={cn("px-4 pt-4 pb-3", className)} style={style}>
      {/* Marked so the phone sheet, whose title says the same, can leave it out. */}
      <p data-preview-kicker className={KICKER}>
        Your agent
      </p>
      <div className="mt-2 flex items-start gap-3">
        <AgentAvatar seed={draft.avatarSeed} name={name || "Unnamed agent"} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            {/* 44px tall whatever the name is: on a phone this is a tap target in a sheet. */}
            <button
              type="button"
              data-go
              disabled={disabled}
              onClick={() => onGo(REQUIRED_PLACE.name)}
              className="-my-1.5 flex min-h-11 min-w-0 flex-1 items-center rounded-md text-left transition-colors duration-150 hover:text-primary disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className={cn("truncate text-base font-medium", name ? null : "text-muted-foreground")}>
                {name || "Unnamed agent"}
              </span>
              <span className="sr-only">. Go to the name field.</span>
            </button>
            <span className="mt-1 shrink-0 rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">
              {draft.isPublic ? "Public" : "Private"}
            </span>
          </div>
          {tagline ? <p className="truncate text-xs leading-5 text-muted-foreground">{tagline}</p> : null}
          <p className="tnum truncate text-xs leading-5 text-muted-foreground">{meta}</p>
        </div>
      </div>
    </div>
  );
}
