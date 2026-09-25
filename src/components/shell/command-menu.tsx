"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MotionConfig } from "framer-motion";
import { Dialog } from "@base-ui/react/dialog";
import {
  Banknote,
  Bell,
  Bot,
  Coins,
  Compass,
  Gavel,
  LayoutGrid,
  Plus,
  Radio,
  Settings,
  Trophy,
  User,
  Wallet,
} from "lucide-react";
import { CommandPalette, type CommandItem } from "@/components/spectrumui/command-palette";
import { cn } from "@/lib/utils";
import { chainLabelFor } from "@/lib/wallets/funding";
import type { CommandIndex } from "./command-index";

type TokenHit = CommandIndex["tokens"][number];
type AgentHit = CommandIndex["agents"][number];
type UserHit = CommandIndex["users"][number];

/**
 * What `/api/tokens/search` answers with. Agents and people are optional: a response
 * with tokens alone simply adds no agent or people rows.
 */
interface SearchResponse {
  tokens?: TokenHit[];
  agents?: AgentHit[];
  users?: UserHit[];
}

/**
 * Merge a response's hits into what earlier responses found, keyed so a second hit for
 * the same row replaces the first rather than duplicating it. Returns the same array
 * when there is nothing new, so an empty response does not re-render the palette.
 */
function mergeHits<T>(previous: T[], hits: T[] | undefined, key: (hit: T) => string): T[] {
  if (!hits || hits.length === 0) return previous;
  const byKey = new Map(previous.map((hit) => [key(hit), hit]));
  for (const hit of hits) byKey.set(key(hit), hit);
  return [...byKey.values()];
}

const tokenKey = (token: TokenHit) => `${token.chain}:${token.address}`;

/** Shorter than this, a query is part of a symbol, not a pasted address. */
const MIN_ADDRESS_QUERY = 4;

/** Long enough to skip the keystrokes in a word, short enough to land before the next glance. */
const SEARCH_DEBOUNCE_MS = 150;

/** A palette row plus the text a query is matched against. */
type Row = CommandItem & { keywords: string };

/**
 * The registry palette matches a query against title, description *and* category, so
 * "go" lit up every row under a "Go to" header and "sol" every token on Solana. Rows
 * are filtered here first, on their own words only. Keywords are always drawn from a
 * row's title and description, so the palette's looser pass keeps every survivor.
 */
function matches(row: Row, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q.length === 0 || row.keywords.toLowerCase().includes(q);
}

/**
 * Overrides for the registry palette's low-contrast greys (neutral-600 on glass is
 * about 2.6:1) and its desktop-only keyboard hint. Descendant selectors because the
 * component takes one className, on its box; `!` because its own dark: classes win
 * otherwise. The footer's first child is the "Use arrows ↑↓ and Enter" hint.
 */
const PALETTE_READABLE = [
  "[&_h4]:!text-muted-foreground [&_.py-12]:!text-muted-foreground",
  "[&_input]:placeholder:!text-muted-foreground",
  // 16px on phones: iOS Safari zooms the page into any focused field smaller than
  // that, and this one autofocuses on every tap of Search.
  "[&_input]:max-sm:!text-base",
  "[&_kbd]:!text-muted-foreground [&_kbd]:!opacity-100",
  "[&>div:last-child]:!text-muted-foreground",
  "[&>div:last-child>div:first-child]:max-sm:!hidden",
  "[@media(pointer:coarse)]:[&>div:last-child>div:first-child]:!hidden",
  // The active row's highlight (an absolute layer inside each [data-index] row) is
  // near-invisible on the dark glass; lift it so the arrow-key position reads.
  "dark:[&_[data-index]>.absolute]:!bg-white/[0.08]",
];

/**
 * ⌘K is a 100-times-a-day action, so the palette opens without movement: the registry
 * component's entrance spring and sliding highlight run under `reducedMotion="always"`,
 * which makes transform and layout animations instant. The value is in what
 * it can reach: every agent, every person, and — through
 * `/api/tokens/search` — every token the platform has ever seen, not just the
 * handful the layout could afford to ship in the index.
 *
 * Rows are matched here on their own words (see `matches`); the fetch only adds
 * rows: a query returns the server's matches — tokens, plus public agents and people
 * where the route supplies them — merged in behind the index's. The index holds only
 * the viewer's agents and the newest public ones, so the rest has to come from there.
 *
 * No row carries a shortcut chip: nothing binds G-then-key or N, and a chip for a
 * key that does nothing is worse than none.
 */
export function CommandMenu({
  open,
  onClose,
  index,
}: {
  open: boolean;
  onClose: () => void;
  index: CommandIndex;
}) {
  const router = useRouter();
  const [fetched, setFetched] = useState<TokenHit[]>([]);
  const [fetchedAgents, setFetchedAgents] = useState<AgentHit[]>([]);
  const [fetchedUsers, setFetchedUsers] = useState<UserHit[]>([]);
  // The palette owns its input and exposes no onChange, so the typed query is read off
  // the change event as it bubbles out of it (see the wrapper below). Cleared on close
  // so a reopen starts from the full list, as the palette's own input does.
  const [query, setQuery] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setQuery("");
  }

  // The layout can only afford to ship a handful of tokens in the index, so the rest
  // come from the server as the user types: an empty query lists the table, a typed
  // one searches all of it. One request per settled keystroke, each aborted by the
  // next (and on close) so a slow response cannot land after the user has moved on.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/tokens/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : {}))
        .then((body: SearchResponse) => {
          // Merged, not replaced: earlier hits stay put while the palette filters them
          // client-side, instead of flickering out between two responses.
          setFetched((previous) => mergeHits(previous, body.tokens, tokenKey));
          setFetchedAgents((previous) => mergeHits(previous, body.agents, (agent) => agent.slug));
          setFetchedUsers((previous) => mergeHits(previous, body.users, (user) => user.handle));
        })
        .catch(() => {
          // A failed lookup costs the extra rows, never the palette.
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  const rows = useMemo<Row[]>(() => {
    const go = (href: string) => () => {
      router.push(href);
      onClose();
    };

    const actions: Array<Omit<Row, "keywords">> = [
      {
        id: "action-new-agent",
        title: "Create a new agent",
        description: "Identity, brain, data, risk — the whole builder",
        category: "Actions",
        icon: <Plus className="h-4 w-4" />,
        action: go("/agents/new"),
      },
      {
        id: "nav-home",
        title: "Home",
        description: "Cash, capital at work, equity and PnL across every agent",
        category: "Pages",
        icon: <LayoutGrid className="h-4 w-4" />,
        action: go("/home"),
      },
      {
        id: "nav-feed",
        title: "Feed",
        description: "What every agent just did and why",
        category: "Pages",
        icon: <Radio className="h-4 w-4" />,
        action: go("/feed"),
      },
      {
        id: "nav-discover",
        title: "Discover",
        description: "Leaderboard, trending tokens, top data sources",
        category: "Pages",
        icon: <Compass className="h-4 w-4" />,
        action: go("/discover"),
      },
      {
        id: "nav-agents",
        title: "My agents",
        description: "Everything you have deployed",
        category: "Pages",
        icon: <Bot className="h-4 w-4" />,
        action: go("/agents"),
      },
      {
        id: "nav-money",
        title: "Money",
        description: "Equity, P&L by day, and what the fees, data and tokens cost",
        category: "Pages",
        icon: <Banknote className="h-4 w-4" />,
        action: go("/money"),
      },
      {
        id: "nav-leaderboard",
        title: "Leaderboard",
        description: "Who is winning over 7 days, 30 days and all time",
        category: "Pages",
        icon: <Trophy className="h-4 w-4" />,
        action: go("/discover#leaderboard-heading"),
      },
      {
        id: "nav-approvals",
        title: "Trades awaiting approval",
        description: "Proposals your agents are holding for a decision",
        category: "Pages",
        icon: <Gavel className="h-4 w-4" />,
        action: go("/home#activity"),
      },
      {
        id: "nav-wallet",
        title: "Wallet & capital",
        description: "Unified USDC cash and what each agent is holding",
        category: "Pages",
        icon: <Wallet className="h-4 w-4" />,
        action: go("/home"),
      },
      {
        id: "nav-notifications",
        title: "Notifications",
        description: "Fills, failures, follows and comments",
        category: "Pages",
        icon: <Bell className="h-4 w-4" />,
        action: go("/notifications"),
      },
      {
        id: "nav-settings",
        title: "Settings",
        description: "LLM keys, profile, notifications",
        category: "Pages",
        icon: <Settings className="h-4 w-4" />,
        action: go("/settings"),
      },
    ];

    // Index first, server hits behind it, deduped by slug.
    const agentsBySlug = new Map<string, AgentHit>();
    for (const agent of [...index.agents, ...fetchedAgents]) {
      if (!agentsBySlug.has(agent.slug)) agentsBySlug.set(agent.slug, agent);
    }
    const agents: Row[] = [...agentsBySlug.values()].map((agent) => ({
      id: `agent-${agent.slug}`,
      title: agent.name,
      description: agent.tagline ?? `${agent.mode} agent`,
      category: "Agents",
      icon: <Bot className="h-4 w-4" />,
      action: go(`/agents/${agent.slug}`),
      keywords: `${agent.name} ${agent.tagline ?? `${agent.mode} agent`}`,
    }));

    // Index first, server hits behind it, deduped by chain:address.
    const byId = new Map<string, TokenHit>();
    for (const token of [...index.tokens, ...fetched]) {
      byId.set(tokenKey(token), token);
    }
    // A pasted contract address is how people look a token up when they only have the
    // mint. The server matches it; the row has to say why it is there, so it swaps its
    // description for the address — which is also what lets it through the palette's
    // own title-and-description pass. Only when the words alone would not have matched.
    const q = query.trim().toLowerCase();
    const tokens: Row[] = [...byId.entries()].map(([id, token]) => {
      // Symbol and name; not the chain, which every token on it shares.
      const words = `${token.symbol} ${token.name ?? token.symbol}`;
      const addressHit =
        q.length >= MIN_ADDRESS_QUERY &&
        token.address.toLowerCase().includes(q) &&
        !words.toLowerCase().includes(q);
      return {
        id: `token-${id}`,
        title: token.symbol,
        description: addressHit
          ? `${chainLabelFor(token.chain)} · ${token.address}`
          : `${token.name ?? token.symbol} · ${chainLabelFor(token.chain)}`,
        category: "Tokens",
        icon: <Coins className="h-4 w-4" />,
        // The token's own page — score, history, who holds it — not a filtered board.
        action: go(`/tokens/${token.chain}/${token.address}`),
        keywords: addressHit ? `${words} ${token.address}` : words,
      };
    });

    const usersByHandle = new Map<string, UserHit>();
    for (const user of [...index.users, ...fetchedUsers]) {
      if (!usersByHandle.has(user.handle)) usersByHandle.set(user.handle, user);
    }
    const users: Row[] = [...usersByHandle.values()].map((user) => ({
      id: `user-${user.handle}`,
      title: user.displayName ?? user.handle,
      description: `@${user.handle}`,
      category: "People",
      icon: <User className="h-4 w-4" />,
      action: go(`/u/${user.handle}`),
      keywords: `${user.displayName ?? user.handle} @${user.handle}`,
    }));

    return [
      ...actions.map((row) => ({ ...row, keywords: `${row.title} ${row.description}` })),
      ...agents,
      ...tokens,
      ...users,
    ];
  }, [index, fetched, fetchedAgents, fetchedUsers, query, router, onClose]);

  const commands = useMemo<CommandItem[]>(() => rows.filter((row) => matches(row, query)), [rows, query]);

  // A real modal dialog around the registry palette, which is a plain div: Base UI adds
  // the dialog role and name, traps focus inside, makes the page behind it inert and
  // hands focus back to whatever had it (usually the Search button) on close. The popup
  // is `display: contents` so the palette's own fixed layout is untouched.
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Popup
          aria-label="Search agents, tokens, people"
          className="contents"
          // The palette moves its highlight from a window keydown listener; Base UI's
          // popup handles the arrows first and stops them, so the list never moved.
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") event.preventBaseUIHandler();
          }}
        >
          <div
            className="contents"
            onChange={(event) => {
              const target = event.target;
              if (target instanceof HTMLInputElement) setQuery(target.value);
            }}
          >
            <MotionConfig reducedMotion="always">
              <CommandPalette
                isOpen={open}
                onClose={onClose}
                commands={commands}
                placeholder="Search agents, tokens, people…"
                footerLabel="Tocker"
                /*
                 * The registry component paints its own neutral glass, and `cn` merges
                 * last-wins, so these four utilities re-point it at our material tokens —
                 * the same recipe `.glass-heavy` uses. The palette is the app's single
                 * heaviest surface: whatever is behind it is out of play.
                 */
                className={cn(
                  "bg-[var(--glass-overlay)] dark:bg-[var(--glass-overlay)]",
                  "border-[var(--glass-hairline)] dark:border-[var(--glass-hairline)]",
                  "backdrop-blur-[var(--glass-blur-heavy)] backdrop-saturate-[1.7]",
                  "shadow-[var(--glass-overlay-shadow)]",
                  PALETTE_READABLE,
                )}
              />
            </MotionConfig>
          </div>
          {/* Phones have no Escape key and the ESC chip is desktop-only, so the backdrop
              was the only way out — and nothing said so. Above the palette's own box,
              which starts at 15vh; after it in the DOM so the input still takes focus. */}
          <Dialog.Close className="fixed top-[calc(15vh-2.75rem)] right-4 z-[51] rounded-lg bg-[var(--glass-overlay)] px-3 py-1.5 text-sm text-muted-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:hidden">
            Cancel
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
