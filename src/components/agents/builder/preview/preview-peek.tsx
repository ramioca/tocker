"use client";

import { useRef, useState } from "react";
import { ChevronUp, X } from "lucide-react";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { BuilderDraft } from "../types";

export interface PreviewPeekProps {
  draft: BuilderDraft;
  /** How many of the three required things are ready, for the screen-reader label. */
  readyCount: number;
  /** The one-line cost text, from `commitShortLine`. */
  shortLine: string;
  /** Step 4: only the avatar and the chevron, so the Create button keeps its width. */
  compact: boolean;
  /** While the agent is being created: the strip does not open. */
  disabled?: boolean;
  /** An `AgentPreview`, mounted only while the sheet is open. */
  children: React.ReactNode;
}

/**
 * The agent card where there is no room for a column: a strip in the bottom bar (avatar,
 * name, the one-line cost text) that opens a bottom sheet holding the full card.
 *
 * The strip is hidden from `lg`, where the card has its own column. From `sm` the bar
 * has room for the whole cost sentence, so the strip drops its own one-line copy of it.
 */
export function PreviewPeek({ draft, readyCount, shortLine, compact, disabled = false, children }: PreviewPeekProps) {
  const [open, setOpen] = useState(false);
  // A row or a Fix button in the sheet takes the user somewhere, and the builder puts the
  // focus there. Closing must then leave it alone, not hand it back to the strip.
  const wentSomewhere = useRef(false);
  const name = draft.name.trim() || "Unnamed agent";

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Your agent: ${name}. ${readyCount} of 3 ready. Open the summary.`}
        disabled={disabled}
        onClick={() => {
          wentSomewhere.current = false;
          setOpen(true);
        }}
        className={cn(
          // 48px, the height of the bar's own buttons, so the bar never changes height.
          // max-w-full: a button sizes to its content, and the name must truncate inside
          // whatever room the bar gives the strip.
          "flex h-12 max-w-full items-center gap-2.5 rounded-xl text-left lg:hidden",
          "transition-[background-color,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted/40 active:scale-[0.97] disabled:pointer-events-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          compact ? "shrink-0 px-1" : "w-full min-w-0 flex-1 pr-1 sm:w-auto sm:flex-none",
        )}
      >
        <AgentAvatar seed={draft.avatarSeed} name={name} size="sm" />
        {compact ? null : (
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-sm leading-5 font-medium", draft.name.trim() ? null : "text-muted-foreground")}>
              {name}
            </span>
            <span className="tnum block truncate text-xs leading-4 text-muted-foreground sm:hidden">{shortLine}</span>
          </span>
        )}
        <ChevronUp aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          finalFocus={() => !wentSomewhere.current}
          className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
        >
          <SheetHeader className="pb-0">
            <SheetTitle>Your agent</SheetTitle>
          </SheetHeader>
          {/* The sheet is already the surface and already says "Your agent", so the card
              inside drops its own border, fill and kicker. Every button in the card goes
              to a place on the page (`data-go`), and the sheet would cover that place. */}
          <div
            onClick={(event) => {
              if (!(event.target instanceof Element) || !event.target.closest("[data-go]")) return;
              wentSomewhere.current = true;
              setOpen(false);
            }}
            className="[&_[data-preview-kicker]]:hidden [&>aside]:rounded-none [&>aside]:border-0 [&>aside]:bg-transparent"
          >
            {children}
          </div>
          {/* The sheet's own close button is 28px; on a phone this one is the way out, so
              it is 44. After the card in the page, as that one was, so the sheet still
              opens with focus on the card. */}
          <SheetClose render={<Button variant="ghost" size="icon" className="absolute top-1.5 right-1.5 size-11" />}>
            <X aria-hidden />
            <span className="sr-only">Close</span>
          </SheetClose>
        </SheetContent>
      </Sheet>
    </>
  );
}
