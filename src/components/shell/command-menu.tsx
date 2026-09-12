"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Bell, Bot, Coins, Compass, Home, Plus, Settings, User } from "lucide-react";
import { CommandPalette, type CommandItem } from "@/components/spectrumui/command-palette";
import type { CommandIndex } from "./command-index";

/**
 * ⌘K is a 100-times-a-day action, so the palette itself gets no open animation
 * budget beyond what the registry component already ships. The value is in what
 * it can reach: every agent, every token in the allowlists, every person.
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

    const tokens: CommandItem[] = index.tokens.map((token) => ({
      id: `token-${token.chain}-${token.address}`,
      title: token.symbol,
      description: `${token.name ?? token.symbol} · ${token.chain}`,
      category: "Tokens",
      icon: <Coins className="h-4 w-4" />,
      action: go(`/discover?token=${token.chain}:${token.address}`),
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
  }, [index, router, onClose]);

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
