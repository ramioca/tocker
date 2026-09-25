"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tocker's ⌘K surface: the Spectrum `command-palette`, owned here so it can be
 * accessible. The registry component is a list of plain divs under an unlabelled input —
 * arrow keys moved a highlight nobody could hear, and the result count was never said —
 * and SPEC keeps `src/components/spectrumui` hand-edit-free. Same props and the same
 * markup landmarks (category `h4`s, `[data-index]` rows, the footer's first child as the
 * keyboard hint), so a caller's overrides keep landing.
 *
 * The WAI-ARIA combobox pattern: the input owns the listbox through `aria-controls` and
 * points at the highlighted option with `aria-activedescendant`, so focus never leaves
 * the input and typing keeps working while the arrows move. A polite live region says how
 * many results there are, or the empty text.
 *
 * No motion at all: ⌘K opens a hundred times a day, and anything that animates on the
 * way in is something to wait for.
 */

export interface SearchPaletteItem {
  id: string;
  title: string;
  description: string;
  category: string;
  shortcut?: string[];
  icon: ReactNode;
  action: () => void;
}

export interface SearchPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  /** Already filtered: the palette matches the typed query against title, description and category too. */
  commands: SearchPaletteItem[];
  /** The input's accessible name, and the listbox's. */
  label: string;
  placeholder?: string;
  /** Said and shown when nothing matches, e.g. "Searching…" while a lookup is in flight. */
  emptyText?: string;
  footerLabel?: string;
  className?: string;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function SearchPalette({
  isOpen,
  onClose,
  commands,
  label,
  placeholder = "Search…",
  emptyText = "No results",
  footerLabel,
  className,
}: SearchPaletteProps) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset on open, during render rather than in an effect, so the first painted frame
  // is already the fresh list.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setQuery("");
      setActiveIndex(0);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return commands.filter((item) => `${item.title} ${item.description} ${item.category}`.toLowerCase().includes(q));
  }, [commands, query]);

  // A shorter list must not leave the highlight past its end.
  const active = filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1);
  const optionId = (index: number) => `${listId}-option-${index}`;

  const groups = useMemo(() => {
    const byCategory = new Map<string, Array<{ item: SearchPaletteItem; index: number }>>();
    filtered.forEach((item, index) => {
      const list = byCategory.get(item.category) ?? [];
      list.push({ item, index });
      byCategory.set(item.category, list);
    });
    return [...byCategory.entries()];
  }, [filtered]);

  // A window listener, as in the registry component: a dialog wrapped around the palette
  // may claim the arrows first, and its caller can hand them on (see command-menu.tsx).
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (filtered.length === 0) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current) => (Math.min(current, filtered.length - 1) + step + filtered.length) % filtered.length);
      } else if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        if (active >= 0) filtered[active]?.action();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose, filtered, active]);

  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!isOpen) return null;

  const announcement = filtered.length === 0 ? emptyText : plural(filtered.length, "result", "results");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[15vh]">
      <div aria-hidden onClick={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-xs" />

      <div
        className={cn(
          "relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border text-left shadow-2xl",
          "glass-heavy",
          className,
        )}
      >
        <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3.5">
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={label}
            aria-expanded={filtered.length > 0}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            className="flex-1 border-0 bg-transparent text-base text-foreground outline-hidden placeholder:text-muted-foreground focus:ring-0 sm:text-sm"
          />
          <kbd className="hidden h-5 items-center rounded border border-border px-1.5 font-mono text-[9px] font-medium text-muted-foreground select-none sm:inline-flex">
            ESC
          </kbd>
        </div>

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="max-h-[340px] overflow-x-hidden overflow-y-auto p-2"
        >
          {filtered.length === 0 ? (
            <div role="presentation" className="py-12 text-center text-sm text-muted-foreground">
              {emptyText}
            </div>
          ) : (
            groups.map(([category, items], groupIndex) => {
              const headingId = `${listId}-group-${groupIndex}`;
              return (
                <div key={category} role="group" aria-labelledby={headingId} className="mb-2 last:mb-0">
                  {/* Names the group through `aria-labelledby`; hidden itself, since a
                      heading is not something a listbox may contain. */}
                  <h4
                    id={headingId}
                    aria-hidden
                    className="px-3 py-1.5 font-mono text-[9px] font-medium tracking-widest text-muted-foreground uppercase"
                  >
                    {category}
                  </h4>
                  <div className="mt-1 space-y-0.5">
                    {items.map(({ item, index }) => {
                      const isActive = index === active;
                      return (
                        <div
                          key={item.id}
                          id={optionId(index)}
                          role="option"
                          aria-selected={isActive}
                          data-index={index}
                          onClick={() => item.action()}
                          // Move, not enter: arrowing scrolls rows under a resting
                          // pointer, and `mouseenter` would steal the highlight back.
                          onMouseMove={() => {
                            if (!isActive) setActiveIndex(index);
                          }}
                          className={cn(
                            "relative z-10 flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 select-none",
                            isActive ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {isActive ? (
                            <div aria-hidden className="absolute inset-0 -z-10 rounded-xl bg-foreground/[0.07]" />
                          ) : null}
                          <div className="flex min-w-0 items-center gap-3">
                            <div aria-hidden className={cn("shrink-0", isActive ? "text-foreground" : "text-muted-foreground")}>
                              {item.icon}
                            </div>
                            <div className="min-w-0">
                              <span className="block text-sm leading-none font-medium">{item.title}</span>
                              <span className="mt-1 block max-w-xs truncate text-[11px] leading-none text-muted-foreground">
                                {item.description}
                              </span>
                            </div>
                          </div>
                          {item.shortcut || isActive ? (
                            <div aria-hidden className="ml-4 flex shrink-0 items-center gap-1">
                              {item.shortcut?.map((key, keyIndex) => (
                                <kbd
                                  key={keyIndex}
                                  className="inline-flex size-5 items-center justify-center rounded border border-border font-mono text-[9px] font-medium text-muted-foreground select-none"
                                >
                                  {key}
                                </kbd>
                              ))}
                              {isActive ? <CornerDownLeft className="ml-1.5 size-3 text-muted-foreground" /> : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <div className="flex items-center justify-between border-t border-border/50 px-4 py-2 font-mono text-[10px] text-muted-foreground">
          <div aria-hidden className="flex items-center gap-1.5">
            <span>Use arrows</span>
            <kbd className="rounded border border-border px-1 font-mono text-[9px]">↑↓</kbd>
            <span>and</span>
            <kbd className="rounded border border-border px-1 font-mono text-[9px]">Enter</kbd>
          </div>
          {footerLabel ? <div>{footerLabel}</div> : null}
        </div>
      </div>
    </div>
  );
}
