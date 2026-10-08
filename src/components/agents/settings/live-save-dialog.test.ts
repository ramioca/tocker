/**
 * The confirm before a live agent's save, rendered to markup, for when it asks and what it
 * says. The dialog itself is a stand-in: the real one draws into a portal, which a render
 * to a string leaves out.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function part(tag: string) {
  return function Part({ children }: { children?: ReactNode }) {
    return createElement(tag, null, children);
  };
}

vi.mock("@/components/ui/dialog", () => ({
  Dialog: function Dialog({ open, children }: { open: boolean; children?: ReactNode }) {
    return open ? createElement("div", { role: "dialog" }, children) : null;
  },
  DialogContent: part("div"),
  DialogHeader: part("div"),
  DialogFooter: part("div"),
  DialogTitle: part("h2"),
  DialogDescription: part("p"),
}));

const { LiveSaveDialog } = await import("./live-save-dialog");

function render(lines: readonly string[] | null): string {
  return renderToStaticMarkup(
    createElement(LiveSaveDialog, { agentName: "Aileen", lines, onKeep: () => {}, onSave: () => {} }),
  );
}

/** The text a reader sees, tags dropped. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, "");

describe("the confirm before a live agent's save", () => {
  it("does not ask when nothing would be loosened", () => {
    expect(render(null)).toBe("");
    expect(render([])).toBe("");
  });

  it("asks in the page's words, naming the agent", () => {
    const html = render(["Max per trade $100.00 → $250.00"]);
    expect(html).toContain("<h2>Save changes to a live agent?</h2>");
    expect(html).toContain("<p>Aileen trades real money. From its next tick:</p>");
  });

  it("draws every line it is given, in order, and none of its own", () => {
    const lines = ["Max per trade $100.00 → $250.00", "Trades on its own, without asking you"];
    const items = [...render(lines).matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(([, item]) => textOf(item));
    expect(items).toEqual(lines.map((line) => `·${line}`));
  });

  it("offers the two answers, the one that changes nothing first", () => {
    const buttons = [...render(["Slippage 1% → 3%"]).matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(([, label]) =>
      textOf(label),
    );
    expect(buttons).toEqual(["Keep editing", "Save changes"]);
  });
});
