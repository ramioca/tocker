/**
 * Which provider a pasted key belongs to, read from the prefix each provider prints on
 * its keys. A key saved under the wrong provider passes every check here when that
 * provider can't be reached, and only fails on the agent's next run — so the form says
 * so while the key is still in the field.
 *
 * Pure and dependency-free so the server actions can run the same check.
 */

export type KeyProvider = "anthropic" | "openai" | "openrouter";

const NAMES: Record<KeyProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

/**
 * The provider the key's prefix names, or null when it names none. A legacy bare
 * `sk-` OpenAI key is also how every other prefix starts, so it stays null rather than
 * raising a false alarm; only the unambiguous prefixes count.
 */
export function providerFromKeyPrefix(key: string): KeyProvider | null {
  const k = key.trim();
  if (/^sk-ant-/.test(k)) return "anthropic";
  if (/^sk-or-/.test(k)) return "openrouter";
  if (/^sk-(proj|svcacct|admin)-/.test(k)) return "openai";
  return null;
}

/** The provider the key belongs to when it is not `chosen`; null when it matches or can't tell. */
export function mismatchedProvider(key: string, chosen: KeyProvider): KeyProvider | null {
  const detected = providerFromKeyPrefix(key);
  return detected && detected !== chosen ? detected : null;
}

export function providerName(provider: KeyProvider): string {
  return NAMES[provider];
}

/** Refusal for adding a key under the wrong provider: the fix is to pick the other one. */
export function wrongProviderOnAdd(detected: KeyProvider, chosen: KeyProvider): string {
  return `That looks like an ${providerName(detected)} key, not an ${providerName(chosen)} one — choose ${providerName(detected)} as the provider`;
}

/** Refusal for rotating a key into another provider's: a rotation can't change provider. */
export function wrongProviderOnRotate(detected: KeyProvider, existing: KeyProvider): string {
  return `That looks like an ${providerName(detected)} key; this is an ${providerName(existing)} key — add it as a new key instead`;
}
