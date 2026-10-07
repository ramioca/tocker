import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverAnthropicWorkspace,
  isWorkspaceScopeError,
  needsWorkspaceHeader,
  orderCandidates,
  workspaceIdsFromApiKeys,
} from "./anthropic-workspace";

const ws = (id: string, name: string, createdAt: string, archivedAt: string | null = null) => ({
  id,
  name,
  createdAt,
  archivedAt,
});

describe("orderCandidates", () => {
  it("puts the unlisted Default Workspace first, then named defaults, then own workspaces by age, then Claude Code", () => {
    const order = orderCandidates(
      [
        ws("wrkspc_cc", "Claude Code", "2024-01-01T00:00:00Z"),
        ws("wrkspc_new", "Prod", "2026-01-01T00:00:00Z"),
        ws("wrkspc_old", "Team", "2025-01-01T00:00:00Z"),
        ws("wrkspc_named", "Default Workspace", "2025-06-01T00:00:00Z"),
      ],
      [ws("wrkspc_default", "Default", "2023-01-01T00:00:00Z")],
    ).map((w) => w.id);
    expect(order).toEqual(["wrkspc_default", "wrkspc_named", "wrkspc_old", "wrkspc_new", "wrkspc_cc"]);
  });

  it("drops archived workspaces, malformed ids and duplicates", () => {
    const order = orderCandidates(
      [ws("wrkspc_gone", "Team", "2024-01-01T00:00:00Z", "2025-01-01T00:00:00Z"), ws("nope", "Team", "2024-01-01T00:00:00Z")],
      [ws("wrkspc_a", "Default", "2023-01-01T00:00:00Z"), ws("wrkspc_a", "Default", "2023-01-01T00:00:00Z")],
    ).map((w) => w.id);
    expect(order).toEqual(["wrkspc_a"]);
  });
});

describe("workspaceIdsFromApiKeys", () => {
  /** An id from this answer becomes part of the next request's path, and is saved beside the key. */
  it("takes only what has the shape of a workspace id, never something that could be a path", () => {
    expect(
      workspaceIdsFromApiKeys({
        data: [
          { scope: { type: "workspace", workspace_id: "wrkspc_01AbCdEf" } },
          { scope: { type: "workspace", workspace_id: "wrkspc_../../v1/messages" } },
          { scope: { type: "workspace", workspace_id: "wrkspc_a/b" } },
          { scope: { type: "workspace", workspace_id: "wrkspc_a?x=1" } },
          { scope: { type: "workspace", workspace_id: "wrkspc_" } },
          { scope: { type: "workspace", workspace_id: `wrkspc_${"a".repeat(200)}` } },
        ],
      }),
    ).toEqual(["wrkspc_01AbCdEf"]);
  });

  it("reads scope.workspace_id and ignores organization-scoped keys", () => {
    expect(
      workspaceIdsFromApiKeys({
        data: [
          { scope: { type: "workspace", workspace_id: "wrkspc_1" } },
          { scope: { type: "workspace", workspace_id: "wrkspc_1" } },
          { scope: { type: "organization" } },
          { scope: { type: "workspace", workspace_id: "bad" } },
          null,
        ],
      }),
    ).toEqual(["wrkspc_1"]);
  });
});

describe("isWorkspaceScopeError", () => {
  it("recognises both phrasings Anthropic has used", () => {
    expect(
      isWorkspaceScopeError(
        "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.",
      ),
    ).toBe(true);
    expect(isWorkspaceScopeError("anthropic-workspace-id is required when authenticating with an identity-linked API key")).toBe(true);
    expect(isWorkspaceScopeError("Your credit balance is too low to access the Anthropic API.")).toBe(false);
  });
});

/**
 * The requests themselves. `fetch` is a stand-in that answers by path, so each case can
 * say what Anthropic would have said and then read back everything that was sent.
 */
describe("the workspace lookup's requests", () => {
  // Put together here; nothing key-shaped is written out in this file.
  const KEY = `sk-ant-${"Ab1cD2eF3gH4".repeat(3)}`;
  type Sent = { url: string; headers: Record<string, string>; redirect: RequestRedirect | undefined };

  function anthropicAnswers(byPath: (path: string, headers: Record<string, string>) => { status: number; body?: unknown } | Error): Sent[] {
    const sent: Sent[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = { ...(init.headers as Record<string, string>) };
      sent.push({ url: String(input), headers, redirect: init.redirect });
      const url = new URL(String(input));
      const reply = byPath(url.pathname + url.search, headers);
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
    });
    return sent;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks whether a key needs a workspace with one request to Anthropic, which is never followed elsewhere", async () => {
    let sent = anthropicAnswers(() => ({ status: 200 }));
    expect(await needsWorkspaceHeader(KEY)).toBe(false);
    expect(sent).toEqual([
      {
        url: "https://api.anthropic.com/v1/models?limit=1",
        headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", accept: "application/json" },
        redirect: "error",
      },
    ]);

    sent = anthropicAnswers(() => ({
      status: 400,
      body: { error: { message: "This request must include the anthropic-workspace-id header with the ID of the workspace to use." } },
    }));
    expect(await needsWorkspaceHeader(KEY)).toBe(true);

    for (const reply of [{ status: 401 }, { status: 400, body: { error: { message: "something else" } } }, { status: 503 }, new TypeError("fetch failed")]) {
      anthropicAnswers(() => reply);
      expect(await needsWorkspaceHeader(KEY)).toBeNull();
    }
  });

  it("finds the workspace with requests to Anthropic only, and never puts an odd id into a path", async () => {
    const sent = anthropicAnswers((path, headers) => {
      if (path.startsWith("/v1/organizations/workspaces?")) return { status: 200, body: { data: [] } };
      if (path.startsWith("/v1/organizations/api_keys")) {
        return {
          status: 200,
          body: {
            data: [
              { scope: { type: "workspace", workspace_id: "wrkspc_../../v1/messages" } },
              { scope: { type: "workspace", workspace_id: "wrkspc_default1" } },
            ],
          },
        };
      }
      if (path === "/v1/organizations/workspaces/wrkspc_default1") {
        return { status: 200, body: { id: "wrkspc_default1", name: "Default", archived_at: null, created_at: "2024-01-01T00:00:00Z" } };
      }
      if (path === "/v1/models?limit=1") return { status: headers["anthropic-workspace-id"] === "wrkspc_default1" ? 200 : 404 };
      return { status: 404 };
    });

    expect(await discoverAnthropicWorkspace(KEY)).toEqual({ kind: "found", workspaceId: "wrkspc_default1", name: "Default" });

    expect(sent.map((request) => new URL(request.url).pathname)).toEqual([
      "/v1/organizations/workspaces",
      "/v1/organizations/api_keys",
      "/v1/organizations/workspaces/wrkspc_default1",
      "/v1/models",
    ]);
    for (const request of sent) {
      expect(new URL(request.url).origin).toBe("https://api.anthropic.com");
      expect(request.redirect).toBe("error");
      expect(request.url).not.toContain(KEY);
    }
  });

  it("reads the Admin API's refusal as a key that lives in one workspace", async () => {
    for (const status of [401, 403]) {
      anthropicAnswers(() => ({ status }));
      expect(await discoverAnthropicWorkspace(KEY)).toEqual({ kind: "scoped" });
    }
  });

  /** The reason is logged by the caller. A network error can quote the request it failed on. */
  it("gives a reason with the key taken out of it when the lookup fails", async () => {
    anthropicAnswers(() => new Error(`request to api.anthropic.com failed with x-api-key ${KEY}`));
    const found = await discoverAnthropicWorkspace(KEY);
    expect(found.kind).toBe("unknown");
    expect(JSON.stringify(found)).not.toContain(KEY);
    expect(JSON.stringify(found)).not.toContain(KEY.slice(0, 20));
  });
});
