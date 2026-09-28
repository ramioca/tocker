"use client";

/**
 * Pick the token an order is for — by name, not by mint.
 *
 * The Trade sheet used to be a bare address box: to buy BONK you had to already have its
 * mint on your clipboard, which nobody coming from a feed card does. This searches the
 * tokens Tocker has seen (the same `/api/tokens/search` ⌘K uses), filtered to the order's
 * chain, and still takes a pasted address for anything newer than that table — a launch
 * minutes old is the product's whole point, so paste is never taken away.
 *
 * On a sell the agent's own positions on this chain are offered first as one-tap chips:
 * selling is almost always "one of the things I hold", and there is nothing to search.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Search, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TokenIcon } from "@/components/common/token-icon";
import { formatUsd } from "@/components/common/format";
import { isValidAddressForChain } from "@/lib/wallet-address";
import { cn } from "@/lib/utils";
import type { Chain, Position } from "@/server/types";

export interface PickedToken {
  chain: Chain;
  address: string;
  symbol: string | null;
  name: string | null;
  logoUrl: string | null;
}

interface SearchHit {
  symbol: string;
  name: string | null;
  chain: Chain;
  address: string;
  logoUrl?: string | null;
}

const SEARCH_DEBOUNCE_MS = 180;
const MAX_HITS = 6;

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

export function TokenPicker({
  id,
  chain,
  side,
  value,
  onChange,
  holdings,
}: {
  id: string;
  chain: Chain;
  side: "buy" | "sell";
  /** The chosen token, or null while nothing is chosen. */
  value: PickedToken | null;
  onChange: (token: PickedToken | null) => void;
  /** The agent's open positions — offered as chips on a sell. */
  holdings: Position[];
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ forQuery: string; items: SearchHit[] } | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  const text = query.trim();
  const isAddress = text.length > 0 && isValidAddressForChain(chain, text);
  const searchable = text.length >= 1 && !isAddress;
  const current = hits !== null && hits.forQuery === `${chain}|${text}` ? hits.items : null;
  const searching = searchable && current === null;

  // Search as they type. Keyed by chain and text, so a slow answer for "bo" can never
  // replace the list for "bonk".
  useEffect(() => {
    if (!searchable) return;
    const forQuery = `${chain}|${text}`;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/tokens/search?q=${encodeURIComponent(text)}`, { signal: controller.signal });
        const body = (await res.json()) as { tokens?: SearchHit[] };
        const items = (body.tokens ?? []).filter((hit) => hit.chain === chain).slice(0, MAX_HITS);
        setHits({ forQuery, items });
        setActive(0);
      } catch {
        if (!controller.signal.aborted) setHits({ forQuery, items: [] });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [searchable, chain, text]);

  const pick = (token: PickedToken) => {
    onChange(token);
    setQuery("");
    setOpen(false);
  };

  // A pasted address is the order's token straight away — there is nothing to choose.
  const commitAddress = (raw: string) => {
    const trimmed = raw.trim();
    if (isValidAddressForChain(chain, trimmed)) {
      pick({ chain, address: trimmed, symbol: null, name: null, logoUrl: null });
      return true;
    }
    return false;
  };

  const onChain = holdings.filter((position) => position.token.chain === chain && (position.valueUsd ?? 0) > 0);

  if (value) {
    const held = onChain.find((position) => position.token.address === value.address);
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-border/80 bg-card/40 px-2.5 py-2">
        <TokenIcon
          token={{ id: `${value.chain}:${value.address}`, symbol: value.symbol ?? "?", logoUrl: value.logoUrl }}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {value.symbol ?? "Pasted address"}
            {value.name && value.name !== value.symbol ? (
              <span className="ml-1.5 font-normal text-muted-foreground">{value.name}</span>
            ) : null}
          </p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {shortAddress(value.address)}
            {held ? <span className="tnum"> · you hold {formatUsd(held.valueUsd)}</span> : null}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            // Back to the box, so "change" is one tap and then typing.
            window.setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-ring"
        >
          <XIcon aria-hidden className="size-3.5" />
          Change
        </button>
      </div>
    );
  }

  const showList = open && searchable;
  const items = current ?? [];

  return (
    <div className="space-y-2">
      {side === "sell" ? (
        onChain.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Your positions">
            {onChain.map((position) => (
              <button
                key={position.token.id}
                type="button"
                onClick={() =>
                  pick({
                    chain,
                    address: position.token.address,
                    symbol: position.token.symbol,
                    name: position.token.name,
                    logoUrl: position.token.logoUrl,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 py-1 pr-2.5 pl-1.5 text-xs transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-border hover:bg-muted/50 active:scale-[0.97] focus-ring"
              >
                <TokenIcon token={position.token} size="xs" />
                <span className="font-medium">{position.token.symbol}</span>
                <span className="tnum text-muted-foreground">{formatUsd(position.valueUsd)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No open positions on this chain — nothing to sell yet.
          </p>
        )
      ) : null}

      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && items[active] ? `${listId}-${active}` : undefined}
          value={query}
          spellCheck={false}
          autoComplete="off"
          placeholder={side === "sell" ? "Or search / paste a token" : "Search a token, or paste its address"}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            setOpen(true);
            commitAddress(next);
          }}
          onPaste={(event) => {
            if (commitAddress(event.clipboardData.getData("text"))) event.preventDefault();
          }}
          onKeyDown={(event) => {
            if (!showList) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((i) => Math.min(items.length - 1, i + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (event.key === "Enter" && items[active]) {
              event.preventDefault();
              const hit = items[active];
              pick({ chain, address: hit.address, symbol: hit.symbol, name: hit.name, logoUrl: hit.logoUrl ?? null });
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          // 16px on phones: iOS zooms the page into any input smaller than that.
          className="pl-8 text-base md:text-sm"
        />
        {searching ? (
          <Loader2
            aria-hidden
            className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground motion-safe:animate-spin"
          />
        ) : null}

        {showList ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute inset-x-0 top-[calc(100%+4px)] z-20 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
          >
            {searching && items.length === 0 ? (
              <li className="px-2.5 py-2 text-xs text-muted-foreground">Searching…</li>
            ) : items.length === 0 ? (
              <li className="px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                No match on {chain === "solana" ? "Solana" : "Base"} yet. Paste the{" "}
                {chain === "solana" ? "mint address" : "0x contract address"} — any token works.
              </li>
            ) : (
              items.map((hit, index) => (
                <li
                  key={hit.address}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  // mousedown, not click: click lands after the input's blur closed the list.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick({ chain, address: hit.address, symbol: hit.symbol, name: hit.name, logoUrl: hit.logoUrl ?? null });
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5",
                    index === active ? "bg-muted" : null,
                  )}
                >
                  <TokenIcon
                    token={{ id: `${hit.chain}:${hit.address}`, symbol: hit.symbol, logoUrl: hit.logoUrl ?? null }}
                    size="xs"
                  />
                  <span className="text-sm font-medium">{hit.symbol}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{hit.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{shortAddress(hit.address)}</span>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
