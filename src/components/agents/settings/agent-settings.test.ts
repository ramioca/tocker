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
  props: {
    agent?: AgentDetail;
    config?: AgentConfig | null;
    keys?: LlmKeyRow[];
    payPerUseAllowed?: boolean;
    skippingLine?: string | null;
  } = {},
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
        feeBps: 25,
        ...(props.skippingLine === undefined ? {} : { skippingLine: props.skippingLine }),
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

  it("states Tocker's fee as the rate the server handed it, with what that is on this agent's ticket", () => {
    // The page is handed 25 basis points; the agent's ticket is $100.
    const text = words(render());
    expect(CONFIG.risk.maxTradeUsd).toBe(100);
    // The read-back line of the limits step, and the same words on the agent card.
    expect(text).toContain("$1.00 data/run · Tocker fee 0.25% of each fill");
    // Under Max per trade, where the ticket is sized.
    expect(text).toContain("Tocker's fee is 0.25% of each fill: $0.25 on a ticket this size.");
    // And on the card's "A run" lines.
    expect(text).toContain("Fee 0.25% of each fill");
    // The fee is the same share of every ticket: no preset card singles one out, and
    // nothing calls it flat.
    expect(text).not.toMatch(/flat|each way|per fill/);
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

/**
 * The position limit, the cash reserve and the switch that skips a full agent's scheduled
 * runs, as the page first paints them. They are drawn by the step bodies the builder
 * shares, from the same module every other limit is.
 */
describe("the two limits that can be off, and the skip switch", () => {
  /** The attributes of the element with this id. */
  function tagOf(html: string, id: string): string {
    const match = new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`).exec(html);
    if (!match) throw new Error(`no #${id}`);
    return match[0];
  }
  const withRisk = (risk: Partial<AgentConfig["risk"]>, schedule: AgentConfig["schedule"] = CONFIG.schedule): AgentConfig => ({
    ...CONFIG,
    risk: { ...CONFIG.risk, ...risk },
    schedule,
  });

  it("are both off on an agent that never set them, each a switch with its own sentence", () => {
    const html = render("step=limits");
    const text = words(html);
    expect(tagOf(html, "risk-max-positions-toggle")).toContain('aria-checked="false"');
    expect(tagOf(html, "risk-cash-reserve-toggle")).toContain('aria-checked="false"');
    expect(text).toContain("Max open positions Off");
    expect(text).toContain("The most tokens it may hold at once. Off means no limit.");
    expect(text).toContain("Cash reserve Off");
    expect(text).toContain("Cash it never spends on a buy. Off means it may spend its last dollar.");
    // Off is not news: neither is named in the read-back line or on the card.
    expect(text).not.toMatch(/max \d+ positions?|cash reserve ·|\$[\d.]+ cash reserve/);
    expect(text).toContain("Risk limits: Saved");
  });

  it("show what is set as a value that can be typed, with a sentence in the owner's own numbers", () => {
    const config = withRisk({ maxOpenPositions: 3, cashReserveUsd: 5 });
    const html = render("step=limits", { agent: agentOf({ config }), config });
    const text = words(html);
    expect(tagOf(html, "risk-max-positions-toggle")).toContain('aria-checked="true"');
    expect(tagOf(html, "risk-max-positions-value")).toContain('value="3"');
    expect(tagOf(html, "risk-max-positions-value")).toContain('aria-label="Max open positions threshold, exact value"');
    expect(tagOf(html, "risk-cash-reserve-toggle")).toContain('aria-checked="true"');
    expect(tagOf(html, "risk-cash-reserve-value")).toContain('value="$5.00"');
    expect(text).toContain("With 3 held it buys no new token until one is sold; it can still add to one it holds, and it can always sell.");
    expect(text).toContain("A buy that would leave less than $5.00 in cash once its fee is paid is refused; sells are never held back.");
    // The read-back line of the step, and the same words on the agent card.
    expect(text.split("$1.00 data/run · max 3 positions · $5.00 cash reserve · Tocker fee 0.25% of each fill").length - 1).toBe(2);
    expect(text).toContain("Everything is saved");
  });

  it("says when the reserve is the whole of the agent's equity or more, so every buy would be refused", () => {
    // The fixture agent has $30 of equity.
    const helper = (risk: Partial<AgentConfig["risk"]>) => {
      const config = withRisk(risk);
      return words(render("step=limits", { agent: agentOf({ config }), config }));
    };
    expect(helper({ cashReserveUsd: 50 })).toContain(
      "A buy that would leave less than $50.00 in cash is refused, and that is more than its $30.00 of equity, so every buy would be refused.",
    );
    expect(helper({ cashReserveUsd: 30 })).toContain(
      "A buy that would leave less than $30.00 in cash is refused, and that is all of its $30.00 of equity, so every buy would be refused.",
    );
    // A cent under the book, a buy is still possible and nothing is claimed.
    expect(helper({ cashReserveUsd: 29 })).toContain(
      "A buy that would leave less than $29.00 in cash once its fee is paid is refused; sells are never held back.",
    );
  });

  /**
   * The two ticket sentences are silent for an agent that sizes by a share of equity,
   * and the reserve's warning used to be silent with them. A reserve is a floor under
   * cash: it refuses every buy however the ticket is sized.
   */
  it("says so too for an agent that sizes its tickets as a share of equity", () => {
    const sized = { cashReserveUsd: 50, sizing: { mode: "percent_equity", percentOfEquity: 10, referenceRangePct: 25, minTradeUsd: 5 } };
    const config = withRisk(sized as Partial<AgentConfig["risk"]>);
    const text = words(render("step=limits", { agent: agentOf({ config }), config }));
    expect(text).toContain(
      "A buy that would leave less than $50.00 in cash is refused, and that is more than its $30.00 of equity, so every buy would be refused.",
    );
    // The ticket sentences still say nothing about its equity, as before.
    expect(text).not.toContain("every trade would be refused for lack of cash");
  });

  it("arrive saved on an agent whose config predates them", () => {
    const risk = { ...CONFIG.risk };
    delete risk.maxOpenPositions;
    delete risk.cashReserveUsd;
    const old = { ...CONFIG, risk, schedule: { intervalMinutes: 15 } } as AgentConfig;
    const html = render("step=limits", { agent: agentOf({ config: old }), config: old });
    expect(tagOf(html, "risk-max-positions-toggle")).toContain('aria-checked="false"');
    expect(tagOf(html, "risk-cash-reserve-toggle")).toContain('aria-checked="false"');
    expect(words(html)).toContain("Everything is saved");
    expect(tagOf(render("step=schedule", { agent: agentOf({ config: old }), config: old }), "schedule-skip-full")).toContain('aria-checked="false"');
  });

  it("offers the skip as a switch on the Schedule step, off by default, saying what is and is not skipped", () => {
    const html = render("step=schedule");
    expect(tagOf(html, "schedule-skip-full")).toContain('role="switch"');
    expect(tagOf(html, "schedule-skip-full")).toContain('aria-checked="false"');
    const text = words(html);
    expect(text).toContain("Skip a run when there is no room to buy");
    expect(text).toContain(
      "When it is at its position limit, has no cash for its smallest order after the reserve, or has used the day's buys, a scheduled run is not started: it does not think, buys no data and does not review its positions. Stop loss, take profit and the other automatic exits still fire on their own, and Run now always runs.",
    );

    const on = withRisk({}, { intervalMinutes: 15, skipWhenFull: true });
    expect(tagOf(render("step=schedule", { agent: agentOf({ config: on }), config: on }), "schedule-skip-full")).toContain('aria-checked="true"');

    // With every exit rule off the promise about exits is not made: what is said is that
    // its runs go on while it holds a position.
    const noExits = withRisk({
      stopLossPct: null,
      takeProfitPct: null,
      trailingStopPct: null,
      maxHoldHours: null,
      exitScoreBelow: null,
      exitOnLiquidityDropPct: null,
    });
    const bare = words(render("step=schedule", { agent: agentOf({ config: noExits }), config: noExits }));
    expect(bare).toContain("Every exit rule is off, so only a run can sell: while it holds a position its runs are not skipped.");
    expect(bare).not.toContain("automatic exits still fire");

    const manual = withRisk({}, { intervalMinutes: 0, skipWhenFull: true });
    expect(words(render("step=schedule", { agent: agentOf({ config: manual, nextRunAt: null }), config: manual }))).toContain(
      "With a manual schedule there is no scheduled run to skip. Run now always runs.",
    );
  });

  it("says in the bar that scheduled runs are being skipped, when the server found that they are", () => {
    const line = "Skipping scheduled runs: no room to buy (3 of 3 positions). Automatic exits still run.";
    const text = words(render("", { skippingLine: line }));
    expect(text).toContain(line);
    expect(text).not.toContain("next tick scheduled");
    expect(words(render())).toContain("next tick scheduled");
  });
});
