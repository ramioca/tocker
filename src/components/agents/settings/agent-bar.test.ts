/**
 * The agent bar, rendered to markup, for what it says about a saved agent and which of
 * its buttons can be pressed. Two of these were wrong on the page it replaces: a draft's
 * only button was disabled, so "Activate" led nowhere, and an agent that failed every
 * tick for want of a key still read as scheduled.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentConfig } from "@/db/schema";
import type { AgentDetail, WalletBalance } from "@/server/types";

// The Fund sheet signs transfers and the balance is a query; the bar only needs the
// sheet's trigger and the wallets it was given.
vi.mock("./fund-agent-drawer", () => ({ FundAgentDrawer: ({ trigger }: { trigger: ReactNode }) => trigger }));
vi.mock("./wallets-card", () => ({
  useWalletBalances: (_agentId: string, initial?: WalletBalance[]) => ({ data: initial }),
}));

const { AgentBar, cashInWalletsText, cashText } = await import("./agent-bar");

function agentOf(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    id: "agent_1",
    slug: "aileen",
    name: "Aileen",
    avatarSeed: null,
    mode: "paper",
    status: "active",
    chains: ["solana"],
    llmKeyId: "key_1",
    nextRunAt: "2026-10-08T12:00:00.000Z",
    ...overrides,
  } as AgentDetail;
}

function configOf(intervalMinutes = 60, source?: "key" | "usdc"): AgentConfig {
  return { llm: { provider: "openrouter", model: "m", source }, schedule: { intervalMinutes } } as AgentConfig;
}

function walletOf(usdc: number, overrides: Partial<WalletBalance> = {}): WalletBalance {
  return {
    chain: "solana",
    address: "So1",
    walletId: "w_1",
    balances: [{ asset: "usdc", amount: usdc, usd: usdc }],
    ...overrides,
  };
}

function render(
  props: {
    agent?: AgentDetail;
    config?: AgentConfig;
    balances?: WalletBalance[];
    accountPaused?: boolean;
    statusPending?: boolean;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(AgentBar, {
      agent: props.agent ?? agentOf(),
      config: props.config ?? configOf(),
      initialBalances: props.balances ?? [walletOf(20)],
      accountPaused: props.accountPaused ?? false,
      statusPending: props.statusPending ?? false,
      onToggleStatus: () => {},
      onWithdraw: () => {},
      onChooseKey: () => {},
    }),
  );
}

/** The text a reader sees, tags dropped. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, "");
/** The attribute, as React writes it. Not the `disabled:` in a button's class names. */
const DISABLED = / disabled=""/;
/** The opening tag of the status button, and what it holds. */
function statusButton(html: string): { tag: string; label: string } {
  const match = /<button[^>]*id="agent-status-toggle"[^>]*>([\s\S]*?)<\/button>/.exec(html);
  if (!match) throw new Error("no status button");
  return { tag: match[0].slice(0, match[0].indexOf(">") + 1), label: textOf(match[1]) };
}
/** The opening tag of the button with this label. */
function buttonTag(html: string, label: string): string {
  const match = new RegExp(`<button[^>]*>(?:<svg[\\s\\S]*?</svg>)?${label}</button>`).exec(html);
  if (!match) throw new Error(`no ${label} button`);
  return match[0].slice(0, match[0].indexOf(">") + 1);
}

describe("the agent bar's sentence", () => {
  it("says the saved schedule and whether a tick is booked", () => {
    expect(textOf(render())).toContain("Runs every 1h · next tick scheduled");
    expect(textOf(render({ agent: agentOf({ nextRunAt: null }) }))).toContain("Runs every 1h · next tick unscheduled");
  });

  it("says a manual schedule in its own words", () => {
    const text = textOf(render({ agent: agentOf({ nextRunAt: null }), config: configOf(0) }));
    expect(text).toContain("Manual runs only");
    expect(text).not.toContain("next tick");
  });

  it("says an active agent with no key fails every tick, and offers the way to fix it", () => {
    const html = render({ agent: agentOf({ llmKeyId: null }) });
    expect(textOf(html)).toContain("Every tick fails: no API key attached. Choose a key");
    expect(html).toMatch(/<button[^>]*>Choose a key<\/button>/);
    expect(textOf(html)).not.toContain("next tick");
  });

  it("does not ask a pay-per-use agent for a key", () => {
    const text = textOf(render({ agent: agentOf({ llmKeyId: null }), config: configOf(60, "usdc") }));
    expect(text).toContain("Runs every 1h · next tick scheduled");
    expect(text).not.toContain("Every tick fails");
  });

  it("puts an account-wide pause before anything else about an active agent", () => {
    const html = render({ agent: agentOf({ llmKeyId: null }), accountPaused: true });
    expect(textOf(html)).toContain("Paused account-wide. Resume trading in Security.");
    expect(html).toMatch(/<a[^>]*href="\/settings\/security#kill-switch"[^>]*>Resume trading<\/a>/);
    expect(textOf(html)).not.toContain("Every tick fails");
  });

  it("says what a paused agent and a draft are", () => {
    expect(textOf(render({ agent: agentOf({ status: "paused" }) }))).toContain(
      "Paused. It keeps its positions and history.",
    );
    expect(textOf(render({ agent: agentOf({ status: "draft", nextRunAt: null }) }))).toContain(
      "Never started. Activate it to put it on its schedule.",
    );
  });

  it("does not call an agent that a run stopped paused", () => {
    const text = textOf(render({ agent: agentOf({ status: "error", nextRunAt: null }) }));
    expect(text).toContain("Stopped. It keeps its positions and history.");
    expect(text).not.toContain("Paused.");
  });

  it("reads the saved config, whatever the page is editing", () => {
    // The bar is handed the saved config and nothing else, so a schedule being edited
    // cannot show here before it is saved.
    expect(textOf(render({ config: configOf(240) }))).toContain("Runs every 4h · next tick scheduled");
  });
});

describe("the agent bar's status button", () => {
  it("reads Pause, Resume or Activate", () => {
    expect(statusButton(render()).label).toBe("Pause");
    expect(statusButton(render({ agent: agentOf({ status: "paused" }) })).label).toBe("Resume");
    expect(statusButton(render({ agent: agentOf({ status: "draft" }) })).label).toBe("Activate");
  });

  it("is never disabled, so a link that names it can always put the focus there", () => {
    for (const status of ["active", "paused", "draft"] as const) {
      for (const statusPending of [false, true]) {
        const { tag } = statusButton(render({ agent: agentOf({ status }), statusPending }));
        expect(tag, `${status} ${statusPending}`).not.toMatch(DISABLED);
      }
    }
  });

  it("says a change is on its way", () => {
    expect(statusButton(render({ statusPending: true })).tag).toContain('aria-busy="true"');
    expect(statusButton(render()).tag).not.toContain("aria-busy");
  });
});

describe("the agent bar's money", () => {
  it("shows the USDC on the chains the agent trades", () => {
    const html = render({ balances: [walletOf(20), walletOf(7, { chain: "base", walletId: "w_2" })] });
    expect(textOf(html)).toContain("$20.00 USDC");
    expect(cashText({ usdc: 20, unread: false })).toBe("$20.00 USDC");
  });

  it("never prints a balance for a wallet nobody could read, and leaves Withdraw reachable", () => {
    const html = render({ balances: [walletOf(0, { readFailed: true })] });
    expect(textOf(html)).toContain("Balance unavailable");
    expect(textOf(html)).not.toContain("$0.00");
    expect(buttonTag(html, "Withdraw")).not.toMatch(DISABLED);
    expect(cashText({ usdc: 0, unread: true })).toBe("Balance unavailable");
  });

  it("says where the money sits on a line with no label, and never for a wallet nobody could read", () => {
    expect(cashInWalletsText({ usdc: 20, unread: false })).toBe("$20.00 USDC in its wallets");
    expect(cashInWalletsText({ usdc: 0, unread: true })).toBe("Balance unavailable");
  });

  it("counts only the chains the agent trades on", () => {
    // A wallet on a chain it no longer trades is neither its balance nor a reason to call it unreadable.
    const html = render({
      balances: [walletOf(20), walletOf(0, { chain: "base", walletId: "w_2", readFailed: true })],
    });
    expect(textOf(html)).toContain("$20.00 USDC");
    expect(textOf(html)).not.toContain("Balance unavailable");
  });

  it("offers Withdraw only when there is something to take", () => {
    expect(buttonTag(render({ balances: [walletOf(0)] }), "Withdraw")).toMatch(DISABLED);
    expect(buttonTag(render({ balances: [walletOf(20)] }), "Withdraw")).not.toMatch(DISABLED);
  });

  it("links to the live checklist in the agent page's words", () => {
    const paper = render();
    expect(paper).toMatch(/<a[^>]*href="\/agents\/aileen\/live"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Go live<\/a>/);
    const live = render({ agent: agentOf({ mode: "live" }) });
    expect(live).toMatch(/<a[^>]*href="\/agents\/aileen\/live"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Live tick<\/a>/);
  });
});

describe("the agent bar's identity", () => {
  it("is the page's one h1, named for a screen reader as the agent's settings", () => {
    const html = render();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "")).toBe("Aileen settings");
  });

  it("cuts the hidden word off with a long name, so it cannot widen the page", () => {
    // The word is positioned out of the flow, where the name's text ends. Only a heading
    // that is its positioning parent clips it; without that a long name on a phone put it
    // past the right edge and the whole page scrolled sideways.
    const classes = (/<h1 class="([^"]*)"/.exec(render())?.[1] ?? "").split(" ");
    expect(classes).toContain("relative");
    expect(classes).toContain("truncate");
  });

  it("links back to the agent", () => {
    expect(render()).toMatch(/<a[^>]*aria-label="Back to Aileen"[^>]*href="\/agents\/aileen"|<a[^>]*href="\/agents\/aileen"[^>]*aria-label="Back to Aileen"/);
  });
});
