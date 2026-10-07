/**
 * The halt switch's presses, without a browser.
 *
 * The suite has no DOM, so the component is called as the function it is, with the three
 * hooks it uses replaced by stand-ins: `useState` hands back whatever state a test says
 * the switch is in, and `useTransition` runs the work at once. The tree that comes back
 * is searched for the button a person would press, and its handler is called. What is
 * pinned is what the press SENDS, because that is what lets money move again:
 *
 *  - a clear carries the reason that was on screen at the first of its two presses;
 *  - a halt carries no such thing;
 *  - a clear that is refused is withdrawn, and the page is drawn again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

type HaltResult = { ok: true; data: { halted: boolean } } | { ok: false; error: string };
const action = vi.fn<(input: unknown) => Promise<HaltResult>>();
const refresh = vi.fn();

/** `useState` calls in the order the halt switch makes them. */
const STATE = { reason: 0, armed: 1, seen: 2, error: 3 } as const;
let preset: Partial<Record<number, unknown>> = {};
let stateCalls = 0;
let setters: Array<ReturnType<typeof vi.fn>> = [];
let work: Promise<unknown> = Promise.resolve();

vi.mock("react", async (original) => {
  const real = await original<typeof import("react")>();
  return {
    ...real,
    useId: () => "id",
    useState: (initial: unknown) => {
      const index = stateCalls;
      stateCalls += 1;
      const setter = vi.fn();
      setters[index] = setter;
      return [index in preset ? preset[index] : initial, setter];
    },
    useTransition: () => [
      false,
      (run: () => unknown) => {
        work = Promise.resolve(run());
      },
    ],
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/server/actions/admin", () => ({
  setInferenceHaltAction: (input: unknown) => action(input),
  clearInferencePauseAction: vi.fn(),
  testInferenceSignatureAction: vi.fn(),
}));

const { InferenceControls, haltRequest } = await import("./inference-controls");

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void }>;

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) return textOf((node as Node).props.children);
  return "";
}

function find(node: ReactNode, label: string): Node | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, label);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const element = node as Node;
  if (typeof element.props.onClick === "function" && textOf(element).includes(label)) return element;
  return find(element.props.children, label);
}

/** The halt switch as it stands for these props and this state: its tree, ready to be pressed. */
function haltSwitch(props: { halted: boolean; haltReason: string | null }, state: Partial<Record<keyof typeof STATE, unknown>> = {}): ReactNode {
  preset = Object.fromEntries(Object.entries(state).map(([name, value]) => [STATE[name as keyof typeof STATE], value]));
  stateCalls = 0;
  setters = [];
  const controls = InferenceControls({ ...props, paused: false, wallets: [] }) as ReactElement<{ children: ReactNode[] }>;
  const first = controls.props.children[0] as ReactElement<Record<string, unknown>>;
  // The first of the three controls is the halt switch: a function, called with its props.
  return (first.type as (props: Record<string, unknown>) => ReactNode)(first.props);
}

function press(tree: ReactNode, label: string): void {
  const button = find(tree, label);
  if (!button) throw new Error(`no button reads "${label}"`);
  button.props.onClick?.();
}

beforeEach(() => {
  action.mockReset();
  action.mockResolvedValue({ ok: true, data: { halted: false } });
  refresh.mockReset();
  work = Promise.resolve();
});

describe("clearing the halt", () => {
  const SHOWN = "USDC went from an agent wallet to the gateway with no ledger row. Transaction 5h…k.";

  it("takes two presses, and the first records the reason that is on screen", () => {
    const tree = haltSwitch({ halted: true, haltReason: SHOWN });
    // Not armed: the only button offered arms it, and sends nothing.
    expect(find(tree, "Yes, let payments resume")).toBeNull();
    press(tree, "Clear the halt");
    expect(setters[STATE.seen]).toHaveBeenCalledWith(SHOWN);
    expect(setters[STATE.armed]).toHaveBeenCalledWith(true);
    expect(action).not.toHaveBeenCalled();
  });

  it("sends, on the second press, the reason that was on screen at the first", async () => {
    // Between the two presses the page was drawn again with more in the reason. The
    // admin armed the clear over the shorter one, and that is the one the clear names.
    const grown = `[2 findings] ${SHOWN} | also (reconciler): a transfer nobody has read`;
    const tree = haltSwitch({ halted: true, haltReason: grown }, { armed: true, seen: SHOWN, reason: "checked it on chain" });
    press(tree, "Yes, let payments resume");
    await work;
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith({ halted: false, reason: "checked it on chain", seenReason: SHOWN });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("says the page showed no reason when it showed none", async () => {
    const tree = haltSwitch({ halted: true, haltReason: null }, { armed: true });
    press(tree, "Yes, let payments resume");
    await work;
    expect(action).toHaveBeenCalledWith({ halted: false, reason: "", seenReason: null });
  });

  it("is withdrawn when the server refuses it, and the page is drawn again so the new reason can be read", async () => {
    action.mockResolvedValue({ ok: false, error: "The reason changed since this page was loaded. Reload and read it before clearing." });
    const tree = haltSwitch({ halted: true, haltReason: SHOWN }, { armed: true, seen: SHOWN });
    press(tree, "Yes, let payments resume");
    await work;
    expect(setters[STATE.error]).toHaveBeenLastCalledWith("The reason changed since this page was loaded. Reload and read it before clearing.");
    // Back to the first press: the second cannot simply be pressed again over a reason nobody has read.
    expect(setters[STATE.armed]).toHaveBeenLastCalledWith(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("halting", () => {
  it("is one press with the reason typed, and says nothing of what the page showed", async () => {
    action.mockResolvedValue({ ok: true, data: { halted: true } });
    const tree = haltSwitch({ halted: false, haltReason: null }, { reason: "ledger and chain disagree" });
    press(tree, "Halt pay-per-use");
    await work;
    expect(action).toHaveBeenCalledWith({ halted: true, reason: "ledger and chain disagree" });
  });

  it("is not disarmed or redrawn by a refusal: there is nothing armed, and stopping can be pressed again", async () => {
    action.mockResolvedValue({ ok: false, error: "Say why, in a few words. Whoever clears this needs to know what was wrong." });
    const tree = haltSwitch({ halted: false, haltReason: null }, { reason: "no" });
    press(tree, "Halt pay-per-use");
    await work;
    expect(setters[STATE.error]).toHaveBeenLastCalledWith("Say why, in a few words. Whoever clears this needs to know what was wrong.");
    expect(setters[STATE.armed]).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("haltRequest", () => {
  it("puts what the page showed in a clear, and only in a clear", () => {
    expect(haltRequest(false, "a note", "the reason shown")).toEqual({ halted: false, reason: "a note", seenReason: "the reason shown" });
    expect(haltRequest(false, "", null)).toEqual({ halted: false, reason: "", seenReason: null });
    expect(haltRequest(true, "why", "the reason shown")).toEqual({ halted: true, reason: "why" });
    expect("seenReason" in haltRequest(true, "why", "the reason shown")).toBe(false);
  });
});
