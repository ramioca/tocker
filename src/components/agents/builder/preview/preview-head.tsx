import { Globe, Lock } from "lucide-react";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { chainLabelFor } from "@/lib/wallets/funding";
import { cn } from "@/lib/utils";
import type { Chain } from "@/server/types";
import { REQUIRED_PLACE, type Place } from "../contract";
import { HAIR, TYPE } from "../look";
import type { BuilderDraft } from "../types";

/** The small mono label over each block of the agent card. */
export const KICKER = TYPE.kicker;

/**
 * Block A of the agent card: the avatar, the name, the tagline, who can see it, and how
 * often it runs on which chains. The name is the way back to the name field, which is on
 * the first step: on any other step, this is how to change it.
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
    <div className={cn("px-4 pt-4 pb-4 xl:px-5", className)} style={style}>
      {/* Marked so the phone sheet, whose title says the same, can leave it out. */}
      <p data-preview-kicker className={KICKER}>
        Your agent
      </p>
      <div className="mt-3 flex items-center gap-3">
        {/* A hairline and a short shadow, so the art sits on the card instead of in it. */}
        <span className="shrink-0 rounded-lg shadow-[0_0_0_1px_rgb(255_255_255/0.10),0_8px_20px_-10px_rgb(0_0_0/0.9)]">
          <AgentAvatar seed={draft.avatarSeed} name={name || "Unnamed agent"} size="lg" />
        </span>
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
              <span className={cn(TYPE.title, "truncate", name ? null : "font-medium text-muted-foreground")}>
                {name || "Unnamed agent"}
              </span>
              <span className="sr-only">. Go to the name field.</span>
            </button>
            <span
              className={cn(
                "mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 text-muted-foreground",
                HAIR,
              )}
            >
              {draft.isPublic ? (
                <Globe aria-hidden className="size-3 shrink-0" />
              ) : (
                <Lock aria-hidden className="size-3 shrink-0" />
              )}
              {draft.isPublic ? "Public" : "Private"}
            </span>
          </div>
          {tagline ? <p className="truncate text-[13px] leading-5 text-foreground/80">{tagline}</p> : null}
          <p className={cn(TYPE.caption, "truncate text-muted-foreground")}>{meta}</p>
        </div>
      </div>
    </div>
  );
}
