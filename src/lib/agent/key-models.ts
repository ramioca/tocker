import "server-only";
import { isProvider, type LlmProvider } from "./providers";
import { listModels, type KeyModels } from "./providers-keys";

/**
 * The models a key can use, asked of the provider that issued it.
 *
 * The built-in lists (`providers.ts`) are edited by hand and a provider ships a model
 * faster than that happens. Most providers answer "which models may this key call?" for
 * free, so the picker asks them, through the owner's own saved key.
 *
 * This is the second place a stored key is used, after the run loop. The caller decrypts
 * it for this one request; nothing here logs, returns or keeps the key, and what comes
 * back is model ids, names and list prices only. A provider whose list is public
 * (OpenRouter and others) is not asked by key, and one with no usable list is not asked
 * at all: which is which is the provider's row, and how each is asked is its entry in
 * `providers-keys.ts`.
 *
 * Never throws. `rejected` means the provider refused the key itself; `unreachable`
 * covers everything else (a timeout, a 5xx, a restricted key that may not list models,
 * a provider that is not asked by key), and the picker falls back to the built-in list
 * either way.
 */

export type { KeyModels } from "./providers-keys";
export { parseAnthropicModels, parseOpenAiModels } from "./providers-keys";

export async function listModelsForKey(provider: LlmProvider, key: string, workspaceId?: string | null): Promise<KeyModels> {
  // Whatever a stored row says its provider is, a key is only ever sent to one that is
  // switched on, and then to that provider's own host and no other.
  if (!isProvider(provider)) return { ok: false, reason: "unreachable" };
  return listModels(provider, key, workspaceId);
}
