import { readdirSync, readFileSync } from "node:fs";
import * as lucide from "lucide-react";
import { describe, expect, it } from "vitest";
import {
  BUILDER_STEPS,
  REQUIRED_ORDER,
  REQUIRED_PLACE,
  ROW_PLACE,
  SETTINGS_STEPS,
  type PreviewRowId,
} from "./contract";
import { PART_ICON, PART_ICON_NAME, PART_STEP, REQUIRED_PART, ROW_PART, type PartId } from "./parts";

const PARTS = Object.keys(PART_ICON) as PartId[];
const ROWS = Object.keys(ROW_PLACE) as PreviewRowId[];

describe("part icons", () => {
  it("every step has an icon", () => {
    for (const id of BUILDER_STEPS) expect(PART_ICON[id], id).toBeDefined();
    // The settings page draws the same rail, and the rail cannot draw a step with no icon.
    for (const id of SETTINGS_STEPS) expect(PART_ICON[id], id).toBeDefined();
  });

  it("the Manage step of the settings page is the wrench", () => {
    expect(PART_ICON.manage).toBe(lucide.Wrench);
    expect(PART_ICON_NAME.manage).toBe("Wrench");
    expect(PART_STEP.manage).toBe("manage");
  });

  it("every card row has a part, and that part has an icon", () => {
    expect(Object.keys(ROW_PART).sort()).toEqual([...ROWS].sort());
    for (const id of ROWS) expect(PART_ICON[ROW_PART[id]], id).toBeDefined();
  });

  it("every required thing has a part, and that part has an icon", () => {
    for (const id of REQUIRED_ORDER) expect(PART_ICON[REQUIRED_PART[id]], id).toBeDefined();
  });

  it("no two parts share an icon", () => {
    expect(new Set(PARTS.map((id) => PART_ICON[id])).size).toBe(PARTS.length);
    expect(new Set(Object.values(PART_ICON_NAME)).size).toBe(PARTS.length);
  });

  it("the names match the icons", () => {
    // Identity with the package's own export, so it does not lean on displayName.
    const exports = lucide as unknown as Record<string, unknown>;
    for (const id of PARTS) expect(PART_ICON[id], id).toBe(exports[PART_ICON_NAME[id]]);
  });

  it("a row's part is edited on the step the row goes to", () => {
    for (const id of ROWS) expect(PART_STEP[ROW_PART[id]], id).toBe(ROW_PLACE[id].step);
    for (const id of REQUIRED_ORDER) expect(PART_STEP[REQUIRED_PART[id]], id).toBe(REQUIRED_PLACE[id].step);
  });

  it("a step is its own part", () => {
    // The rail looks its icon up by step id and the card by the row's part. With the case
    // above, a row that is a whole step can only get that step's icon.
    for (const id of BUILDER_STEPS) expect(PART_STEP[id], id).toBe(id);
    for (const id of SETTINGS_STEPS) expect(PART_STEP[id], id).toBe(id);
  });

  it("nothing else in the builder imports a part icon from lucide", () => {
    const taken = new Set(Object.values(PART_ICON_NAME));
    // The wrench is kept to this file too, although only the settings page has a Manage step.
    expect(taken.has("Wrench")).toBe(true);
    const dir = new URL("./", import.meta.url);
    const files = [
      ...readdirSync(dir).map((name) => new URL(name, dir)),
      ...readdirSync(new URL("./preview/", dir)).map((name) => new URL(`preview/${name}`, dir)),
    ].filter(
      (url) =>
        /\.tsx?$/.test(url.pathname) && !/\.test\.ts$/.test(url.pathname) && !url.pathname.endsWith("/parts.ts"),
    );
    for (const url of files) {
      const source = readFileSync(url, "utf8");
      for (const match of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"lucide-react"/g)) {
        const names = match[1].split(",").map(
          (name) =>
            name
              .replace(/^\s*type\s+/, "")
              .trim()
              .split(/\s+as\s+/)[0],
        );
        for (const name of names) expect(taken.has(name), `${url.pathname} imports ${name}`).toBe(false);
      }
    }
  });
});
