/**
 * Blockers and warnings, rendered. The words live in `blocker-copy.ts` — this file
 * only decides how a list of them looks.
 */
import { Ban, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { verdictTint } from "./verdict";
import { type BlockerAudience, describeBlocker, visibleWarnings } from "./blocker-copy";

export { describeBlocker, visibleWarnings, type BlockerAudience, type BlockerCopy } from "./blocker-copy";

const TONE = {
  blocker: {
    color: "oklch(0.7 0.16 45)",
    Icon: Ban,
    heading: "Hard gates it failed",
  },
  warning: {
    color: "oklch(0.72 0.145 75)",
    Icon: TriangleAlert,
    heading: "Worth knowing",
  },
} as const;

export function BlockerList({
  blockers = [],
  warnings = [],
  /** `compact` drops the headings and details — for a row, not a card. */
  compact = false,
  max,
  /** Whose rules scored it. Public surfaces say "the platform's floor", not "your floor". */
  audience = "owner",
  className,
}: {
  blockers?: readonly string[];
  warnings?: readonly string[];
  compact?: boolean;
  max?: number;
  audience?: BlockerAudience;
  className?: string;
}) {
  const shownWarnings = visibleWarnings(warnings, blockers);
  if (blockers.length === 0 && shownWarnings.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {blockers.length > 0 ? (
        <Group tone="blocker" codes={blockers} compact={compact} max={max} audience={audience} />
      ) : null}
      {shownWarnings.length > 0 ? (
        <Group tone="warning" codes={shownWarnings} compact={compact} max={max} audience={audience} />
      ) : null}
    </div>
  );
}

function Group({
  tone,
  codes,
  compact,
  max,
  audience,
}: {
  tone: keyof typeof TONE;
  codes: readonly string[];
  compact: boolean;
  max?: number;
  audience: BlockerAudience;
}) {
  const { color, Icon, heading } = TONE[tone];
  const shown = max ? codes.slice(0, max) : codes;
  const hidden = codes.length - shown.length;

  return (
    <div>
      {compact ? null : (
        <p
          className="text-[11px] font-semibold tracking-wide uppercase"
          style={{ color }}
        >
          {heading}
        </p>
      )}
      <ul className={cn("space-y-1.5", compact ? "" : "mt-2")}>
        {shown.map((code) => {
          const copy = describeBlocker(code, audience);
          return (
            <li
              key={code}
              className="flex items-start gap-2 rounded-lg px-2 py-1.5"
              style={{ backgroundColor: verdictTint(color, 8) }}
            >
              <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" style={{ color }} />
              <span className="min-w-0">
                <span className="block text-xs leading-relaxed font-medium text-foreground/90">
                  {copy.title}
                </span>
                {!compact && copy.detail ? (
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                    {copy.detail}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
        {hidden > 0 ? (
          <li className="tnum px-2 text-[11px] text-muted-foreground">
            and {hidden} more
          </li>
        ) : null}
      </ul>
    </div>
  );
}
