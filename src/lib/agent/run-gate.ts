/**
 * Why a run started by hand is refused before it starts.
 *
 * A person can start one from two places: `triggerRun` (Run now on the agent page) and
 * `POST /api/agents/[id]/run` (the live wizard's "Run one tick now"). The sentences
 * live here so the two cannot drift. A leaf module on purpose: no database, no model.
 */
import type { InferenceStopReason } from "@/lib/x402/inference-types";

/**
 * The owner's kill switch is on. The scheduler already skips their agents, and
 * `place_trade` refuses every buy while it is on, so a run started by hand could open
 * nothing: it would spend the owner's model tokens to find that out. Exits do not need
 * a run; the marks loop fires them whether trading is paused or not.
 */
export const RUN_REFUSED_WHILE_PAUSED = "All trading is paused. Resume it in Settings → Security to run this agent.";

/**
 * A key agent with no key. The page disables Run now for it, but a stale page or a direct
 * call would otherwise start a run that can only fail. An agent that pays per use needs
 * no key and is never told this.
 */
export const RUN_REFUSED_WITHOUT_KEY = "Attach an LLM key before running this agent";

/** A run that was put off, not refused: nothing is wrong with the agent. */
export const RUN_DEFERRED = "This run could not be started just now. Try again in a minute.";

/**
 * A scheduled run that was not started because the agent has no room to buy and its
 * owner has it skip such runs (`schedule.skipWhenFull`). Nothing is wrong with the agent:
 * no run row is written, nothing is paid, and it is looked at again at its next
 * scheduled time. Said without the owner's figures, because this text is a result of the
 * cron pass; the owner reads the reason, with its numbers, on the agent's own pages.
 */
export const RUN_SKIPPED_NO_ROOM = "Not started: this agent skips scheduled runs while it has no room to buy.";

/**
 * Thrown by `startRun` when a pay-per-use agent may not run: its wallet is short, a
 * limit is reached, pay-per-use is paused. No run row exists and nothing was charged.
 * The message is the sentence the owner reads, written in
 * `describeInferenceStop`; `reason` is null when the run was only put off.
 *
 * It lives in this leaf, not beside `startRun`, so the action and the route that catch
 * it do not have to load the run loop to name it.
 */
export class RunRefusedError extends Error {
  readonly reason: InferenceStopReason | null;

  constructor(message: string, reason: InferenceStopReason | null) {
    super(message);
    this.name = "RunRefusedError";
    this.reason = reason;
  }
}

/** True for a {@link RunRefusedError}, including one that crossed a module boundary and lost its class. */
export function isRunRefused(err: unknown): err is RunRefusedError {
  return err instanceof RunRefusedError || (err instanceof Error && err.name === "RunRefusedError");
}
