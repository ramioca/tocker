/**
 * Anthropic multi-workspace keys (W7).
 *
 * A key created for a person or a service account rather than inside a workspace is
 * "not scoped to a workspace": every request from it must carry
 * `anthropic-workspace-id`, or the API answers 400 with a sentence naming that header.
 * Such a key may also call the Admin API, so the app can find a workspace itself rather
 * than send the operator to the Console to copy an id:
 *
 *   1. `GET /v1/organizations/workspaces` lists the organization's workspaces — except
 *      the Default Workspace, which every organization has and which List omits.
 *   2. `GET /v1/organizations/api_keys` reports each key's `scope.workspace_id` with the
 *      Default Workspace's real id, so any id there that List did not return is the
 *      Default; `GET /v1/organizations/workspaces/{id}` confirms it.
 *   3. `GET /v1/models` with the header proves the key may act in the candidate
 *      (404 when it may not).
 *
 * A key created inside a workspace is refused by the Admin API; that refusal is the
 * signal that no header is needed. Nothing here throws: a failed lookup means "send no
 * header", which is right for a scoped key and no worse than before for the other kind.
 *
 * Every function here is handed a plaintext key, so none of it may reach a client
 * bundle, and none of it logs, returns or keeps the key. Every request goes through
 * `providerFetch`, which sends it to Anthropic's own origin and nowhere else, and does
 * not follow a redirect: `x-api-key` is a header `fetch` would carry across one.
 */
import "server-only";
import { providerFetch, withoutKey } from "./providers-keys";

const API_VERSION = "2023-06-01";
const TIMEOUT_MS = 10_000;
/**
 * Anthropic's own shape for a workspace id. An id read from one of its answers is put
 * into the path of the next request and saved beside the key, so it is held to this
 * shape first: letters and digits after the prefix, and nothing that could be a path.
 */
const WORKSPACE_ID = /^wrkspc_[A-Za-z0-9]{1,72}$/;

export interface AnthropicWorkspace {
  id: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
}

export type WorkspaceDiscovery =
  | { kind: "found"; workspaceId: string; name: string }
  /** The Admin API refused the key: it is bound to one workspace and needs no header. */
  | { kind: "scoped" }
  | { kind: "unknown"; reason: string };

/** The API's own sentence for a multi-workspace key sent without the header. */
export function isWorkspaceScopeError(message: string): boolean {
  return /anthropic-workspace-id/i.test(message);
}

/**
 * Pure: the order in which to try workspaces. The Default Workspace (never in the list,
 * found through api_keys) first — it is where a Console-made key would have landed.
 * Then anything the organization named "Default", then its own workspaces oldest first,
 * and only last the auto-created Claude Code workspace, which exists for Claude Code's
 * own traffic and is rate-limited apart.
 */
export function orderCandidates(
  listed: readonly AnthropicWorkspace[],
  unlisted: readonly AnthropicWorkspace[],
): AnthropicWorkspace[] {
  const live = (ws: readonly AnthropicWorkspace[]) => ws.filter((w) => w.archivedAt === null && WORKSPACE_ID.test(w.id));
  const byAge = (a: AnthropicWorkspace, b: AnthropicWorkspace) => a.createdAt.localeCompare(b.createdAt);
  const rest = live(listed).sort(byAge);
  const named = rest.filter((w) => /default/i.test(w.name));
  const own = rest.filter((w) => !/default/i.test(w.name) && !/claude code/i.test(w.name));
  const claudeCode = rest.filter((w) => !/default/i.test(w.name) && /claude code/i.test(w.name));
  const seen = new Set<string>();
  return [...live(unlisted).sort(byAge), ...named, ...own, ...claudeCode].filter((w) => {
    if (seen.has(w.id)) return false;
    seen.add(w.id);
    return true;
  });
}

function parseWorkspace(raw: unknown): AnthropicWorkspace | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    name: typeof r.name === "string" ? r.name : "",
    archivedAt: typeof r.archived_at === "string" ? r.archived_at : null,
    createdAt: typeof r.created_at === "string" ? r.created_at : "",
  };
}

function parseWorkspaces(body: unknown): AnthropicWorkspace[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data.map(parseWorkspace).filter((w): w is AnthropicWorkspace => w !== null);
}

/** Workspace ids named by API keys' `scope`, the only place the Default's id shows up. */
export function workspaceIdsFromApiKeys(body: unknown): string[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const ids = new Set<string>();
  for (const raw of data) {
    const scope = (raw as { scope?: { type?: unknown; workspace_id?: unknown } } | null)?.scope;
    if (scope?.type === "workspace" && typeof scope.workspace_id === "string" && WORKSPACE_ID.test(scope.workspace_id)) {
      ids.add(scope.workspace_id);
    }
  }
  return [...ids];
}

async function get(
  apiKey: string,
  path: string,
  extra: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await providerFetch("anthropic", path, {
    headers: { "x-api-key": apiKey, "anthropic-version": API_VERSION, accept: "application/json", ...extra },
    timeoutMs: TIMEOUT_MS,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function errorMessage(body: unknown): string {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" ? message : "";
}

/**
 * Whether the key needs `anthropic-workspace-id`: a free request with no header.
 * `null` when the answer is something else (bad key, network) — the real call will say.
 */
export async function needsWorkspaceHeader(apiKey: string): Promise<boolean | null> {
  try {
    const { status, body } = await get(apiKey, "/v1/models?limit=1");
    if (status === 200) return false;
    if (status === 400 && isWorkspaceScopeError(errorMessage(body))) return true;
    return null;
  } catch {
    return null;
  }
}

async function canActIn(apiKey: string, workspaceId: string): Promise<boolean> {
  try {
    const { status } = await get(apiKey, "/v1/models?limit=1", { "anthropic-workspace-id": workspaceId });
    return status === 200;
  } catch {
    return false;
  }
}

/**
 * The workspace a multi-workspace key should act in. Never throws; every failure is a
 * `kind`, and the caller decides whether to insist.
 */
export async function discoverAnthropicWorkspace(apiKey: string): Promise<WorkspaceDiscovery> {
  let listed: AnthropicWorkspace[];
  try {
    const list = await get(apiKey, "/v1/organizations/workspaces?limit=100");
    if (list.status === 401 || list.status === 403) return { kind: "scoped" };
    if (list.status !== 200) return { kind: "unknown", reason: `list workspaces answered ${list.status}` };
    listed = parseWorkspaces(list.body);
  } catch (err) {
    // The reason is for a log. It is a network error's own text, so the key is taken
    // out of it by value and by shape before it leaves.
    const reason = err instanceof Error ? err.message : "list workspaces failed";
    return { kind: "unknown", reason: withoutKey(apiKey)(reason) };
  }

  // The Default Workspace: named only by keys that live in it.
  const unlisted: AnthropicWorkspace[] = [];
  try {
    const keys = await get(apiKey, "/v1/organizations/api_keys?limit=1000");
    if (keys.status === 200) {
      const known = new Set(listed.map((w) => w.id));
      const extra = workspaceIdsFromApiKeys(keys.body).filter((id) => !known.has(id)).slice(0, 5);
      for (const id of extra) {
        const one = await get(apiKey, `/v1/organizations/workspaces/${id}`);
        const ws = one.status === 200 ? parseWorkspace(one.body) : null;
        if (ws) unlisted.push(ws);
      }
    }
  } catch {
    // Optional step: the listed workspaces are still candidates.
  }

  const candidates = orderCandidates(listed, unlisted);
  for (const candidate of candidates) {
    if (await canActIn(apiKey, candidate.id)) {
      return { kind: "found", workspaceId: candidate.id, name: candidate.name || candidate.id };
    }
  }
  return {
    kind: "unknown",
    reason:
      candidates.length === 0
        ? "the key can see no workspace (an organization with only its Default Workspace and no key created inside it)"
        : "the key may act in none of the workspaces it can see",
  };
}
