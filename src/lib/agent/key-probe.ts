import "server-only";
import { isProvider, type LlmProvider } from "./providers";
import { checkKey, type KeyProbe } from "./providers-keys";

/**
 * One free, authenticated request that says whether a provider recognises an LLM key,
 * made before the key is saved.
 *
 * Without it the key form said "Added" for any 16 characters, and a typo'd or revoked
 * key only surfaced as a "Failed runs" notification after an agent woke up with it.
 * Each probe is a read that costs nothing: a model list, or a provider's own endpoint
 * about the key or its account where the model list answers without one.
 *
 * Which request that is for each provider, and what its answer means, is that
 * provider's entry in `providers-keys.ts`. This file is the way in the key actions use.
 *
 * Three answers, and only one of them blocks:
 *
 * - `ok` — the provider accepted the key.
 * - `rejected` — the provider said this key is not a key (401 for most; Google and xAI
 *   say it with a 400). The caller refuses it.
 * - `unreachable` — we could not tell: a timeout, a network error, a 5xx, a rate limit,
 *   or a refusal that is about where the request came from rather than the key. The
 *   caller saves the key and says it could not check. Blocking a valid key because a
 *   provider was down would be worse than the failed run this exists to prevent.
 *
 * Never throws, and never logs or returns the key.
 */

export type { KeyProbe } from "./providers-keys";
export { probeOutcome } from "./providers-keys";

export async function probeLlmKey(provider: LlmProvider, key: string, workspaceId?: string | null): Promise<KeyProbe> {
  // A provider that is not switched on is never sent a key. `rejected` saves nothing;
  // the actions refuse such a provider by name before they get here.
  if (!isProvider(provider)) return "rejected";
  return checkKey(provider, key, workspaceId);
}
