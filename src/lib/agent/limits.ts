/**
 * How many different tokens one tick may propose to the owner (approval mode).
 *
 * One was the de-facto rule — the prompt said "at most once per tick" and the model
 * read it as one proposal — which made every tick a single yes/no. Three lets the agent
 * lay out its shortlist and the owner pick, while keeping a tick from queuing a page of
 * decisions against the same cash. The per-day trade cap still bounds it from above.
 */
export const MAX_PROPOSALS_PER_TICK = 3;

/**
 * How many fresh candidates a tick scores before it may decide. One or two was the
 * habit — the top of the same ranked table every five minutes, the same three names
 * proposed and declined. Five, from the part of the table the agent has not already
 * held, proposed or scored in the last ninety minutes, is the floor for "researched".
 */
export const MIN_SCORED_PER_TICK = 5;
/** A token scored this recently is "seen": still shown, but not fresh research. */
export const SEEN_WINDOW_MS = 90 * 60_000;
