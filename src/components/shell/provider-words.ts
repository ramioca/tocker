import { providerLabel, type CatalogueId } from "@/lib/agent/providers";

/**
 * Words in a provider's name that mean something else in the search palette. "Nebius
 * Token Factory" must not make the word "token" find Settings in a palette whose main
 * use is finding tokens.
 */
const MEANS_SOMETHING_ELSE = /\b(?:tokens?|agents?)\b/g;

/**
 * The words someone types to find where their keys live, for a set of providers: each
 * one's name and its id ("hugging face" and "huggingface", "google gemini" and "google").
 * Lower-case, space-separated, ready to be matched as text.
 *
 * The palette hands it the providers a key can be added for, so a provider is findable
 * from the day it is switched on and not before.
 */
export function providerSearchWords(ids: readonly CatalogueId[]): string {
  return ids
    .flatMap((id) => {
      const name = providerLabel(id).toLowerCase().replace(MEANS_SOMETHING_ELSE, " ").replace(/\s+/g, " ").trim();
      return name === id ? [id] : [name, id];
    })
    .join(" ");
}
