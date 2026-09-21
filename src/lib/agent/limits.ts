/**
 * How many different tokens one tick may propose to the owner (approval mode).
 *
 * One was the de-facto rule — the prompt said "at most once per tick" and the model
 * read it as one proposal — which made every tick a single yes/no. Three lets the agent
 * lay out its shortlist and the owner pick, while keeping a tick from queuing a page of
 * decisions against the same cash. The per-day trade cap still bounds it from above.
 */
export const MAX_PROPOSALS_PER_TICK = 3;
