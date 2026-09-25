"use client";

/**
 * Public agents grid: sort, search, infinite scroll.
 *
 * The search runs on the server (`listPublicAgents({ query })`: name, slug, tagline and
 * the owner's handle), so it reaches agents that were never loaded. While the debounced
 * request is in flight the loaded rows are filtered here, so typing answers at once.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Boxes, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import type { AgentCard, Page } from "@/server/types";
import { BeamSearchInput } from "./beam-search-input";
import { AgentGridCard } from "./agent-grid-card";
import { matchesAgent, normalizeSearch } from "./agent-search";

type Sort = "pnl" | "new" | "followers";

/** Long enough that a word typed at speed is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 250;

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: "pnl", label: "Top PnL" },
  { id: "new", label: "Newest" },
  { id: "followers", label: "Most followed" },
];

export function PublicAgents({ initial }: { initial: Page<AgentCard> }) {
  const [sort, setSort] = useState<Sort>("pnl");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The search the loaded `items` answer. Until it catches up with `query`, the loaded
  // rows are filtered here instead.
  const [appliedQuery, setAppliedQuery] = useState("");
  const sentinel = useRef<HTMLDivElement>(null);
  // Only the newest request may write. A page of "Top PnL" landing after the switch to
  // "Newest" used to be appended to the new list and overwrite its cursor — one agent
  // twice, another never, and "That's every public agent." underneath.
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (nextSort: Sort, nextCursor: string | null, replace: boolean, q: string) => {
      const id = ++requestRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ sort: nextSort });
        if (nextCursor) params.set("cursor", nextCursor);
        if (q) params.set("q", q);
        const response = await fetch(`/api/discover/agents?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Could not load agents");
        const page = (await response.json()) as Page<AgentCard>;
        if (id !== requestRef.current) return;
        setItems((current) => {
          if (replace) return page.items;
          // Offset cursors shift when the ranking moves between two requests; never
          // render the same agent twice (it is also the React key).
          const seen = new Set(current.map((agent) => agent.id));
          return [...current, ...page.items.filter((agent) => !seen.has(agent.id))];
        });
        setCursor(page.nextCursor);
        setAppliedQuery(q);
      } catch {
        // Superseded (aborted or simply stale): the newer request owns the state.
        if (id !== requestRef.current) return;
        setError("Could not load more agents.");
      } finally {
        if (id === requestRef.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  const trimmed = query.trim().slice(0, 64);

  // Ask the server once typing pauses. Skipped when the loaded rows already answer it
  // (the first render, or typing back to the last search).
  useEffect(() => {
    if (trimmed === appliedQuery) return;
    const timer = window.setTimeout(() => void load(sort, null, true, trimmed), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed, appliedQuery, sort, load]);

  function changeSort(next: Sort) {
    if (next === sort) return;
    abortRef.current?.abort();
    setSort(next);
    setItems([]);
    setCursor(null);
    void load(next, null, true, trimmed);
  }

  // Infinite scroll: fetch when the sentinel comes within a screen of the viewport.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor || loading) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void load(sort, cursor, false, appliedQuery);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loading, sort, load, appliedQuery]);

  const filtering = trimmed.length > 0;
  // Settled: the rows on screen are the server's answer to what is in the box.
  const settled = trimmed === appliedQuery;
  const visible = useMemo(() => {
    const q = normalizeSearch(query);
    if (!q || settled) return items;
    return items.filter((agent) => matchesAgent(agent, q));
  }, [items, query, settled]);

  return (
    <section aria-labelledby="agents-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="agents-heading" className="flex items-center gap-2 text-lg font-medium tracking-tight">
            <Boxes className="size-4.5 text-primary" aria-hidden />
            Public agents
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every fill public, every strategy private. Judge them on the record.
          </p>
        </div>
        <BeamSearchInput
          value={query}
          onValueChange={setQuery}
          label="Search public agents"
          placeholder="Search name, owner, tagline…"
          className="w-full sm:w-72"
        />
      </div>

      {/* A sort, not tabs: there is one list and no panels, so pressed buttons. */}
      <div role="group" aria-label="Sort agents" className="mt-5 flex flex-wrap gap-1.5">
        {SORTS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={sort === option.id}
            onClick={() => changeSort(option.id)}
            className={`h-8 rounded-lg border px-3 text-xs font-medium transition-colors duration-150 focus-ring ${
              sort === option.id
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/80 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* With a filter on, a background page load is not a reason to show skeletons:
          the answer to "zzzz" is the empty state, and a match that arrives replaces it. */}
      {visible.length === 0 && (!loading || filtering) ? (
        <EmptyState
          className="mt-6"
          icon={<Boxes />}
          title={filtering ? `Nothing matches “${query.trim()}”` : "No public agents yet"}
          description={
            filtering
              ? !settled || loading
                ? "Searching every public agent…"
                : "No public agent's name, owner handle or tagline matches. Try a shorter word."
              : "Be the first to publish one. Every fill is public; the strategy behind it never is."
          }
          action={
            filtering ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs transition-colors duration-150 hover:bg-muted"
              >
                Clear the filter
              </button>
            ) : (
              <Link
                href="/agents/new"
                className="focus-ring rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
              >
                Publish an agent
              </Link>
            )
          }
        />
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((agent) => (
            <li key={agent.id}>
              <AgentGridCard agent={agent} />
            </li>
          ))}
          {loading && !filtering
            ? Array.from({ length: 3 }, (_, i) => (
                <li key={`skeleton-${i}`} aria-hidden>
                  <div className="glass-card h-56 rounded-2xl motion-safe:animate-pulse" />
                </li>
              ))
            : null}
        </ul>
      )}

      {error ? (
        <div className="mt-6 text-center">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <button
            type="button"
            onClick={() => void load(sort, cursor, false, appliedQuery)}
            className="mt-2 inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.97] focus-ring"
          >
            Try again
          </button>
        </div>
      ) : null}

      <div ref={sentinel} className="h-px" aria-hidden />

      <p aria-live="polite" className="mt-6 text-center text-xs text-muted-foreground">
        {loading ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Loading more agents
          </span>
        ) : filtering ? (
          // A filtered list is not the list: "every public agent" under three cards read
          // as if those three were all there is. Say what was searched, too.
          visible.length > 0 && settled ? (
            `${visible.length}${cursor ? "+" : ""} match${visible.length === 1 && !cursor ? "" : "es"}`
          ) : null
        ) : !cursor && items.length > 0 ? (
          "That's every public agent."
        ) : null}
      </p>
    </section>
  );
}
