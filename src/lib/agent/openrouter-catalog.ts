/**
 * OpenRouter's model list, for the picker.
 *
 * OpenRouter carries hundreds of models and adds some every week, so a list kept by hand
 * is wrong within days: it was offering one id that no longer existed and one model
 * that cannot call tools. Their catalogue is public and needs no key, so the picker
 * reads it, through this module and the route beside it, never from the browser.
 *
 * OpenRouter was the first provider read this way and is no longer the only one. The
 * fetch, the hourly cache and the parser now live with every other provider's in
 * `providers-keys.ts`; this file keeps the names the rest of the code knows them by.
 */
import "server-only";
import { CATALOGUE } from "./providers";
import { getPublicCatalog, resetPublicCatalogs, type PublicCatalog } from "./providers-keys";

export { parseOpenRouterModels } from "./providers-keys";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export type OpenRouterCatalog = PublicCatalog;

/**
 * The catalogue, fetched at most once an hour per server instance. Never throws: when
 * OpenRouter cannot be reached the last good list is served, and failing that the short
 * built-in one, with `live: false` so the picker can say so. Any id can still be typed.
 */
export async function getOpenRouterCatalog(now: number = Date.now()): Promise<OpenRouterCatalog> {
  // Never null for OpenRouter, whose row says its list is public. The fallback is here
  // so that this function's promise holds whatever the row says.
  return (await getPublicCatalog("openrouter", now)) ?? { models: [...CATALOGUE.openrouter.models], live: false };
}

/** Test seam: forget the fetched list. */
export function resetOpenRouterCatalog(): void {
  resetPublicCatalogs("openrouter");
}
