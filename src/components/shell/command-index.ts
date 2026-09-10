/** The serialisable slice of app data the ⌘K palette searches over. */
export interface CommandIndex {
  agents: Array<{ slug: string; name: string; tagline: string | null; mode: "paper" | "live" }>;
  tokens: Array<{ symbol: string; name: string | null; chain: "solana" | "base"; address: string }>;
  users: Array<{ handle: string; displayName: string | null }>;
}

export const EMPTY_COMMAND_INDEX: CommandIndex = { agents: [], tokens: [], users: [] };
