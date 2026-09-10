"use client";

/**
 * Public agents grid: sort, client-side filter, infinite scroll.
 *
 * The filter runs over loaded rows — `listPublicAgents` has no `query` parameter yet
 * (see the report's proposed additions), so searching deep into the archive needs a
 * server-side filter to be added.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Loader2 } from "lucide-react";
import type { AgentCard, Page } from "@/server/types";
import { BeamSearchInput } from "./beam-search-input";
import { AgentGridCard } from "./agent-grid-card";

type Sort = "pnl" | "new" | "followers";

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
  const sentinel = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (nextSort: Sort, nextCursor: string | null, replace: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ sort: nextSort });
        if (nextCursor) params.set("cursor", nextCursor);
        const response = await fetch(`/api/discover/agents?${params}`);
        if (!response.ok) throw new Error("Could not load agents");
        const page = (await response.json()) as Page<AgentCard>;
        setItems((current) => (replace ? page.items : [...current, ...page.items]));
        setCursor(page.nextCursor);
      } catch {
        setError("Could not load more agents.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  function changeSort(next: Sort) {
    if (next === sort) return;
    setSort(next);
    setItems([]);
    setCursor(null);
    void load(next, null, true);
  }

  // Infinite scroll: fetch when the sentinel comes within a screen of the viewport.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor || loading) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void load(sort, cursor, false);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loading, sort, load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (agent) =>
        agent.name.toLowerCase().includes(q) ||
        agent.owner.handle.toLowerCase().includes(q) ||
        (agent.tagline ?? "").toLowerCase().includes(q) ||
        agent.model.toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <section aria-labelledby="agents-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="agents-heading" className="flex items-center gap-2 text-lg font-medium tracking-tight">
            <Boxes className="size-4.5 text-primary" aria-hidden />
            Public agents
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every one of them forkable, config and all.
          </p>
        </div>
        <BeamSearchInput
          value={query}
          onValueChange={setQuery}
          label="Search public agents"
          placeholder="Search name, owner, model…"
          className="w-full sm:w-72"
        />
      </div>

      <div role="tablist" aria-label="Sort agents" className="mt-5 flex flex-wrap gap-1.5">
        {SORTS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={sort === option.id}
            onClick={() => changeSort(option.id)}
            className={`h-8 rounded-lg border px-3 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
              sort === option.id
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/80 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {visible.length === 0 && !loading ? (
        <p className="mt-6 rounded-2xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
          {query
            ? `Nothing loaded matches “${query}”.`
            : "No public agents yet. Be the first to publish one."}
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((agent) => (
            <li key={agent.id}>
              <AgentGridCard agent={agent} />
            </li>
          ))}
          {loading
            ? Array.from({ length: 3 }, (_, i) => (
                <li key={`skeleton-${i}`} aria-hidden>
                  <div className="h-56 animate-pulse rounded-2xl border border-border/60 bg-card/40" />
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
            onClick={() => void load(sort, cursor, false)}
            className="mt-2 inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
        ) : !cursor && items.length > 0 ? (
          "That's every public agent."
        ) : null}
      </p>
    </section>
  );
}
