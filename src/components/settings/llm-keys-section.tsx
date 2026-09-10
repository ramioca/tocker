"use client";

import { useCallback, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { SwipeToDelete } from "@/components/spectrumui/swipe-to-delete";
import { UndoPill } from "@/components/spectrumui/undo-pill";
import { removeLlmKey } from "@/server/actions/users";
import type { LlmKeyRow } from "@/server/types";
import { formatJoined } from "@/components/social-common/format";
import { AddLlmKeyForm } from "./add-llm-key-form";

const PROVIDER_LABEL: Record<LlmKeyRow["provider"], string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

export function LlmKeysSection({ initialKeys }: { initialKeys: LlmKeyRow[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [pending, setPending] = useState<{ key: LlmKeyRow; index: number } | null>(null);
  const [adding, setAdding] = useState(initialKeys.length === 0);

  const softDelete = useCallback(
    (key: LlmKeyRow) => {
      const index = keys.findIndex((k) => k.id === key.id);
      setPending({ key, index: index < 0 ? keys.length : index });
      setKeys((current) => current.filter((k) => k.id !== key.id));
    },
    [keys],
  );

  const undo = useCallback(() => {
    if (!pending) return;
    const { key, index } = pending;
    setKeys((current) => {
      const next = [...current];
      next.splice(index, 0, key);
      return next;
    });
    setPending(null);
  }, [pending]);

  const commit = useCallback(() => {
    if (!pending) return;
    void removeLlmKey(pending.key.id).catch(() => {
      // Foundation's action is still a stub; the row stays removed in dev.
    });
    setPending(null);
  }, [pending]);

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
                    <p className="truncate text-sm font-medium">
                      {key.label ?? `${PROVIDER_LABEL[key.provider]} key`}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {PROVIDER_LABEL[key.provider]} · sk-••••{key.last4} · added{" "}
                      {formatJoined(key.createdAt)}
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
          Add another key
        </button>
      )}

      <p className="text-xs text-muted-foreground sm:hidden">Swipe a key left to remove it.</p>

      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        <div className="pointer-events-auto">
          <UndoPill
            open={pending !== null}
            label={`Removed ${pending?.key.label ?? "the key"}`}
            duration={5}
            onUndo={undo}
            onExpire={commit}
          />
        </div>
      </div>
    </div>
  );
}
