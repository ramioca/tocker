import { describe, expect, it } from "vitest";
import { MAX_NOTIFICATION_PAGES, collectPages, pagesParam } from "./older-pages";
import type { Page } from "@/server/types";

/** Ten rows, three per page, cursors are the next start index. */
function fakeQuery(total = 10, size = 3) {
  const calls: Array<string | null> = [];
  const fetchPage = async (cursor: string | null): Promise<Page<number>> => {
    calls.push(cursor);
    const start = cursor ? Number(cursor) : 0;
    const items = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => start + i);
    return { items, nextCursor: start + size < total ? String(start + size) : null };
  };
  return { fetchPage, calls };
}

describe("pagesParam", () => {
  it("defaults to the first page", () => {
    expect(pagesParam(undefined)).toBe(1);
    expect(pagesParam("")).toBe(1);
  });

  it("reads a whole number and caps it", () => {
    expect(pagesParam("3")).toBe(3);
    expect(pagesParam(["2", "5"])).toBe(2);
    expect(pagesParam("9999")).toBe(MAX_NOTIFICATION_PAGES);
  });

  it("ignores anything that is not a positive whole number", () => {
    expect(pagesParam("0")).toBe(1);
    expect(pagesParam("-2")).toBe(1);
    expect(pagesParam("2.5")).toBe(1);
    expect(pagesParam("abc")).toBe(1);
  });
});

describe("collectPages", () => {
  it("returns the first page and its cursor for one page", async () => {
    const { fetchPage, calls } = fakeQuery();
    expect(await collectPages(fetchPage, 1)).toEqual({ items: [0, 1, 2], nextCursor: "3" });
    expect(calls).toEqual([null]);
  });

  it("walks the cursor and keeps the rows in order", async () => {
    const { fetchPage, calls } = fakeQuery();
    expect(await collectPages(fetchPage, 3)).toEqual({ items: [0, 1, 2, 3, 4, 5, 6, 7, 8], nextCursor: "9" });
    expect(calls).toEqual([null, "3", "6"]);
  });

  it("stops when the rows run out, with no cursor left", async () => {
    const { fetchPage, calls } = fakeQuery();
    expect(await collectPages(fetchPage, 10)).toEqual({ items: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], nextCursor: null });
    expect(calls).toHaveLength(4);
  });
});
