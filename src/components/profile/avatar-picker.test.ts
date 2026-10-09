/**
 * The avatar picker, rendered to markup as the server renders it: a radio group of
 * tiles, one Tab stop, and shuffle after the group. What a press or a shuffle does is in
 * `avatar-picker-model.test.ts`; this checks the row a page opens with.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AvatarChoice } from "@/lib/avatar";
import { AvatarPicker } from "./avatar-picker";

const X_PHOTO = "https://pbs.twimg.com/profile_images/1234567890/AbC_dEf-1_normal.jpg";
const GIVEN = ["aaaaaaaaa1", "aaaaaaaaa2", "aaaaaaaaa3", "aaaaaaaaa4", "aaaaaaaaa5"];

type Props = Parameters<typeof AvatarPicker>[0];

function render(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(AvatarPicker, {
      photoUrl: null,
      pinnedSeed: null,
      initialSeeds: GIVEN,
      value: null,
      onChange: () => {},
      ...props,
    }),
  ).replace(/&quot;/g, '"');
}

/** Each `<button …>` opening tag, in order. */
const buttons = (html: string) => html.match(/<button\b[^>]*>/g) ?? [];
const radios = (html: string) => buttons(html).filter((tag) => tag.includes('role="radio"'));
const nameOf = (tag: string) => /aria-label="([^"]*)"/.exec(tag)?.[1];
const seed = (value: string): AvatarChoice => ({ kind: "seed", seed: value });

describe("the tiles", () => {
  it("are a radio group called Avatar", () => {
    expect(render()).toMatch(/<div role="radiogroup" aria-label="Avatar"/);
  });

  it("are five generated avatars when the account has no photo", () => {
    expect(radios(render()).map(nameOf)).toEqual(["Avatar 1", "Avatar 2", "Avatar 3", "Avatar 4", "Avatar 5"]);
  });

  it("are the account's own photo, then four generated ones, when it has one", () => {
    const html = render({ photoUrl: X_PHOTO });
    expect(radios(html).map(nameOf)).toEqual(["Your photo", "Avatar 1", "Avatar 2", "Avatar 3", "Avatar 4"]);
    // The photo is drawn once, in its own tile, at the size a 44px tile needs.
    expect(html.match(/background-image/g)).toHaveLength(1);
    expect(html).toContain(`url("${X_PHOTO.replace("_normal", "_200x200")}")`);
  });

  it("offer no photo tile for a link the app will not show", () => {
    const html = render({ photoUrl: "https://example.com/me.jpg" });
    expect(radios(html).map(nameOf)).toEqual(["Avatar 1", "Avatar 2", "Avatar 3", "Avatar 4", "Avatar 5"]);
    expect(html).not.toContain("background-image");
    expect(html).not.toContain("example.com");
  });

  it("put the saved avatar first among the generated ones", () => {
    const html = render({ photoUrl: X_PHOTO, pinnedSeed: "savedseed1", value: seed("savedseed1") });
    const tags = radios(html);
    expect(tags).toHaveLength(5);
    expect(tags.map((tag) => tag.includes('aria-checked="true"'))).toEqual([false, true, false, false, false]);
  });

  it("show an avatar that was selected somewhere else, in the first generated place", () => {
    // Not one of the row's own: the first-run card saved it while this form was on screen.
    const html = render({ photoUrl: X_PHOTO, value: seed("k3j9x0a1bz") });
    const tags = radios(html);
    expect(tags.map(nameOf)).toEqual(["Your photo", "Avatar 1", "Avatar 2", "Avatar 3", "Avatar 4"]);
    expect(tags.map((tag) => tag.includes('aria-checked="true"'))).toEqual([false, true, false, false, false]);
  });

  it("are the same on the server and in the browser when a page gives the seeds", () => {
    expect(render()).toBe(render());
    // Left to itself the picker draws its own, which only a dialog may let it do.
    expect(render({ initialSeeds: undefined })).not.toBe(render({ initialSeeds: undefined }));
  });
});

describe("selection", () => {
  it("marks the selected tile, and only it", () => {
    const tags = radios(render({ value: seed(GIVEN[2]) }));
    expect(tags.map((tag) => tag.includes('aria-checked="true"'))).toEqual([false, false, true, false, false]);
    for (const tag of tags) expect(tag).toMatch(/aria-checked="(true|false)"/);
    const withPhoto = radios(render({ photoUrl: X_PHOTO, value: { kind: "photo" } }));
    expect(withPhoto.map((tag) => tag.includes('aria-checked="true"'))).toEqual([true, false, false, false, false]);
  });

  it("selects none while nothing is picked", () => {
    for (const tag of radios(render({ value: null }))) expect(tag).toContain('aria-checked="false"');
  });

  it("is one Tab stop: the selected tile, or the first when none is", () => {
    const stops = (html: string) => radios(html).map((tag) => /tabindex="(-?\d)"/.exec(tag)?.[1]);
    expect(stops(render({ value: seed(GIVEN[3]) }))).toEqual(["-1", "-1", "-1", "0", "-1"]);
    expect(stops(render({ value: null }))).toEqual(["0", "-1", "-1", "-1", "-1"]);
  });
});

describe("shuffle", () => {
  it("is a plain button after the group, not one of the radios", () => {
    const html = render();
    const all = buttons(html);
    expect(all).toHaveLength(6);
    const shuffle = all[5];
    expect(nameOf(shuffle)).toBe("Show other avatars");
    expect(shuffle).not.toContain("role=");
    // The tiles hold no <div>, so the first one to close is the group: shuffle is the
    // one button that follows it.
    const afterGroup = html.slice(html.indexOf("</div>") + "</div>".length);
    expect(afterGroup.startsWith("<button")).toBe(true);
    expect(buttons(afterGroup)).toEqual([shuffle]);
  });

  it("says nothing to a screen reader until it is pressed", () => {
    const html = render();
    expect(html).toMatch(/<span aria-live="polite" class="sr-only"><\/span>/);
    expect(html).not.toContain("New avatars");
  });
});

describe("while a save is running", () => {
  it("takes no press on a tile or on shuffle", () => {
    const tags = buttons(render({ disabled: true }));
    expect(tags).toHaveLength(6);
    for (const tag of tags) expect(tag).toMatch(/ disabled=""/);
    for (const tag of buttons(render())) expect(tag).not.toMatch(/ disabled=""/);
  });
});

describe("buttons in a form", () => {
  it("never submit it", () => {
    for (const tag of buttons(render())) expect(tag).toContain('type="button"');
  });
});
