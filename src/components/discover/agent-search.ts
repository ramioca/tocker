import { modelLabel } from "@/components/social-common/chain-badge";
import type { AgentCard } from "@/server/types";

/**
 * Folds a query and the text it is matched against into one shape: lower case, no
 * leading "@", and runs of spaces / dashes / underscores / slashes / dots collapsed to
 * one space. The cards print "@dex" and "GPT-5 mini" while the row holds "dex" and
 * "gpt-5-mini", so without this, typing what you can see found nothing.
 */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/^@+/, "")
    .replace(/[\s\-_/.]+/g, " ")
    .trim();
}

type Searchable = Pick<AgentCard, "name" | "tagline" | "model"> & {
  owner: Pick<AgentCard["owner"], "handle" | "displayName">;
};

/**
 * Whether an agent answers a public-agents search. Everything matched is already on the
 * card (name, owner, tagline, model chip) — nothing about the strategy behind it.
 * `query` is the normalized form; an empty one matches every agent.
 */
export function matchesAgent(agent: Searchable, query: string): boolean {
  if (!query) return true;
  return [
    agent.name,
    agent.owner.handle,
    agent.owner.displayName ?? "",
    agent.tagline ?? "",
    agent.model,
    modelLabel(agent.model),
  ].some((field) => normalizeSearch(field).includes(query));
}
