/**
 * OpenRouter's model list, for the picker.
 *
 * OpenRouter carries hundreds of models and adds some every week, so a list kept by hand
 * is wrong within days: it was offering one id that no longer existed and one model
 * that cannot call tools. Their catalogue is public and needs no key, so the picker
 * reads it, through this module and the route beside it, never from the browser.
 *
 * Only models an agent can actually run on are kept: text out, tool calling supported
 * (a run is nothing but tool calls), and not a `:batch` variant, which answers hours
 * later. `:free` variants stay.
 */
import { DEFAULT_MODELS, isModelId, type ModelOption } from "./models";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** How long one fetched list is served for. */
const TTL_MS = 60 * 60_000;
/** How long the fetch may take before the fallback is used instead. */
const FETCH_TIMEOUT_MS = 8_000;
/** A ceiling on what is passed to the browser, far above the real catalogue. */
const MAX_MODELS = 1_000;

function perMillion(raw: unknown): number | undefined {
  const perToken = typeof raw === "string" || typeof raw === "number" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(perToken) || perToken < 0) return undefined;
  // Six significant digits: 0.000002 × 1e6 is 2, not 2.0000000000000004.
  return Number((perToken * 1_000_000).toPrecision(6));
}

/**
 * Pure: OpenRouter's response body → the rows the picker shows, newest first. Anything
 * that does not look like a model an agent could run is dropped, and nothing in the
 * body is trusted to be the shape it should be.
 */
export function parseOpenRouterModels(body: unknown): ModelOption[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];

  const rows: Array<ModelOption & { created: number }> = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const model = entry as Record<string, unknown>;
    const id = model.id;
    if (typeof id !== "string" || !isModelId(id) || id.endsWith(":batch")) continue;

    const supported = model.supported_parameters;
    if (!Array.isArray(supported) || !supported.includes("tools")) continue;

    const output = (model.architecture as { output_modalities?: unknown } | undefined)?.output_modalities;
    if (Array.isArray(output) && !(output.length === 1 && output[0] === "text")) continue;

    const name = typeof model.name === "string" && model.name.trim() ? model.name.trim().slice(0, 80) : id;
    const pricing = (model.pricing ?? {}) as Record<string, unknown>;
    const inputPerMTok = perMillion(pricing.prompt);
    const outputPerMTok = perMillion(pricing.completion);
    rows.push({
      id,
      label: name,
      ...(inputPerMTok !== undefined && outputPerMTok !== undefined ? { inputPerMTok, outputPerMTok } : {}),
      created: typeof model.created === "number" && Number.isFinite(model.created) ? model.created : 0,
    });
  }

  rows.sort((a, b) => b.created - a.created);
  return rows.slice(0, MAX_MODELS).map((row) => {
    const { created, ...option } = row;
    void created;
    return option;
  });
}

export interface OpenRouterCatalog {
  models: ModelOption[];
  /** False when OpenRouter could not be reached and this is the short built-in list. */
  live: boolean;
}

let cached: { at: number; models: ModelOption[] } | null = null;

/**
 * The catalogue, fetched at most once an hour per server instance. Never throws: when
 * OpenRouter cannot be reached the last good list is served, and failing that the short
 * built-in one, with `live: false` so the picker can say so. Any id can still be typed.
 */
export async function getOpenRouterCatalog(now: number = Date.now()): Promise<OpenRouterCatalog> {
  if (cached && now - cached.at < TTL_MS) return { models: cached.models, live: true };
  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`OpenRouter answered ${res.status}`);
    const models = parseOpenRouterModels(await res.json());
    if (models.length === 0) throw new Error("OpenRouter returned no usable models");
    cached = { at: now, models };
    return { models, live: true };
  } catch (err) {
    console.warn("[models] OpenRouter catalogue unavailable:", err instanceof Error ? err.message : err);
    if (cached) return { models: cached.models, live: true };
    return { models: DEFAULT_MODELS.openrouter, live: false };
  }
}

/** Test seam: forget the fetched list. */
export function resetOpenRouterCatalog(): void {
  cached = null;
}
