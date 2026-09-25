import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { LocalTime, RelativeTime } from "./relative-time";

/**
 * The server does not know the reader's timezone, and hydration keeps whatever text the
 * server wrote. So the server writes no exact time at all; the browser adds it.
 */
describe("server-rendered times", () => {
  const iso = "2026-09-25T01:58:59.000Z";

  it("RelativeTime carries no server-zone title", () => {
    const html = renderToString(createElement(RelativeTime, { iso }));
    expect(html).toContain(`dateTime="${iso}"`);
    expect(html).not.toContain("title=");
  });

  it("LocalTime is an empty, machine-readable <time> until the browser fills it", () => {
    const html = renderToString(createElement(LocalTime, { iso }));
    expect(html).toMatch(new RegExp(`<time[^>]*dateTime="${iso}"[^>]*></time>`));
  });

  it("LocalTime's date-only form is empty on the server too: the day depends on the zone", () => {
    const html = renderToString(createElement(LocalTime, { iso, dateOnly: true }));
    expect(html).toMatch(new RegExp(`<time[^>]*dateTime="${iso}"[^>]*></time>`));
  });
});
