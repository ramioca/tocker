/**
 * Which provider a pasted key belongs to, read from the prefix each provider prints on
 * its keys. A key saved under the wrong provider passes every check here when that
 * provider can't be reached, and only fails on the agent's next run — so the form says
 * so while the key is still in the field.
 *
 * The prefixes and the sentences live on the provider rows (`providers.ts`); this file
 * is the older way in to them. It answers only with providers a key can be added for,
 * because what it returns is offered back as "Switch to …". `keyProblem` there is the
 * whole check: it also refuses a key that belongs to a provider not offered yet, and a
 * key missing the prefix its provider documents.
 *
 * Pure and dependency-free so the server actions can run the same check.
 */
import { isProvider, keyPrefixProvider, providerLabel, wrongProviderSentence, type LlmProvider } from "./providers";

export type KeyProvider = LlmProvider;

/**
 * The provider the key's prefix names, or null when it names none. A legacy bare
 * `sk-` OpenAI key is also how every other prefix starts, so it stays null rather than
 * raising a false alarm; only the unambiguous prefixes count.
 */
export function providerFromKeyPrefix(key: string): KeyProvider | null {
  const owner = keyPrefixProvider(key);
  return isProvider(owner) ? owner : null;
}

/** The provider the key belongs to when it is not `chosen`; null when it matches or can't tell. */
export function mismatchedProvider(key: string, chosen: KeyProvider): KeyProvider | null {
  const detected = providerFromKeyPrefix(key);
  return detected && detected !== chosen ? detected : null;
}

export function providerName(provider: KeyProvider): string {
  return providerLabel(provider);
}

/** Refusal for adding a key under the wrong provider: the fix is to pick the other one. */
export function wrongProviderOnAdd(detected: KeyProvider, chosen: KeyProvider): string {
  return wrongProviderSentence(detected, chosen, "add");
}

/** Refusal for rotating a key into another provider's: a rotation can't change provider. */
export function wrongProviderOnRotate(detected: KeyProvider, existing: KeyProvider): string {
  return wrongProviderSentence(detected, existing, "rotate");
}
