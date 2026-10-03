import { describe, expect, it } from "vitest";
import { holdRootFlag, rootFlagRef } from "./root-flag";

/** Just enough of an Element for the flag: attributes and an owner document. */
function fakeRoot() {
  const attrs = new Map<string, string>();
  const root = {
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
    has: (name: string) => attrs.has(name),
  };
  const node = { ownerDocument: { documentElement: root } };
  return { root, node: node as unknown as Element };
}

describe("holdRootFlag", () => {
  it("sets the flag while held and clears it on release", () => {
    const { root } = fakeRoot();
    const release = holdRootFlag(root as unknown as Element, "data-sticky-subnav");
    expect(root.has("data-sticky-subnav")).toBe(true);
    release();
    expect(root.has("data-sticky-subnav")).toBe(false);
  });

  it("keeps the flag until the last holder lets go", () => {
    const { root } = fakeRoot();
    const el = root as unknown as Element;
    const a = holdRootFlag(el, "data-sticky-actionbar");
    const b = holdRootFlag(el, "data-sticky-actionbar");
    a();
    expect(root.has("data-sticky-actionbar")).toBe(true);
    b();
    expect(root.has("data-sticky-actionbar")).toBe(false);
  });

  it("ignores a second release of the same hold", () => {
    const { root } = fakeRoot();
    const el = root as unknown as Element;
    const a = holdRootFlag(el, "data-sticky-subnav");
    const b = holdRootFlag(el, "data-sticky-subnav");
    a();
    a();
    expect(root.has("data-sticky-subnav")).toBe(true);
    b();
    expect(root.has("data-sticky-subnav")).toBe(false);
  });

  it("counts each flag on its own", () => {
    const { root } = fakeRoot();
    const el = root as unknown as Element;
    const sub = holdRootFlag(el, "data-sticky-subnav");
    const bar = holdRootFlag(el, "data-sticky-actionbar");
    sub();
    expect(root.has("data-sticky-subnav")).toBe(false);
    expect(root.has("data-sticky-actionbar")).toBe(true);
    bar();
    expect(root.has("data-sticky-actionbar")).toBe(false);
  });
});

describe("rootFlagRef", () => {
  it("holds the flag on the element's document root through a mount, a Strict Mode remount and an unmount", () => {
    const { root, node } = fakeRoot();
    const ref = rootFlagRef("data-sticky-subnav");
    const first = ref(node);
    expect(root.has("data-sticky-subnav")).toBe(true);
    first?.();
    const second = ref(node);
    expect(root.has("data-sticky-subnav")).toBe(true);
    second?.();
    expect(root.has("data-sticky-subnav")).toBe(false);
  });

  it("does nothing for a null node", () => {
    expect(rootFlagRef("data-sticky-subnav")(null)).toBeUndefined();
  });
});
