import { ChevronDown, TriangleAlert } from "lucide-react";
import type { CardId } from "./contract";
import { cn } from "@/lib/utils";

/**
 * A rule domain: closed, it is one readable sentence; open, it is the full
 * control surface. The grid-rows transition keeps the reveal smooth without
 * measuring heights.
 *
 * The header button is `#rule-card-{id}` and the panel `#rule-panel-{id}`. Both are stable
 * (they used to be derived from the title), because an error, a row of the agent card
 * and an `?open=` link all need to find the header.
 */
export function RuleCard({
  id,
  title,
  summary,
  open,
  onToggle,
  hasError,
  children,
}: {
  id: CardId;
  title: string;
  summary: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  hasError: boolean;
  children: React.ReactNode;
}) {
  const panelId = `rule-panel-${id}`;
  return (
    <section
      className={cn(
        "rounded-xl border bg-card/30 transition-colors duration-150",
        hasError ? "border-destructive/60" : "border-border/70",
      )}
    >
      <button
        type="button"
        id={`rule-card-${id}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {title}
            {hasError ? (
              <TriangleAlert aria-label="has an error" className="size-3.5 shrink-0 text-destructive" />
            ) : null}
          </span>
          <span className={cn("mt-0.5 line-clamp-2 text-xs text-muted-foreground", open && "sr-only")}>
            {summary}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
            open && "rotate-180",
          )}
        />
      </button>
      {/* `inert` while closed: the panel is 0px tall but its controls would otherwise
          stay in the Tab order and the accessibility tree, and arrow keys could move a
          risk limit nobody can see. It keeps the grid-rows transition intact. */}
      <div
        id={panelId}
        role="region"
        aria-label={title}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        {/* relative: sr-only notes inside are position:absolute; without a positioned
            ancestor here they escape the 0fr clip and stretch the page. */}
        <div className="relative overflow-hidden">
          <div className="border-t border-border/50 px-4 pt-4 pb-4">{children}</div>
        </div>
      </div>
    </section>
  );
}
