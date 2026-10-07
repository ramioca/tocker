/**
 * What the provider chooser and the key forms around it show, decided without a browser.
 *
 * The screens have no component tests (vitest runs `*.test.ts` only), so whatever decides
 * something is a plain function here: which providers the chooser lists for what was
 * typed, which row Enter takes, what is said under the chooser, and why a key is refused
 * before it is sent anywhere.
 *
 * Every word about a provider is read from its row in `providers.ts`. Nothing in this
 * file keeps a list of its own.
 *
 * A provider arrives typed as one of the enabled ids, but it is read from places a type
 * does not guard: a saved key's row, an agent's stored config, a draft in localStorage.
 * So everything here takes a plain string and has an answer for an id it does not know,
 * instead of throwing while a page renders.
 */
import { mismatchedProvider } from "@/lib/agent/key-prefix";
import {
  CATALOGUE,
  KEY_UNSENDABLE,
  KEY_WRAPPED,
  PROVIDER_ORDER,
  PROVIDER_UNSUPPORTED,
  filterProviders,
  isCatalogueId,
  isProvider,
  keyFitsHeader,
  keyIsWrapped,
  keyProblem,
  providerLabel,
  requestTemperature,
  searchProviders,
  withArticle,
  type CatalogueId,
  type KeyUse,
  type LlmProvider,
  type ProviderRow,
} from "@/lib/agent/providers";
import { REDACTED, redactSecrets } from "@/lib/security/redact";

/** The row for an id that may not be one. Asked by membership first, never by indexing with a stray string. */
function rowOf(provider: string): ProviderRow | null {
  return isCatalogueId(provider) ? CATALOGUE[provider] : null;
}

// ------------------------------------------------------------------ the chooser

export interface ProviderOption<T extends CatalogueId = LlmProvider> {
  id: T;
  label: string;
  /** The row's second line: what a new account with this provider runs into, when the registry says. */
  note: string | null;
}

function toOption<T extends CatalogueId>(id: T): ProviderOption<T> {
  return { id, label: CATALOGUE[id].label, note: CATALOGUE[id].note ?? null };
}

/**
 * The rows for whichever of `ids` a search keeps, in the order they came in. The chooser
 * itself only ever lists the enabled providers (`providerOptions`); this is the same
 * thing for any set, which is what lets a test ask about a provider before it is
 * switched on.
 */
export function optionsFor<T extends CatalogueId>(ids: readonly T[], query: string): ProviderOption<T>[] {
  return searchProviders(ids, query).map(toOption);
}

/** What the chooser lists for what was typed: the enabled providers, in display order. */
export function providerOptions(query: string): ProviderOption[] {
  return filterProviders(query).map(toOption);
}

/**
 * The provider a row stands for, or null when there is no such row. This is the only way
 * anything leaves the chooser, so what was typed is never a value: a search that matches
 * nothing has no row to take, and Enter then does nothing.
 */
export function optionAt<T extends CatalogueId>(options: readonly ProviderOption<T>[], index: number): T | null {
  return options[index]?.id ?? null;
}

/**
 * The row the highlight starts on when the chooser opens: the provider already chosen.
 * Choosing a provider resets the agent's model and key, so Enter straight after opening
 * has to keep what is there, where the model picker, which changes nothing else, starts
 * on its first row.
 */
export function openingRow(options: readonly ProviderOption<CatalogueId>[], value: string): number {
  return Math.max(options.findIndex((option) => option.id === value), 0);
}

/** Where an arrow key moves the highlight: one row, stopping at either end of the list. */
export function moveActive(active: number, key: "ArrowDown" | "ArrowUp", rowCount: number): number {
  return key === "ArrowDown" ? Math.min(active + 1, Math.max(rowCount - 1, 0)) : Math.max(active - 1, 0);
}

/** The line under the list. */
export function chooserFooter(count: number): string {
  return count === 1
    ? "One provider. The model runs on your own account with it, and it bills you."
    : `${count} providers. The model runs on your own account with the one you choose, and it bills you.`;
}

// --------------------------------------------------------- under the chooser

export interface KeyPage {
  href: string;
  /** What the link reads as: the site, without the path. */
  host: string;
}

/** Where this provider's keys are made. From the registry only, and only ever an https page. */
export function keyPage(provider: string): KeyPage | null {
  const row = rowOf(provider);
  if (!row) return null;
  try {
    const url = new URL(row.keyPage);
    if (url.protocol !== "https:") return null;
    return { href: row.keyPage, host: url.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

export interface ProviderHelp {
  /** The registry's one line about this provider, or why it cannot be used. */
  note: string | null;
  /** Set when the account has no key for this provider: the page to make one on. */
  keyPage: KeyPage | null;
}

/**
 * What stands under the chooser for the provider it is on, or null for nothing.
 *
 * The note is the registry's, shown whenever there is one. The link to the key page is
 * for someone who has to go and fetch a key, so it shows only while the account has none
 * for this provider. A provider that is not offered gets one sentence saying so: a saved
 * agent or key can still name one after it has been switched off.
 */
export function providerHelp(provider: string, account: { hasKey: boolean }): ProviderHelp | null {
  if (!isProvider(provider)) {
    return { note: `Tocker cannot run an agent on ${providerLabel(provider)}. Choose another provider.`, keyPage: null };
  }
  const note = CATALOGUE[provider].note ?? null;
  const page = account.hasKey ? null : keyPage(provider);
  return note || page ? { note, keyPage: page } : null;
}

// ------------------------------------------------------------- the key field

/** The key box's placeholder, as the registry has it. */
export function keyPlaceholder(provider: string): string {
  return rowOf(provider)?.keyHint ?? "";
}

/**
 * What a key of this provider starts with, for the brackets after the field's label
 * ("API key (sk-ant-…)"), or null where the registry has only the words "API key": the
 * label already says that much.
 */
export function keyShapeHint(provider: string): string | null {
  const hint = rowOf(provider)?.keyHint;
  return hint && hint.includes("…") ? hint : null;
}

/** "Add an OpenAI key", "Add a Groq key": the article by sound, from the registry. */
export function addKeyLabel(provider: string): string {
  return `Add ${withArticle(provider)} key`;
}

// The server refuses anything shorter (src/server/actions/users.ts), so the forms do too.
export const KEY_MIN = 16;
export const KEY_TOO_SHORT = "That doesn’t look like a full API key — paste the whole thing.";

/**
 * Why the form will not send this key, as the one sentence to put under the field, or
 * null when nothing here speaks against it.
 *
 * Everything in it needs no request, and that is the point: a key pasted under the wrong
 * provider is stopped in the browser, before it has been sent to Tocker, let alone to a
 * provider it does not belong to. The server makes the same refusal for a direct call.
 */
export function keyRefusal(provider: string, key: string, use: KeyUse = "add"): string | null {
  const trimmed = key.trim();
  // More than the key was pasted (quotes, `NAME=`). Said before anything about its
  // length or its provider: with the wrapping on, neither can be judged.
  if (keyIsWrapped(trimmed)) return KEY_WRAPPED;
  if (trimmed.length < KEY_MIN) return KEY_TOO_SHORT;
  // A character no request header can carry. The surrounding whitespace is already off.
  if (!keyFitsHeader(trimmed)) return KEY_UNSENDABLE;
  // A saved key whose provider has been switched off can still be listed. Replacing it
  // would send the new key to the server only to be refused there.
  if (!isProvider(provider)) return PROVIDER_UNSUPPORTED;
  return keyProblem(provider, trimmed, use);
}

export interface KeyNote {
  text: string;
  /** The provider the key belongs to, when it is one that can be chosen instead. */
  switchTo: LlmProvider | null;
}

/**
 * The note under the key box while a key is still being typed or has just been pasted.
 *
 * Wrapping (quotes, `NAME=`) is said as soon as it is there: no key has any, and switching
 * provider would not help while it is on. A key that carries another offered provider's
 * prefix gets the offer to switch, as soon as the prefix is there. Anything else
 * `keyRefusal` would say waits for a whole key: "Cerebras keys start with csk-" under
 * the first letter typed would be nagging.
 */
export function keyNote(provider: string, key: string): KeyNote | null {
  if (!isProvider(provider)) return null;
  if (keyIsWrapped(key)) return { text: KEY_WRAPPED, switchTo: null };
  const other = mismatchedProvider(key, provider);
  if (other) return { text: `This looks like ${withArticle(other)} key.`, switchTo: other };
  if (key.trim().length < KEY_MIN) return null;
  if (!keyFitsHeader(key.trim())) return { text: KEY_UNSENDABLE, switchTo: null };
  const problem = keyProblem(provider, key.trim());
  return problem ? { text: problem, switchTo: null } : null;
}

/**
 * A refusal that came back from the server, made fit to put under the key field.
 *
 * The server writes these sentences itself and scrubs what a provider said before it
 * passes any of it on. This is the last look before the words reach the screen, made by
 * the one place that still holds the key as it was typed: the key itself is taken out
 * wherever it appears, whatever its shape, and then anything shaped like a credential.
 * The field is a password box; an error that spelled its contents out would undo that.
 */
export function shownKeyError(message: string, key: string): string {
  const exact = key.trim();
  // Only for something long enough to have been sent as a key: the forms send nothing
  // shorter, and taking a few stray characters out would shred the sentence.
  const withoutKey = exact.length >= KEY_MIN ? message.split(exact).join(REDACTED) : message;
  return redactSecrets(withoutKey);
}

// ------------------------------------------------------------------- wording

/** How many providers a sentence names before it counts the rest. */
const NAMED = 5;

/**
 * The providers, as the end of a sentence: "Anthropic, OpenAI or OpenRouter" while there
 * are few, and the first five then "or one of 14 others" once there are many. Written
 * from the registry so the onboarding copy cannot fall behind the chooser.
 */
export function providerNames(ids: readonly CatalogueId[] = PROVIDER_ORDER): string {
  const labels = ids.map((id) => CATALOGUE[id].label);
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length <= NAMED) return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
  const rest = labels.length - NAMED;
  return `${labels.slice(0, NAMED).join(", ")} or ${rest === 1 ? "one other" : `one of ${rest} others`}`;
}

/**
 * What to say under the temperature slider when the agent's provider will not be sent
 * the setting as it stands, or null when it is. The run decides this with the same
 * function (`requestTemperature`), so the form cannot promise a setting the run drops.
 */
export function temperatureNote(provider: string, configured: number, model?: string | null): string | null {
  const row = rowOf(provider);
  if (!row) return null;
  const sent = requestTemperature(row.id, configured, model);
  if (sent === undefined) {
    return row.temperature === "omit"
      ? `Tocker sends no temperature to ${row.label}, so this setting has no effect there.`
      : `This model sets its own temperature, so Tocker sends none and this setting has no effect.`;
  }
  return sent < configured ? `${row.label} accepts ${sent} at most, so a higher setting is sent as ${sent}.` : null;
}
