/**
 * An agent's settings page as it first arrives from the server: which step is open, what
 * the rail and the bar say about a saved agent, and what a visitor with no config is
 * shown. The steps are the builder's own, rendered for real; the cards on Manage and the
 * server actions are stand-ins. What pressing things does is the edit model's to test
 * (`edit-model.test.ts`): this is about what the page is made of.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentConfig } from "@/db/schema";
import type { AgentDetail, LlmKeyRow, WalletBalance } from "@/server/types";

const address = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(address.search),
  usePathname: () => "/agents/aileen/settings",
}));
// Nothing here calls a server action: a render never saves, pauses or deletes.
vi.mock("@/components/agents/agent-actions", () => ({
  updateAgentAction: vi.fn(),
  setAgentStatusAction: vi.fn(),
  deleteAgentAction: vi.fn(),
  addLlmKeyAction: vi.fn(),
}));
vi.mock("@/server/actions/security", () => ({ noteBudgetChangeAction: vi.fn() }));
vi.mock("@/server/actions/users", () => ({ listKeyModels: vi.fn() }));

/** A stand-in for one card: its name. */
function card(name: string) {
  return function Card() {
    return createElement("div", { "data-card": name });
  };
}
vi.mock("./universe-preview", () => ({ UniversePreview: card("universe-preview") }));
vi.mock("./fund-agent-drawer", () => ({ FundAgentDrawer: ({ trigger }: { trigger: ReactNode }) => trigger }));
vi.mock("./wallets-card", () => ({
  WalletsCard: card("wallets"),
  useWalletBalances: (_agentId: string, initial?: WalletBalance[]) => ({ data: initial }),
}));
vi.mock("./withdraw-form", () => ({ WithdrawForm: card("withdraw") }));
vi.mock("./go-live-card", () => ({ GoLiveCard: card("mode") }));
vi.mock("./budget-card", () => ({ BudgetCard: card("budget") }));
vi.mock("./danger-zone", () => ({ DangerZone: card("delete") }));

const { AgentSettings } = await import("./agent-settings");
const { UNSAVED_STEP_NAMES } = await import("./edit-model");
const { STEP_NAMES } = await import("@/components/agents/builder/step-registry");
const { SETTINGS_STEPS } = await import("@/components/agents/builder/contract");
const { defaultUsdc } = await import("@/components/agents/thinking");
const { DEFAULT_AGENT_CONFIG } = await import("@/lib/agent/config");
const { providerLabel } = await import("@/lib/agent/providers");

const CONFIG = DEFAULT_AGENT_CONFIG as AgentConfig;
const PROVIDER = CONFIG.llm.provider;
const KEY: LlmKeyRow = { id: "key_1", provider: PROVIDER, label: "Main", last4: "abcd", createdAt: "2026-01-01T00:00:00.000Z" };
const WALLET: WalletBalance = {
  chain: "solana",
  address: "So1",
  walletId: "w_1",
  balances: [{ asset: "usdc", amount: 20, usd: 20 }],
};

function agentOf(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    id: "agent_1",
    slug: "aileen",
    name: "Aileen",
    tagline: null,
    avatarSeed: null,
    isPublic: true,
    mode: "paper",
    status: "active",
    owner: { id: "user_1", handle: "you", displayName: null, avatarUrl: null },
    chains: ["solana"],
    equityUsd: 30,
    llmKeyId: "key_1",
    paperStartingUsd: 10_000,
    nextRunAt: "2026-10-08T12:00:00.000Z",
    positions: [],
    config: CONFIG,
    ...overrides,
  } as AgentDetail;
}

function render(
  search = "",
  props: { agent?: AgentDetail; config?: AgentConfig | null; keys?: LlmKeyRow[]; payPerUseAllowed?: boolean } = {},
): string {
  address.search = search;
  const agent = props.agent ?? agentOf();
  return renderToString(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(AgentSettings, {
        agent,
        config: props.config === undefined ? CONFIG : props.config,
        sources: [],
        llmKeys: props.keys ?? [KEY],
        balances: [WALLET],
        walletBudget: null,
        accountPaused: false,
        isAdmin: false,
        payPerUseAllowed: props.payPerUseAllowed ?? false,
        feeUsd: 0.25,
      }),
    ),
  );
}

/** The page as words: tags out, entities back, one space between everything. */
const words = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

/** The opening tag of a step's panel. */
function panel(html: string, step: string): string {
  const match = new RegExp(`<section[^>]*aria-labelledby="step-${step}-title"[^>]*>`).exec(html);
  if (!match) throw new Error(`no ${step} panel`);
  return match[0];
}

/** The opening tag of the Save button. */
function saveButton(html: string): string {
  const match = /<button[^>]*aria-label="Save changes"[^>]*>/.exec(html);
  if (!match) throw new Error("no Save button");
  return match[0];
}

describe("an agent's settings page", () => {
  it("is the builder's eight steps with Manage where Create was, every one of them mounted", () => {
    const html = render();
    for (const step of SETTINGS_STEPS) expect(html, step).toContain(`id="step-${step}-title"`);
    expect(html).not.toContain('id="step-create-title"');
    const text = words(html);
    expect(text).toContain("Its wallets, its money, its mode, and deleting it. Nothing here waits for Save.");
    // What only creating has.
    for (const gone of ["Create agent", "Skip to the end", "Still needed", "New agent", "Activate immediately"]) {
      expect(text, gone).not.toContain(gone);
    }
  });

  it("opens on the first step, and on the step the address names", () => {
    const first = render();
    expect(panel(first, "name")).not.toContain(' hidden=""');
    for (const step of SETTINGS_STEPS.slice(1)) expect(panel(first, step), step).toContain(' hidden=""');

    const limits = render("step=limits");
    expect(panel(limits, "limits")).not.toContain(' hidden=""');
    expect(panel(limits, "name")).toContain(' hidden=""');
    expect(words(limits)).toContain("Step 5 of 8");

    expect(panel(render("step=manage"), "manage")).not.toContain(' hidden=""');
    // The builder's last step is not one of this page's, and neither is anything made up.
    expect(panel(render("step=create"), "name")).not.toContain(' hidden=""');
    expect(panel(render("step=nonsense"), "name")).not.toContain(' hidden=""');
  });

  it("arrives with everything saved: no step is changed and there is nothing to save or discard", () => {
    const html = render("step=limits");
    const text = words(html);
    expect(text).toContain("Everything is saved");
    expect(text).not.toContain("Unsaved changes");
    expect(text).not.toContain("Discard");
    for (const name of ["Name", "Strategy", "Where it hunts", "Data it buys", "Risk limits", "Schedule & mode", "How it thinks", "Manage"]) {
      expect(text, name).toContain(`${name}: Saved`);
    }
    expect(text).not.toMatch(/: (Changed|Fix|Needed|Defaults|Edited|Ready)\b/);
    expect(saveButton(html)).toContain(' disabled=""');
  });

  it("has Save on every step, beside a Next that names where it goes", () => {
    for (const step of SETTINGS_STEPS) expect(saveButton(render(`step=${step}`)), step).toBeTruthy();
    const limits = render("step=limits");
    expect(limits).toContain('aria-label="Next: Schedule &amp; mode"');
    expect(limits).toContain('aria-label="Back"');
    expect(render("step=name")).not.toContain('aria-label="Back"');
    expect(render("step=manage")).not.toContain('aria-label="Next:');
  });

  it("has one heading for the page: the agent's name, in the bar above the steps", () => {
    const html = render();
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(words(html)).toContain("Aileen settings");
    // The bar spans the form and the card: it comes before the two columns.
    expect(html.indexOf("<h1")).toBeLessThan(html.indexOf("lg:grid-cols-[minmax(0,1fr)_360px]"));
    expect(html).toContain('id="agent-status-toggle"');
  });

  it("opens Manage on the wallets, with every section mounted", () => {
    const html = render("step=manage");
    for (const section of ["wallets", "withdraw", "live", "delete"]) {
      const tag = new RegExp(`<div[^>]*id="manage-${section}"[^>]*>`).exec(html)?.[0] ?? "";
      expect(tag, section).not.toBe("");
      if (section === "wallets") expect(tag).not.toContain(' hidden=""');
      else expect(tag, section).toContain(' hidden=""');
    }
    for (const name of ["wallets", "withdraw", "mode", "budget", "delete"]) {
      expect(html, name).toContain(`data-card="${name}"`);
    }
  });

  it("states on the card what is true of the agent now, not what a draft plans", () => {
    const paper = words(render());
    expect(paper).toContain("$20.00 USDC in its wallets · paper");
    expect(paper).not.toContain("starts active");
    expect(paper).not.toContain("starts paused");
    expect(paper).not.toContain("You sign");
    const live = words(render("", { agent: agentOf({ mode: "live" }) }));
    expect(live).toContain("$20.00 USDC in its wallets · live");
    expect(live).toContain("Live tick");
  });

  it("tells an agent with no usable key so, on Brain, on the rail and on the card", () => {
    const other = PROVIDER === "openrouter" ? "anthropic" : "openrouter";
    for (const [agent, keys] of [
      [agentOf({ llmKeyId: null }), [KEY]],
      [agentOf({ llmKeyId: "gone" }), [KEY]],
      [agentOf(), [{ ...KEY, provider: other }]],
    ] as Array<[AgentDetail, LlmKeyRow[]]>) {
      const text = words(render("step=brain", { agent, keys }));
      expect(text).toContain("No key attached: every run fails until one is chosen here.");
      expect(text).not.toContain("Using your");
      expect(text).toContain("How it thinks: Fix");
      expect(text).toContain(`Needs a${/^[aeiou]/i.test(providerLabel(PROVIDER)) ? "n" : ""} ${providerLabel(PROVIDER)} key`);
    }
    // Nothing else is marked for it, and the page still has nothing unsaved.
    const text = words(render("step=brain", { agent: agentOf({ llmKeyId: null }) }));
    expect(text).toContain("Risk limits: Saved");
    expect(text).toContain("Everything is saved");
    expect(text).toContain("Every tick fails: no API key attached.");
  });

  it("offers pay per use to an agent saved on it, whatever the account is allowed today", () => {
    const usdc = { ...CONFIG, llm: { ...CONFIG.llm, source: "usdc", usdc: defaultUsdc(CONFIG.schedule.intervalMinutes) } } as AgentConfig;
    const saved = render("step=brain", { agent: agentOf({ llmKeyId: null, config: usdc }), config: usdc });
    expect(saved).toContain('id="builder-think-usdc"');
    expect(words(saved)).toContain("Paying per run in USDC from the agent's own wallet. No key needed.");
    // A key agent on an account that may not use it is shown the key fields and nothing else.
    expect(render("step=brain")).not.toContain('id="builder-think-usdc"');
    expect(render("step=brain", { payPerUseAllowed: true })).toContain('id="builder-think-usdc"');
  });

  it("names a step in the sentence about what is unsaved as the button that leads to it does", () => {
    for (const step of SETTINGS_STEPS) {
      if (step === "manage") continue;
      expect(UNSAVED_STEP_NAMES[step], step).toBe(STEP_NAMES[step]);
    }
  });

  it("refuses to build anything without a config, which only the owner has", () => {
    const html = render("step=strategy", { agent: agentOf({ config: null }), config: null });
    expect(words(html)).toContain("This agent's settings are not yours to see");
    expect(html).not.toContain('id="step-');
    expect(html).not.toContain(CONFIG.strategyPrompt.slice(0, 40));
    expect(html).not.toContain("Save changes");
  });
});
