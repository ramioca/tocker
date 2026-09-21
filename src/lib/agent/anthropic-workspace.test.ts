import { describe, expect, it } from "vitest";
import { isWorkspaceScopeError, orderCandidates, workspaceIdsFromApiKeys } from "./anthropic-workspace";

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
