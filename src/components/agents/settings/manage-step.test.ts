/**
 * The Manage step, rendered to markup: four sections, one showing, every one mounted.
 * The cards inside are stand-ins. Each has its own tests or none, and this is about the
 * step that holds them.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentDetail, WalletBalance } from "@/server/types";
import { ANCHOR_PLACE } from "./settings-href";

/** A stand-in for one card: its name, and the names of the props it was handed. */
function card(name: string) {
  return function Card(props: Record<string, unknown>) {
    return createElement("div", { "data-card": name, "data-props": Object.keys(props).sort().join(",") });
  };
}

vi.mock("./wallets-card", () => ({ WalletsCard: card("wallets") }));
vi.mock("./withdraw-form", () => ({ WithdrawForm: card("withdraw") }));
vi.mock("./go-live-card", () => ({ GoLiveCard: card("mode") }));
vi.mock("./budget-card", () => ({
  BudgetCard: (props: { hasRealWallets: boolean; initialPerTxUsd: number | null }) =>
    createElement("div", { "data-card": "budget", "data-real": String(props.hasRealWallets), "data-cap": String(props.initialPerTxUsd) }),
}));
vi.mock("./danger-zone", () => ({ DangerZone: card("delete") }));

const { DEFAULT_MANAGE_SECTION, MANAGE_LEAD, MANAGE_SECTIONS, ManageStep, parseManageSection } = await import(
  "./manage-step"
);
type ManageSection = (typeof MANAGE_SECTIONS)[number];

const agent = { id: "agent_1", slug: "aileen", name: "Aileen" } as AgentDetail;
const wallet = (walletId: string): WalletBalance => ({ chain: "solana", address: "So1", walletId, balances: [] });

function render(section: ManageSection, balances: WalletBalance[] = [wallet("w_1")], perTxUsd: number | null = null) {
  return renderToStaticMarkup(
    createElement(ManageStep, { agent, balances, perTxUsd, section, onSection: () => {} }),
  );
}

/** The opening tag of a section's wrapper. */
function wrapper(html: string, section: ManageSection): string {
  const match = new RegExp(`<div[^>]*id="manage-${section}"[^>]*>`).exec(html);
  if (!match) throw new Error(`no ${section} section`);
  return match[0];
}

describe("the Manage step", () => {
  it("shows one section and keeps the other three mounted, hidden and inert", () => {
    for (const showing of MANAGE_SECTIONS) {
      const html = render(showing);
      for (const section of MANAGE_SECTIONS) {
        const tag = wrapper(html, section);
        // The attributes, as React writes them.
        if (section === showing) {
          expect(tag, section).not.toMatch(/ hidden=""| inert=""/);
        } else {
          expect(tag, section).toContain(' hidden=""');
          expect(tag, section).toContain(' inert=""');
        }
      }
      // Every card is in the markup whichever section shows, so nothing typed in one is lost.
      for (const name of ["wallets", "withdraw", "mode", "budget", "delete"]) {
        expect(html, name).toContain(`data-card="${name}"`);
      }
    }
  });

  it("puts the wallet budget under the mode, in the Live mode section", () => {
    const html = render("live");
    const live = html.slice(html.indexOf('id="manage-live"'), html.indexOf('id="manage-delete"'));
    expect(live.indexOf('data-card="mode"')).toBeGreaterThan(-1);
    expect(live.indexOf('data-card="budget"')).toBeGreaterThan(live.indexOf('data-card="mode"'));
  });

  it("marks the showing section's button as pressed, by name", () => {
    const html = render("withdraw");
    const buttons = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]*)<\/button>/g)].map(
      ([, pressed, label]) => `${label}:${pressed}`,
    );
    expect(buttons).toEqual(["Wallets:false", "Withdraw:true", "Live mode:false", "Delete:false"]);
  });

  it("gives each section a wrapper a link can put the focus on", () => {
    const html = render("wallets");
    for (const section of MANAGE_SECTIONS) expect(wrapper(html, section), section).toContain('tabindex="-1"');
  });

  it("hands the danger zone the way to the Withdraw form", () => {
    expect(render("delete")).toMatch(/data-card="delete" data-props="[^"]*onWithdraw[^"]*"/);
  });

  it("tells the wallet budget whether there is a real wallet to cap, and the cap in force", () => {
    expect(render("live", [wallet("paper_1")])).toContain('data-card="budget" data-real="false" data-cap="null"');
    expect(render("live", [wallet("paper_1"), wallet("w_1")], 250)).toContain(
      'data-card="budget" data-real="true" data-cap="250"',
    );
  });
});

describe("a section named by a link", () => {
  it("is read by exact match only", () => {
    for (const section of MANAGE_SECTIONS) expect(parseManageSection(section)).toBe(section);
    for (const other of ["", "Wallets", "budget", "mode", "toString", undefined, null, 3]) {
      expect(parseManageSection(other), String(other)).toBeNull();
    }
  });

  it("is every section a link into the page can name, and no other", () => {
    const named = Object.values(ANCHOR_PLACE).flatMap((place) => (place.sub === undefined ? [] : [place.sub]));
    expect([...new Set(named)].sort()).toEqual([...MANAGE_SECTIONS].sort());
  });

  it("finds on the step every wrapper such a link puts the focus on", () => {
    const html = render("wallets");
    const ids = Object.values(ANCHOR_PLACE)
      .flatMap((place) => place.focusIds ?? [])
      .filter((id) => id.startsWith("manage-"));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(html, id).toContain(`id="${id}"`);
  });
});

describe("the Manage step's words", () => {
  it("opens on Wallets", () => {
    expect(DEFAULT_MANAGE_SECTION).toBe("wallets");
  });

  it("says under its title that nothing on it waits for Save", () => {
    expect(MANAGE_LEAD).toBe("Its wallets, its money, its mode, and deleting it. Nothing here waits for Save.");
  });
});
