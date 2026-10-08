/**
 * The Save button, rendered to markup, for when it can be pressed. The page holds the
 * save's state; this only checks what the button makes of it.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SaveButton, type SaveState } from "./save-button";

function render(state: SaveState, dirty: boolean): string {
  return renderToStaticMarkup(createElement(SaveButton, { state, dirty, onSave: () => {} }));
}

const buttonTag = (html: string) => html.slice(0, html.indexOf(">") + 1);
const textOf = (html: string) => html.replace(/<[^>]+>/g, "");
/** The attribute, as React writes it. Not the `disabled:` in the button's class names. */
const DISABLED = / disabled=""/;

describe("the Save button", () => {
  it("is off while everything is saved, and on once something is not", () => {
    expect(buttonTag(render("idle", false))).toMatch(DISABLED);
    expect(buttonTag(render("idle", true))).not.toMatch(DISABLED);
  });

  it("is called Save changes at every width", () => {
    expect(buttonTag(render("idle", true))).toContain('aria-label="Save changes"');
    expect(textOf(render("idle", true))).toContain("Save changes");
  });

  it("is not dimmed while it says Saved over a page that is clean again", () => {
    const html = render("success", false);
    expect(buttonTag(html)).not.toMatch(DISABLED);
    expect(textOf(html)).toContain("Saved");
  });

  it("takes no press while a save is running or its result is showing", () => {
    for (const state of ["loading", "success", "error"] as const) {
      expect(buttonTag(render(state, true)), state).toContain('aria-disabled="true"');
    }
    expect(buttonTag(render("idle", true))).not.toContain("aria-disabled");
    expect(buttonTag(render("loading", true))).toContain('aria-busy="true"');
  });

  it("says what happened in the page's words", () => {
    expect(textOf(render("loading", true))).toContain("Saving…");
    expect(textOf(render("error", true))).toContain("Check the form");
  });
});
