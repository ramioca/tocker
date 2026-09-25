import "server-only";
import type { LlmProvider } from "./models";

/**
 * One free, authenticated request that says whether a provider recognises an LLM key,
 * made before the key is saved.
 *
 * Without it the key form said "Added" for any 16 characters, and a typo'd or revoked
 * key only surfaced as a "Failed runs" notification after an agent woke up with it.
 * Each probe is a read that costs nothing: a model list, or OpenRouter's key endpoint.
 *
 * Three answers, and only one of them blocks:
 *
 * - `ok` — the provider accepted the key.
 * - `rejected` — the provider said this key is not a key (401). The caller refuses it.
 * - `unreachable` — we could not tell: a timeout, a network error, a 5xx, a rate limit,
 *   or a refusal that is about where the request came from rather than the key. The
 *   caller saves the key and says it could not check. Blocking a valid key because a
 *   provider was down would be worse than the failed run this exists to prevent.
 *
 * Never throws, and never logs or returns the key.
 */

export type KeyProbe = "ok" | "rejected" | "unreachable";

const TIMEOUT_MS = 5_000;

function request(provider: LlmProvider, key: string, workspaceId: string | null): { url: string; headers: HeadersInit } {
  switch (provider) {
    case "anthropic":
      // The same free call `needsWorkspaceHeader` makes, with the workspace when the key
      // is organization-level and one is known.
      return {
        url: "https://api.anthropic.com/v1/models?limit=1",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
        },
      };
    case "openai":
      return { url: "https://api.openai.com/v1/models", headers: { authorization: `Bearer ${key}` } };
    case "openrouter":
      return { url: "https://openrouter.ai/api/v1/key", headers: { authorization: `Bearer ${key}` } };
  }
}

/**
 * Pure: what a probe's response means for the key.
 *
 * Only 401 is a verdict on the key itself. A 403 is not: OpenAI answers 403 to a
 * request from an unsupported region and Anthropic to a real key without a permission,
 * and refusing every key because of where Tocker runs would lock everyone out. OpenAI
 * also answers 401 to a real restricted key that lacks the scope to list models; that
 * key authenticated, so it is not a typo.
 */
export function probeOutcome(status: number, errorMessage = ""): KeyProbe {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) {
    return /insufficient permissions|missing scopes?/i.test(errorMessage) ? "ok" : "rejected";
  }
  return "unreachable";
}

export async function probeLlmKey(provider: LlmProvider, key: string, workspaceId?: string | null): Promise<KeyProbe> {
  try {
    const { url, headers } = request(provider, key, workspaceId ?? null);
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    let message = "";
    if (res.status === 401) {
      try {
        const body = (await res.json()) as { error?: { message?: unknown } } | null;
        if (typeof body?.error?.message === "string") message = body.error.message;
      } catch {
        // No JSON body: a bare 401 is still a rejection.
      }
    }
    return probeOutcome(res.status, message);
  } catch {
    return "unreachable";
  }
}
