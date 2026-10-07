"use client";

import { useCallback, useId, useRef, useState, type Ref } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { providerLabel, type LlmProvider } from "@/lib/agent/providers";
import { cn } from "@/lib/utils";
import {
  chooserFooter,
  keyPage,
  moveActive,
  openingRow,
  optionAt,
  providerHelp,
  providerOptions,
} from "./provider-choice";

/**
 * Brings the chosen provider's row to the middle of the list by scrolling the list
 * itself. Not `scrollIntoView`: this runs as the list mounts, before the popover has
 * been put in its place, and that call would scroll the page to wherever it then was.
 */
function centreSelectedRow(list: HTMLElement) {
  const row = list.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!row) return;
  const box = list.getBoundingClientRect();
  const at = row.getBoundingClientRect();
  list.scrollTop += at.top + at.height / 2 - (box.top + box.height / 2);
}

/**
 * Which provider the agent's model runs on, or a key is being added for.
 *
 * A search box over the registry's providers, built like the model picker beside it and
 * for the same reason: the list is too long for a plain select, and people look for a
 * provider by what it makes ("grok", "kimi") as often as by its name, which the
 * registry's search words answer.
 *
 * Unlike a model, a provider is never free text. The only way a value leaves this
 * component is a row of the list (`optionAt`), and the list is the enabled providers.
 * What is typed only narrows it.
 *
 * Everything that decides something is in `provider-choice.ts`, where it is tested.
 */
export function ProviderPicker({
  id,
  value,
  onChange,
  triggerRef,
  autoFocus,
  describedBy,
  aboveDialog = false,
  className,
}: {
  id?: string;
  value: LlmProvider;
  /** Called only when a different provider is chosen: picking the same one again changes nothing. */
  onChange: (provider: LlmProvider) => void;
  /** The trigger, for a form that sends focus back to it. */
  triggerRef?: Ref<HTMLButtonElement>;
  /** Focus the trigger on mount, for a form opened by a button that has just unmounted. */
  autoFocus?: boolean;
  /** The id of the line under the chooser, so the trigger is read out with it. */
  describedBy?: string;
  /** Set inside the onboarding dialog, so the list opens over it and not under it. */
  aboveDialog?: boolean;
  /** Extra classes for the trigger: the key form's fields are a step taller than the builder's. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listId = useId();

  const rows = providerOptions(query);

  // The list opens with the highlight on the provider already chosen, which can be far
  // down it, so that row is brought into view as the list mounts. Stable on purpose:
  // React calls a ref again whenever it is a new function, and this must run once per
  // opening, not on every key press.
  const mountList = useCallback((list: HTMLUListElement | null) => {
    listRef.current = list;
    if (list) centreSelectedRow(list);
  }, []);

  /** Moves the highlight, and keeps the row it lands on on screen. */
  const highlight = (index: number) => {
    setActive(index);
    listRef.current?.querySelector<HTMLElement>(`[data-row="${index}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const choose = (provider: LlmProvider) => {
    // The forms reset the model and the key when the provider changes. Choosing the one
    // already chosen is not a change, and must not cost anyone the model they picked.
    if (provider !== value) onChange(provider);
    setOpen(false);
  };

  const chooseRow = (index: number) => {
    const provider = optionAt(rows, index);
    if (provider) choose(provider);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setActive(openingRow(providerOptions(""), value));
        }
      }}
    >
      <PopoverTrigger
        ref={triggerRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-describedby={describedBy}
        autoFocus={autoFocus}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-left text-sm transition-colors outline-none select-none",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50",
          className,
        )}
      >
        <span className="min-w-0 truncate">{providerLabel(value)}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        initialFocus={inputRef}
        aboveDialog={aboveDialog}
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
              const key = event.key;
              if (key === "ArrowDown" || key === "ArrowUp") {
                event.preventDefault();
                highlight(moveActive(active, key, rows.length));
              } else if (key === "Enter") {
                // An Enter that only confirms what an input method was composing is not
                // a choice. The form above ignores that one too.
                if (event.nativeEvent.isComposing) return;
                // Stopped here as well as handled. The list is drawn outside the form it
                // belongs to, but React still hands the key press up to that form, and
                // the key form submits on Enter in any text box: choosing a provider
                // with the keyboard would have sent the key along with it.
                event.preventDefault();
                event.stopPropagation();
                chooseRow(active);
              }
            }}
            placeholder="Search providers"
            aria-label="Search providers"
            aria-controls={listId}
            aria-activedescendant={rows.length > 0 ? `${listId}-${active}` : undefined}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            // 16px on phones so iOS does not zoom the page into the field.
            className="h-9 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
          />
        </div>

        <ul ref={mountList} id={listId} role="listbox" aria-label="Providers" className="max-h-64 overflow-y-auto p-1">
          {rows.map((row, index) => {
            const selected = row.id === value;
            return (
              <li
                key={row.id}
                id={`${listId}-${index}`}
                data-row={index}
                role="option"
                aria-selected={selected}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(row.id)}
                className={cn(
                  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  index === active ? "bg-muted text-foreground" : null,
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{row.label}</span>
                  {/* One line, cut short: the whole note stands under the chooser once
                      this provider is chosen. */}
                  {row.note ? <span className="truncate text-[11px] text-muted-foreground">{row.note}</span> : null}
                </span>
                {selected ? <Check aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : null}
              </li>
            );
          })}

          {rows.length === 0 ? (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">No provider matches.</li>
          ) : null}
        </ul>

        <p className="border-t border-border/60 px-2.5 py-1.5 text-[11px] leading-4 text-muted-foreground">
          {chooserFooter(providerOptions("").length)}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** A link inside a sentence of help text: the treatment the key forms' links have always had. */
const INLINE_LINK =
  "rounded-sm text-foreground underline decoration-muted-foreground/50 underline-offset-2 transition-colors duration-150 hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * A provider's key page as a link that reads as the site it goes to ("openrouter.ai"),
 * opened in a new tab. The address is the registry's constant for that provider, never
 * anything typed or fetched. Nothing for a provider that has no row.
 */
export function KeyPageLink({ provider }: { provider: string }) {
  const page = keyPage(provider);
  if (!page) return null;
  return (
    <a href={page.href} target="_blank" rel="noreferrer" className={INLINE_LINK}>
      {page.host}
    </a>
  );
}

/**
 * The line under the chooser: what the registry notes about the provider it is on, and,
 * while the account has no key for that provider, where one is made. Renders nothing
 * when there is neither. `hasKey` is the caller's to say, since only the form knows
 * which keys the account holds.
 */
export function ProviderHelp({
  id,
  provider,
  hasKey,
  className,
}: {
  id?: string;
  provider: string;
  hasKey: boolean;
  className?: string;
}) {
  const help = providerHelp(provider, { hasKey });
  if (!help) return null;
  return (
    <p id={id} className={cn("text-xs leading-5 text-muted-foreground", className)}>
      {help.note}
      {help.note && help.keyPage ? " " : null}
      {help.keyPage ? (
        <>
          Create a key at <KeyPageLink provider={provider} />.
        </>
      ) : null}
    </p>
  );
}
