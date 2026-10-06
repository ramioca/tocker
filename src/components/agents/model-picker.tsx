"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_MODELS,
  PROVIDER_LABELS,
  featuredFirst,
  filterModels,
  knownModelLabel,
  priceHint,
  typedModelId,
  type LlmProvider,
  type ModelOption,
} from "@/lib/agent/models";
import { cn } from "@/lib/utils";

/**
 * Which model the agent thinks on.
 *
 * A search box over the provider's list rather than a plain select, for two reasons. The
 * lists are long now (OpenRouter's runs to hundreds and is read live), and a provider
 * ships a model faster than a list is edited, so whatever is typed can be used as an id
 * as it stands: nobody waits on a release of this app to try a model their key already
 * reaches. The provider decides whether the id exists; a wrong one fails the first run
 * with the provider's own message.
 */
export function ModelPicker({
  id,
  provider,
  value,
  onChange,
}: {
  id?: string;
  provider: LlmProvider;
  value: string;
  onChange: (model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // OpenRouter's catalogue is fetched the first time the picker opens on it, and shared
  // with every other picker on the page.
  const openRouter = useQuery({
    queryKey: ["models", "openrouter"],
    queryFn: async (): Promise<{ models: ModelOption[]; live: boolean }> => {
      const res = await fetch("/api/models/openrouter");
      if (!res.ok) throw new Error(`models ${res.status}`);
      return (await res.json()) as { models: ModelOption[]; live: boolean };
    },
    enabled: open && provider === "openrouter",
    staleTime: 10 * 60_000,
    retry: 1,
  });

  const models: readonly ModelOption[] =
    provider === "openrouter"
      ? featuredFirst(openRouter.data?.models ?? DEFAULT_MODELS.openrouter, DEFAULT_MODELS.openrouter)
      : DEFAULT_MODELS[provider];
  const rows = filterModels(models, query);
  const typed = typedModelId(models, query);
  const rowCount = rows.length + (typed ? 1 : 0);

  const current = models.find((model) => model.id === value);
  const currentLabel = current?.label ?? knownModelLabel(value);

  // Keep the highlighted row on screen as the arrow keys move it.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (model: string) => {
    onChange(model);
    setOpen(false);
  };

  const chooseRow = (index: number) => {
    const row = rows[index];
    if (row) choose(row.id);
    else if (typed && index === rows.length) choose(typed);
  };

  const footer =
    provider === "openrouter"
      ? openRouter.isPending && open
        ? "Loading OpenRouter's list…"
        : openRouter.data?.live
          ? `${models.length} models that can run an agent, from OpenRouter's own list.`
          : "Couldn't reach OpenRouter's list, so this is a short one. Any model id can be typed."
      : `Not listed? Type its id exactly as ${PROVIDER_LABELS[provider]} names it.`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setActive(0);
        }
      }}
    >
      <PopoverTrigger
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        className={cn(
          "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-left text-sm transition-colors outline-none select-none",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50",
        )}
      >
        <span className={cn("min-w-0 truncate", currentLabel ? null : "font-mono text-[13px]")}>
          {currentLabel ?? value}
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        initialFocus={inputRef}
        className="w-(--anchor-width) min-w-72 gap-0 p-0"
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-2.5">
          <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, Math.max(rowCount - 1, 0)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                chooseRow(active);
              }
            }}
            placeholder="Search, or type a model id"
            aria-label="Search models"
            aria-controls={listId}
            aria-activedescendant={rowCount > 0 ? `${listId}-${active}` : undefined}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            // 16px on phones so iOS does not zoom the page into the field.
            className="h-9 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
          />
        </div>

        <ul ref={listRef} id={listId} role="listbox" aria-label="Models" className="max-h-64 overflow-y-auto p-1">
          {rows.map((model, index) => {
            const price = priceHint(model);
            const selected = model.id === value;
            return (
              <li
                key={model.id}
                id={`${listId}-${index}`}
                data-row={index}
                role="option"
                aria-selected={selected}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(model.id)}
                className={cn(
                  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  index === active ? "bg-muted text-foreground" : null,
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{model.label}</span>
                  <span className="tnum truncate text-[11px] text-muted-foreground">
                    <span className="font-mono">{model.id}</span>
                    {price ? ` · ${price}` : null}
                  </span>
                </span>
                {selected ? <Check aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : null}
              </li>
            );
          })}

          {typed ? (
            <li
              id={`${listId}-${rows.length}`}
              data-row={rows.length}
              role="option"
              aria-selected={false}
              onPointerMove={() => setActive(rows.length)}
              onClick={() => choose(typed)}
              className={cn(
                "flex cursor-default flex-col rounded-md px-2 py-1.5 text-sm",
                rows.length === active ? "bg-muted text-foreground" : null,
              )}
            >
              <span className="truncate">
                Use <span className="font-mono text-[13px]">{typed}</span>
              </span>
              <span className="text-[11px] text-muted-foreground">
                Not in the list. {PROVIDER_LABELS[provider]} decides whether it exists.
              </span>
            </li>
          ) : null}

          {rowCount === 0 ? (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">
              No model matches. A model id has no spaces.
            </li>
          ) : null}
        </ul>

        <p className="border-t border-border/60 px-2.5 py-1.5 text-[11px] leading-4 text-muted-foreground">{footer}</p>
      </PopoverContent>
    </Popover>
  );
}
