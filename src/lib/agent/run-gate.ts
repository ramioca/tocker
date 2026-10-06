/**
 * Why a run started by hand is refused before it starts.
 *
 * A person can start one from two places: `triggerRun` (Run now on the agent page) and
 * `POST /api/agents/[id]/run` (the live wizard's "Run one tick now"). The sentences
 * live here so the two cannot drift. A leaf module on purpose: no database, no model.
 */

/**
 * The owner's kill switch is on. The scheduler already skips their agents, and
 * `place_trade` refuses every buy while it is on, so a run started by hand could open
 * nothing: it would spend the owner's model tokens to find that out. Exits do not need
 * a run; the marks loop fires them whether trading is paused or not.
 */
export const RUN_REFUSED_WHILE_PAUSED = "All trading is paused. Resume it in Settings → Security to run this agent.";
