import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const components = join(process.cwd(), "src", "components");

/** Every literal `id="…"` in a component's source. */
function idsIn(source: string): string[] {
  return [...source.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
}

/**
 * The cash Withdraw dialog opens from the top bar, so it can sit over any page. On an
 * agent's settings page it sat over that page's own Withdraw card with the same
 * `withdraw-chain` and `withdraw-amount` ids: a label's `for` resolves to the first
 * match in the document, which was the card behind the dialog, so the dialog's fields
 * lost their names. Read from the sources, so a new field cannot bring the clash back.
 */
describe("the cash Withdraw dialog's element ids", () => {
  const dialog = idsIn(readFileSync(join(components, "shell", "withdraw-modal.tsx"), "utf8"));
  /** Every literal id in a folder's components, tests left out. */
  const idsOf = (dir: string) =>
    readdirSync(dir)
      .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
      .flatMap((file) => idsIn(readFileSync(join(dir, file), "utf8")));
  const settings = idsOf(join(components, "agents", "settings"));
  // That page's steps are the builder's own step bodies, so their ids are on it too.
  const builderDir = join(components, "agents", "builder");
  const builder = [...idsOf(builderDir), ...idsOf(join(builderDir, "preview"))];

  it("finds the ids it is meant to compare", () => {
    expect(dialog).toContain("cash-withdraw-amount");
    expect(settings).toContain("withdraw-amount");
    expect(builder).toContain("agent-name");
    expect(builder).toContain("risk-max-trade");
  });

  it("shares none with the agent settings page it can open over", () => {
    expect(dialog.filter((id) => settings.includes(id))).toEqual([]);
  });

  it("shares none with the steps that page draws, which the builder draws too", () => {
    expect(dialog.filter((id) => builder.includes(id))).toEqual([]);
  });

  it("points every label and description at an id the dialog itself renders", () => {
    const source = readFileSync(join(components, "shell", "withdraw-modal.tsx"), "utf8");
    const referenced = [
      ...[...source.matchAll(/\bhtmlFor="([^"]+)"/g)].map(([, id]) => id),
      // `aria-describedby={cond ? "a" : "b"}` and `? "a" : undefined`.
      ...[...source.matchAll(/aria-describedby=\{[^}]*\}/g)].flatMap(([expr]) =>
        [...expr.matchAll(/"([^"]+)"/g)].map(([, id]) => id),
      ),
    ];
    expect(referenced.length).toBeGreaterThan(0);
    for (const id of referenced) expect(dialog).toContain(id);
  });
});
