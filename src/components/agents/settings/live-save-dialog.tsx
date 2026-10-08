"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** 44px where a finger presses: on a phone's width, and on any touch screen. */
const TOUCH_HEIGHT = "max-sm:h-11 pointer-coarse:h-11";

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/**
 * Asked before a save loosens something that moves a live agent's money.
 *
 * It only draws the lines it is given, already worded and formatted: what counts as
 * loosening is decided where the saved and the edited configs are compared, not here.
 * With no lines there is no dialog.
 *
 * "Keep editing" has the focus when it opens, and Escape or a press outside means the
 * same thing, so the answer that changes nothing is the one a stray key gives.
 */
export function LiveSaveDialog({
  agentName,
  lines,
  onKeep,
  onSave,
}: {
  agentName: string;
  /** What the save would loosen, one line each. Null while there is nothing to ask. */
  lines: readonly string[] | null;
  /** Keep editing: nothing is saved. Also Escape and a press outside. */
  onKeep: () => void;
  /** Save changes. The page closes the dialog by clearing `lines`. */
  onSave: () => void;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const asking = lines !== null && lines.length > 0;
  // The lines last asked about stay drawn while the dialog fades out, after the page has
  // already cleared them. Compared by what they say, so a page that builds the list anew
  // on every render is not asked to render again for it.
  const [shown, setShown] = useState<readonly string[]>(lines ?? []);
  if (asking && !sameLines(lines, shown)) setShown(lines);

  return (
    <Dialog
      open={asking}
      onOpenChange={(next) => {
        if (!next) onKeep();
      }}
    >
      {/* No close button in the corner: the two answers are the two buttons. */}
      <DialogContent showCloseButton={false} initialFocus={keepRef} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save changes to a live agent?</DialogTitle>
          <DialogDescription>{agentName} trades real money. From its next tick:</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5">
          {shown.map((line, index) => (
            <li key={`${index}:${line}`} className="tnum flex gap-2 leading-5">
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <span className="min-w-0 text-pretty">{line}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button ref={keepRef} variant="outline" onClick={onKeep} className={TOUCH_HEIGHT}>
            Keep editing
          </Button>
          <Button onClick={onSave} className={TOUCH_HEIGHT}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
