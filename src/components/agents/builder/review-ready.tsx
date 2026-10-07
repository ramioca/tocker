import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Place, ReadyItem } from "./contract";
import { FOCUS, HAIR, Mark, PartIcon, TYPE } from "./look";
import { REQUIRED_PART } from "./parts";

/**
 * The three things only the user decides, as tiles on the last step. Desktop only: below
 * lg the same three are in the agent card behind the strip in the bar. Each leads with
 * its part's icon and ends with its mark, as on the card.
 */
export function ReviewReady({
  items,
  onGo,
  disabled = false,
}: {
  items: ReadyItem[];
  onGo: (place: Place) => void;
  /** While the agent is being created: nothing leaves the step. */
  disabled?: boolean;
}) {
  return (
    <ul aria-label="Yours to decide" className="hidden gap-3 lg:grid lg:grid-cols-3">
      {items.map((item) => (
        <li key={item.id} className="min-w-0">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onGo(item.place)}
            aria-label={item.ready ? `${item.label}: ${item.value}. Go to it.` : `Fix: ${item.label}`}
            className={cn(
              "group flex h-full w-full flex-col gap-2 rounded-xl border bg-card/40 p-3 text-left",
              "transition-[border-color,background-color,scale] duration-150 ease-[var(--ease-out-strong)]",
              "hover:bg-card/70 active:scale-[0.98] motion-reduce:active:scale-100 disabled:pointer-events-none",
              item.ready ? HAIR : "border-dashed border-foreground/30",
              FOCUS,
            )}
          >
            <span className="flex items-center gap-2">
              <PartIcon part={REQUIRED_PART[item.id]} className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[13px] leading-5 font-medium">{item.label}</span>
              <Mark on={item.ready} off="dashed" />
            </span>
            <span
              className={cn(
                TYPE.caption,
                "break-words",
                item.ready ? "text-muted-foreground" : "font-medium text-foreground",
              )}
            >
              {item.value}
            </span>
            {item.ready ? null : (
              <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-primary">
                Fix <ArrowRight aria-hidden className="size-3" />
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
