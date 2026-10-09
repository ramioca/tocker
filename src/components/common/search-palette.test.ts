import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchPalette, paletteTakesKey, type SearchPaletteItem } from "./search-palette";

const item = (id: string, title: string, category: string): SearchPaletteItem => ({
  id,
  title,
  description: `${title} description`,
  category,
  icon: null,
  action: () => {},
});

function render(commands: SearchPaletteItem[], emptyText?: string): string {
  return renderToStaticMarkup(
    createElement(SearchPalette, {
      isOpen: true,
      onClose: () => {},
      commands,
      label: "Search agents, tokens and people",
      emptyText,
    }),
  );
}

describe("SearchPalette markup", () => {
  it("is a labelled combobox that owns a listbox of options, with the first one active", () => {
    const html = render([item("a", "Momentum Mike", "Agents"), item("b", "BONK", "Tokens"), item("c", "WIF", "Tokens")]);
    const listId = /role="listbox"[^>]*id="([^"]+)"|id="([^"]+)"[^>]*role="listbox"/.exec(html);
    const id = listId?.[1] ?? listId?.[2];
    expect(id).toBeTruthy();
    expect(html).toMatch(/role="combobox"/);
    expect(html).toContain('aria-label="Search agents, tokens and people"');
    expect(html).toContain(`aria-controls="${id}"`);
    expect(html).toContain(`aria-activedescendant="${id}-option-0"`);
    expect(html.match(/role="option"/g)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    // One group per category, each named by its heading.
    expect(html.match(/role="group"/g)).toHaveLength(2);
    expect(html).toContain(">3 results<");
  });

  it("says the caller's empty text, never 'No commands found'", () => {
    const html = render([], "Searching…");
    expect(html).toContain("Searching…");
    expect(html).not.toMatch(/No commands/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("aria-activedescendant");
  });
});

/** Just enough of an Element for the rule: a role, a parent, `closest` and `contains`. */
interface FakeElement {
  role: string | null;
  parent: FakeElement | null;
  closest(selector: string): FakeElement | null;
  contains(other: FakeElement | null): boolean;
}

function el(role: string | null, parent: FakeElement | null): FakeElement {
  const self: FakeElement = {
    role,
    parent,
    // Reads the role selectors in a list, which is all the rule asks for.
    closest(selector) {
      const roles = [...selector.matchAll(/\[role="([^"]+)"\]/g)].map((match) => match[1]);
      for (let node: FakeElement | null = self; node; node = node.parent) {
        if (node.role !== null && roles.includes(node.role)) return node;
      }
      return null;
    },
    contains(other) {
      for (let node = other; node; node = node.parent) if (node === self) return true;
      return false;
    },
  };
  return self;
}

const takes = (target: FakeElement | object | null, palette: FakeElement | null) =>
  paletteTakesKey(target as EventTarget | null, palette as unknown as Element | null);

describe("whose key it is, with the listener on the window", () => {
  // The page as the app draws it: the palette inside the dialog command-menu.tsx wraps
  // around it, and another dialog (the first-run card, the key prompt) beside that one.
  const body = el(null, null);
  const paletteDialog = el("dialog", body);
  const palette = el(null, paletteDialog);
  const input = el("combobox", palette);
  const list = el("listbox", palette);
  const cancel = el(null, paletteDialog);
  const card = el("dialog", body);
  const cardField = el(null, el(null, card));
  const cardButton = el(null, card);
  const alert = el("alertdialog", body);

  it("takes a key pressed in its own input or list", () => {
    expect(takes(input, palette)).toBe(true);
    expect(takes(list, palette)).toBe(true);
    expect(takes(palette, palette)).toBe(true);
  });

  it("takes a key pressed in the dialog wrapped around it", () => {
    expect(takes(paletteDialog, palette)).toBe(true);
    expect(takes(cancel, palette)).toBe(true);
  });

  it("takes a key pressed on the page, the document or the window, where focus can be left", () => {
    expect(takes(body, palette)).toBe(true);
    // Neither has a `closest`.
    expect(takes({}, palette)).toBe(true);
    expect(takes(null, palette)).toBe(true);
  });

  it("leaves a key pressed in a dialog that opened over it: the card's field, its button, the card itself", () => {
    expect(takes(cardField, palette)).toBe(false);
    expect(takes(cardButton, palette)).toBe(false);
    expect(takes(card, palette)).toBe(false);
    expect(takes(el(null, alert), palette)).toBe(false);
  });

  it("takes every key when it has no dialog around it and none is open over it", () => {
    const bare = el(null, body);
    expect(takes(el(null, bare), bare)).toBe(true);
    expect(takes(cardField, bare)).toBe(false);
  });

  it("takes the key before its root is on the page, as it did when there was no rule", () => {
    expect(takes(cardField, null)).toBe(true);
  });

  it("is asked first, before Escape, the arrows or Enter are acted on or cancelled", () => {
    const source = readFileSync(new URL("./search-palette.tsx", import.meta.url), "utf8");
    expect(source).toMatch(
      /const onKeyDown = \(event: KeyboardEvent\) => \{\s*if \(!paletteTakesKey\(event\.target, rootRef\.current\)\) return;\s*if \(event\.key === "Escape"\)/,
    );
    expect(source).toContain("<div ref={rootRef} ");
  });
});
