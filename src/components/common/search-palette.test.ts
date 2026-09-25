import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchPalette, type SearchPaletteItem } from "./search-palette";

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
