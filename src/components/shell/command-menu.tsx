"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Bot, Coins, Compass, Home, Plus, Settings, User } from "lucide-react";
import { CommandPalette, type CommandItem } from "@/components/spectrumui/command-palette";
import type { CommandIndex } from "./command-index";

type TokenHit = CommandIndex["tokens"][number];

/**
 * ⌘K is a 100-times-a-day action, so the palette itself gets no open animation
 * budget beyond what the registry component already ships. The value is in what
 * it can reach: every agent, every person, and — through
 * `/api/tokens/search` — every token the platform has ever seen, not just the
 * handful the layout could afford to ship in the index.
 *
 * The palette filters its own items, so this only fetches: a query returns the
 * server's matches, which are merged in behind whatever the index already had.
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

  // The layout can only afford to ship a handful of tokens in the index, so the
  // rest are pulled once the palette is actually open. Aborted on close so a slow
  // response cannot land after the user has moved on.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/tokens/search?q=", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { tokens: [] }))
      .then((body: { tokens?: TokenHit[] }) => setFetched(body.tokens ?? []))
      .catch(() => {
        // A failed lookup costs the extra tokens, never the palette.
      });
    return () => controller.abort();
  }, [open]);

  const commands = useMemo<CommandItem[]>(() => {
    const go = (href: string) => () => {
      router.push(href);
      onClose();
    };

    const actions: CommandItem[] = [
      {
        id: "action-new-agent",
        title: "Create a new agent",
        description: "Identity, brain, data, risk — the whole builder",
        category: "Actions",
        shortcut: ["N"],
        icon: <Plus className="h-4 w-4" />,
        action: go("/agents/new"),
      },
      {
        id: "nav-feed",
        title: "Feed",
        description: "What every agent just did and why",
        category: "Actions",
        icon: <Home className="h-4 w-4" />,
        action: go("/feed"),
      },
      {
        id: "nav-discover",
        title: "Discover",
        description: "Leaderboard, trending tokens, top data sources",
        category: "Actions",
        icon: <Compass className="h-4 w-4" />,
        action: go("/discover"),
      },
      {
        id: "nav-agents",
        title: "My agents",
        description: "Everything you have deployed",
        category: "Actions",
        icon: <Bot className="h-4 w-4" />,
        action: go("/agents"),
      },
      {
        id: "nav-notifications",
        title: "Notifications",
        description: "Fills, failures, follows and comments",
        category: "Actions",
        icon: <Bell className="h-4 w-4" />,
        action: go("/notifications"),
      },
      {
        id: "nav-settings",
        title: "Settings",
        description: "LLM keys, profile, notifications",
        category: "Actions",
        icon: <Settings className="h-4 w-4" />,
        action: go("/settings"),
      },
    ];

    const agents: CommandItem[] = index.agents.map((agent) => ({
      id: `agent-${agent.slug}`,
      title: agent.name,
      description: agent.tagline ?? `${agent.mode} agent`,
      category: "Agents",
      icon: <Bot className="h-4 w-4" />,
      action: go(`/agents/${agent.slug}`),
    }));

    // Index first, server hits behind it, deduped by chain:address.
    const byId = new Map<string, TokenHit>();
    for (const token of [...index.tokens, ...fetched]) {
      byId.set(`${token.chain}:${token.address}`, token);
    }
    const tokens: CommandItem[] = [...byId.entries()].map(([id, token]) => ({
      id: `token-${id}`,
      title: token.symbol,
      description: `${token.name ?? token.symbol} · ${token.chain}`,
      category: "Tokens",
      icon: <Coins className="h-4 w-4" />,
      // The token's own page — score, history, who holds it — not a filtered board.
      action: go(`/tokens/${token.chain}/${token.address}`),
    }));

    const users: CommandItem[] = index.users.map((user) => ({
      id: `user-${user.handle}`,
      title: user.displayName ?? user.handle,
      description: `@${user.handle}`,
      category: "People",
      icon: <User className="h-4 w-4" />,
      action: go(`/u/${user.handle}`),
    }));

    return [...actions, ...agents, ...tokens, ...users];
  }, [index, fetched, router, onClose]);

  return (
    <CommandPalette
      isOpen={open}
      onClose={onClose}
      commands={commands}
      placeholder="Search agents, tokens, people…"
      footerLabel="Petri"
    />
  );
}
