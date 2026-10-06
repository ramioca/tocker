import "server-only";
import { isModelId, knownModel, type LlmProvider, type ModelOption } from "./models";

/**
 * The models a key can use, asked of the provider that issued it.
 *
 * The built-in lists (`models.ts`) are edited by hand and a provider ships a model faster
 * than that happens. Anthropic and OpenAI both answer "which models may this key call?"
 * for free, so the picker asks them, through the owner's own saved key.
 *
 * This is the second place a stored key is used, after the run loop. The caller decrypts
 * it for this one request; nothing here logs, returns or keeps the key, and what comes
 * back is model ids and names only. OpenRouter is not asked by key: its catalogue is
 * public (`openrouter-catalog.ts`).
 *
 * Never throws. `rejected` means the provider refused the key itself; `unreachable`
 * covers everything else (a timeout, a 5xx, a restricted key that may not list models),
 * and the picker falls back to the built-in list either way.
 */

export type KeyModels = { ok: true; models: ModelOption[] } | { ok: false; reason: "rejected" | "unreachable" };

const TIMEOUT_MS = 8_000;
/** Pages of Anthropic's list to follow. One page of 1,000 has always been all of it. */
const MAX_PAGES = 3;
const MAX_MODELS = 500;

/** A listed model, with the price the built-in catalogue has for it when it has one. */
function option(id: string, name: string | null): ModelOption {
  const known = knownModel(id);
  return {
    id,
    label: name ?? known?.label ?? id,
    ...(known?.inputPerMTok !== undefined && known.outputPerMTok !== undefined
      ? { inputPerMTok: known.inputPerMTok, outputPerMTok: known.outputPerMTok }
      : {}),
  };
}

/**
 * Pure: one page of Anthropic's `GET /v1/models` → picker rows, in the order given
 * (newest first). Anything that is not a model with a usable id is dropped.
 */
export function parseAnthropicModels(body: unknown): { models: ModelOption[]; nextAfterId: string | null } {
  const page = body as { data?: unknown; has_more?: unknown; last_id?: unknown } | null;
  const data = Array.isArray(page?.data) ? page.data : [];
  const models: ModelOption[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const model = entry as Record<string, unknown>;
    if (typeof model.id !== "string" || !isModelId(model.id)) continue;
    const name = typeof model.display_name === "string" && model.display_name.trim() ? model.display_name.trim().slice(0, 80) : null;
    models.push(option(model.id, name));
  }
  const nextAfterId = page?.has_more === true && typeof page.last_id === "string" && page.last_id ? page.last_id : null;
  return { models, nextAfterId };
}

/**
 * What OpenAI lists that an agent cannot think on: its list is every model the key can
 * call, with nothing that says what each is for, so the kinds are told apart by name.
 */
const NOT_A_CHAT_MODEL =
  /embedding|whisper|tts|transcribe|dall-e|image|sora|moderation|realtime|audio|search|instruct|davinci|babbage|computer-use/i;
/** The families that take a chat with tools: GPT, the o-series, and fine-tunes of them. */
const CHAT_MODEL = /^(gpt-|o\d|chatgpt-|ft:(gpt-|o\d))/i;

/** Pure: OpenAI's `GET /v1/models` → picker rows for the chat models, newest first. */
export function parseOpenAiModels(body: unknown): ModelOption[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const rows: Array<{ id: string; created: number }> = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const model = entry as Record<string, unknown>;
    if (typeof model.id !== "string" || !isModelId(model.id)) continue;
    if (!CHAT_MODEL.test(model.id) || NOT_A_CHAT_MODEL.test(model.id)) continue;
    rows.push({ id: model.id, created: typeof model.created === "number" && Number.isFinite(model.created) ? model.created : 0 });
  }
  rows.sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
  return rows.slice(0, MAX_MODELS).map((row) => option(row.id, null));
}

async function get(url: string, headers: HeadersInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON: the status alone decides.
  }
  return { status: res.status, body };
}

/** Only a 401 is the provider saying the key is not a key (see `probeOutcome`). */
function refusal(status: number): { ok: false; reason: "rejected" | "unreachable" } {
  return { ok: false, reason: status === 401 ? "rejected" : "unreachable" };
}

export async function listModelsForKey(
  provider: Exclude<LlmProvider, "openrouter">,
  key: string,
  workspaceId?: string | null,
): Promise<KeyModels> {
  try {
    if (provider === "openai") {
      const { status, body } = await get("https://api.openai.com/v1/models", { authorization: `Bearer ${key}` });
      if (status < 200 || status >= 300) return refusal(status);
      const models = parseOpenAiModels(body);
      return models.length > 0 ? { ok: true, models } : { ok: false, reason: "unreachable" };
    }

    // The same headers the key probe sends, with the workspace when the key is
    // organization-level and one is known.
    const headers = {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
    };
    const models: ModelOption[] = [];
    let afterId: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = `https://api.anthropic.com/v1/models?limit=1000${afterId ? `&after_id=${encodeURIComponent(afterId)}` : ""}`;
      const { status, body } = await get(url, headers);
      if (status < 200 || status >= 300) return refusal(status);
      const parsed = parseAnthropicModels(body);
      models.push(...parsed.models);
      afterId = parsed.nextAfterId;
      if (!afterId) break;
    }
    return models.length > 0 ? { ok: true, models: models.slice(0, MAX_MODELS) } : { ok: false, reason: "unreachable" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
