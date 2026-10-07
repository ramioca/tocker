import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const table = readFileSync(join(process.cwd(), "src", "components", "agents", "trades-table.tsx"), "utf8");
/** The file without its comments, so a sentence about a field is not taken for a read of it. */
const code = table.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("TradesTable", () => {
  it("asks the row view what each row says, as the viewer the page named", () => {
    // Read from the component: nothing renders it in a test, and a row built without
    // `isOwner` would show the owner the visitor's words, or the reverse.
    expect(code).toContain("isOwner = false,");
    expect(code).toContain("const view = tradeRowView(trade, { isOwner });");
    expect(code.match(/tradeRowView\(/g)).toHaveLength(1);
  });

  it("never reads the stored reason or who decided for itself", () => {
    // Both are owner-only and both go through the view, which decides who is told what.
    expect(code).not.toMatch(/\.error\b/);
    // Nor by destructuring or a bracket read: without the names the file does use, the
    // word does not appear in it at all.
    const known = /\b(?:isError|isFetchNextPageError|ErrorState|LoadMoreFailed)\b/g;
    expect(code.replace(known, "")).not.toMatch(/error/i);
    expect("const { error } = trade;".replace(known, "")).toMatch(/error/i);
    expect('trade["error"]'.replace(known, "")).toMatch(/error/i);
    expect(code).not.toMatch(/\bdecidedBy\b/);
    expect(code).not.toMatch(/\bdecidedAt\b/);
    expect(code).not.toMatch(/\b(?:knownTradeError|plainTradeReason|tradeStatusChip)\b/);
  });

  it("makes a trade one block of two rows: the eight cells, then the note on its own", () => {
    // The block is found by its id, hovered and tinted as one; it is not itself a row.
    const block = code.indexOf('role="none"\n                      id={`trade-${trade.id}`}');
    expect(block).toBeGreaterThan(-1);
    expect(code).toContain("document.getElementById(`trade-${focusId}`)");
    expect(code.slice(block, code.indexOf(">", block))).toMatch(/ROW,[\s\S]*flashing && /);

    // The header, the cells, the note. Both rows of a trade put their cells on the block's grid.
    const rows = [...code.matchAll(/role="row"[^>]*>/g)];
    expect(rows).toHaveLength(3);
    expect(rows[0][0]).toBe('role="row" className={HEAD}>');
    expect(rows[1][0]).toBe('role="row" aria-current={focused ? "true" : undefined} className="contents">');
    expect(rows[2][0]).toBe('role="row" className="contents">');
    expect(rows[1].index).toBeGreaterThan(block);

    // All eight cells sit in the first of the two, and the note is the only cell of the second.
    const cells = code.slice(rows[1].index, rows[2].index);
    for (let column = 1; column <= 8; column += 1) {
      expect(cells.split(`role="cell"`).length - 1).toBe(8);
      expect(cells.split(`aria-colindex={${column}}`).length - 1, `column ${column}`).toBe(1);
    }
    expect(cells).not.toContain("aria-colspan");
    const note = code.slice(rows[2].index);
    expect(note).toMatch(/^role="row" className="contents">\s*<div\s+role="cell"\s+aria-colindex=\{2\}\s+aria-colspan=\{7\}/);
    expect(note.split('role="cell"').length - 1).toBe(1);
    // A trade with nothing to say has no second row.
    expect(code.slice(rows[1].index, rows[2].index)).toMatch(/\{view\.reason \|\| view\.rationale \? \(\s*<div $/);
  });

  it("gives the note its place in the eight columns, and each repeated button a name", () => {
    expect(code).toContain('role="table" aria-label="Trades" aria-colcount={8}');
    for (let column = 1; column <= 8; column += 1) {
      // Once on the header and once on the row's own cell; column 2 once more, on the note.
      expect(code.split(`aria-colindex={${column}}`).length - 1, `column ${column}`).toBe(column === 2 ? 3 : 2);
    }
    expect(code).toMatch(/aria-colindex=\{2\}\s+aria-colspan=\{7\}/);
    expect(code).toContain('aria-label={`${open ? "Less" : "More"} of ${what}`}');
    expect(code).toContain("aria-label={`Details of why the ${rowName} did not happen`}");
    expect(code).toContain("const rowName = `${trade.side} of ${trade.token.symbol}`;");
  });
});
