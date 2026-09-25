/**
 * Agents that need attention first, then everyone else, each group in the order given.
 *
 * Home shows only six cards but its subtitle counts every blocked agent, so an older
 * agent with no key must not be counted up there and missing down here. `sort` is
 * stable, so within each group the query's newest-first order holds.
 */
export function attentionFirst<T extends { id: string }>(
  agents: T[],
  blocked?: { has(id: string): boolean },
): T[] {
  if (!blocked) return agents;
  return [...agents].sort((a, b) => Number(blocked.has(b.id)) - Number(blocked.has(a.id)));
}
