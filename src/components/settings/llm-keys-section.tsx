"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { SwipeToDelete } from "@/components/spectrumui/swipe-to-delete";
import { UndoPill } from "@/components/spectrumui/undo-pill";
import { RelativeTime } from "@/components/common/relative-time";
import { removeLlmKey } from "@/server/actions/users";
import type { LlmKeyRow } from "@/server/types";
import { AddLlmKeyForm } from "./add-llm-key-form";
import { clip, reinsert } from "./key-removal";

const PROVIDER_LABEL: Record<LlmKeyRow["provider"], string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

type PendingRemoval = { key: LlmKeyRow; index: number };

function keyName(key: LlmKeyRow) {
  return key.label ?? `${PROVIDER_LABEL[key.provider]} key`;
}

export function LlmKeysSection({ initialKeys }: { initialKeys: LlmKeyRow[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  // Bumped when a second removal replaces the first in the pill, so the pill remounts
  // with a full countdown instead of inheriting what was left of the previous one.
  const [pillRound, setPillRound] = useState(0);
  const [adding, setAdding] = useState(initialKeys.length === 0);
  // The same pending removal, readable from the unmount and pagehide handlers, which
  // run outside render and would otherwise see a stale closure.
  const pendingRef = useRef<PendingRemoval | null>(null);

  const track = useCallback((entry: PendingRemoval | null) => {
    pendingRef.current = entry;
    setPending(entry);
  }, []);

  // Until this runs a removal is only a hidden row. If the server refuses, the row
  // comes back where it was and says why, instead of looking removed and not being.
  const commitRemoval = useCallback(async (entry: PendingRemoval) => {
    let error: string | null = null;
    try {
      const result = await removeLlmKey(entry.key.id);
      if (!result.ok) error = result.error;
      else if (result.data.detachedAgents > 0) {
        const n = result.data.detachedAgents;
        toast(n === 1 ? "1 agent now has no key and cannot run." : `${n} agents now have no key and cannot run.`);
      }
    } catch {
      error = "Could not reach Tocker. The key is still there.";
    }
    if (error === null) return;
    setKeys((current) => reinsert(current, entry.key, entry.index));
    toast.error("Key not removed", { description: error });
  }, []);

  const softDelete = useCallback(
    (key: LlmKeyRow) => {
      // Only the newest removal is undoable. One still waiting is committed now rather
      // than overwritten — overwriting it used to cancel it without a word.
      const previous = pendingRef.current;
      if (previous) {
        void commitRemoval(previous);
        setPillRound((round) => round + 1);
      }
      const index = keys.findIndex((k) => k.id === key.id);
      track({ key, index: index < 0 ? keys.length : index });
      setKeys((current) => current.filter((k) => k.id !== key.id));
    },
    [keys, commitRemoval, track],
  );

  const undo = useCallback(() => {
    const entry = pendingRef.current;
    track(null);
    if (entry) setKeys((current) => reinsert(current, entry.key, entry.index));
  }, [track]);

  const expire = useCallback(() => {
    const entry = pendingRef.current;
    track(null);
    if (entry) void commitRemoval(entry);
  }, [commitRemoval, track]);

  // Leaving ends the undo window: switching to the Security tab unmounts this, closing
  // or reloading the page fires pagehide. Either way the removal goes through rather
  // than quietly never happening.
  useEffect(() => {
    const flush = () => {
      const entry = pendingRef.current;
      if (!entry) return;
      track(null);
      void commitRemoval(entry);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [commitRemoval, track]);

  return (
    <div className="space-y-5">
      {keys.length === 0 && !adding ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center">
          <KeyRound className="mx-auto size-5 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm font-medium">No keys yet</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
            An agent can&rsquo;t think without one. Add a provider key to get started.
          </p>
        </div>
      ) : null}

      {keys.length > 0 ? (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/80">
          {keys.map((key) => (
            <li key={key.id}>
              <SwipeToDelete
                label={`${PROVIDER_LABEL[key.provider]} key`}
                revealOnHover={false}
                onDelete={() => softDelete(key)}
              >
                <div className="flex items-center gap-3 bg-card px-4 py-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/70 bg-muted/40 text-muted-foreground">
                    <KeyRound className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{keyName(key)}</p>
                    <p className="tnum truncate font-mono text-xs text-muted-foreground">
                      {PROVIDER_LABEL[key.provider]} · ••••{key.last4} · added{" "}
                      <RelativeTime iso={key.createdAt} />
                    </p>
                  </div>
                  <HoldToConfirmButton
                    size="sm"
                    label="Hold to remove"
                    confirmedLabel="Removed"
                    duration={1200}
                    resetDelay={0}
                    className="hidden shrink-0 sm:inline-flex"
                    onConfirm={() => softDelete(key)}
                  />
                </div>
              </SwipeToDelete>
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <div className="rounded-xl border border-border/80 bg-background/40 p-4">
          <AddLlmKeyForm
            onAdded={(key) => {
              setKeys((current) => [...current, key]);
              setAdding(false);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Plus className="size-4" aria-hidden />
          {keys.length === 0 ? "Add a key" : "Add another key"}
        </button>
      )}

      {keys.length > 0 ? (
        <p className="text-xs text-muted-foreground sm:hidden">Swipe a key left to remove it.</p>
      ) : null}

      {/* Above the mobile tab bar (md:hidden), not on top of it. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-6">
        <div className="pointer-events-auto">
          <UndoPill
            key={pillRound}
            open={pending !== null}
            label={`Removed ${pending ? clip(keyName(pending.key), 24) : "the key"}`}
            duration={5}
            onUndo={undo}
            onExpire={expire}
          />
        </div>
      </div>
    </div>
  );
}
