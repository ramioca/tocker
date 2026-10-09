/**
 * The first-run card and what stands around it, read as text and, for the one part that
 * needs no dialog around it, rendered to markup. None of it can be opened in this
 * environment: what a press or a keystroke does is in `username-field.test.ts`,
 * `save-outcome.test.ts` and `gate-decision.test.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILD, BUILD_STEPS, BuildSteps, CHOOSE, NOT_NOW } from "./first-run-screens";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
const CARD = read("./first-run.tsx");
const SCREENS = read("./first-run-screens.tsx");
const GROUND = read("./first-run-ground.tsx");
const GATE = read("./onboarding-gate.tsx");
const KEY_PROMPT = read("./key-prompt.tsx");
const LAYOUT = read("../../app/(client)/(app)/layout.tsx");

/** The source with its comments taken out, so a rule about code is not broken by a sentence about it. */
const code = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

/** Every module a source imports from. */
const imports = (source: string) => [...code(source).matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);

describe("every word on the two screens", () => {
  it("screen 1", () => {
    expect(CHOOSE).toEqual({
      title: "Choose your name and avatar",
      helper: "This is how people see you on Tocker.",
      label: "Username",
      quiet: "You can change both later in Settings.",
    });
  });

  it("screen 2", () => {
    expect(BUILD).toEqual({
      title: "Build your first agent",
      helper: "It trades for you, by rules you set.",
      primary: "Create your first agent",
    });
    expect(BUILD_STEPS).toEqual([
      { title: "Give it a strategy", body: "Pick a preset or write your own." },
      { title: "Start on paper", body: "It trades by itself with fake money at real prices." },
      {
        title: "Go live when you are ready",
        body: "Fund it and it does the same with real money, inside limits you set.",
      },
    ]);
    expect(NOT_NOW).toBe("Not now");
  });

  it("tells a screen reader who they are now, before the helper", () => {
    expect(SCREENS).toMatch(/<span className="sr-only">You are @\{handle\} now\. <\/span>\s*\{BUILD\.helper\}/);
  });

  it("promises nothing a paper agent does not keep", () => {
    // It still pays for its model and its data.
    const said = JSON.stringify([CHOOSE, BUILD, BUILD_STEPS]).toLowerCase();
    expect(said).not.toContain("nothing at risk");
    expect(said).not.toContain("risk-free");
    expect(said).not.toContain("free");
  });

  it("has no exclamation mark, and nothing welcomes anyone aboard", () => {
    const said = JSON.stringify([CHOOSE, BUILD, BUILD_STEPS, NOT_NOW]);
    expect(said).not.toContain("!");
    expect(said.toLowerCase()).not.toContain("welcome");
  });
});

describe("the three steps, as drawn", () => {
  const html = renderToStaticMarkup(createElement(BuildSteps, { animate: false }));
  const rows = html.match(/<li\b[\s\S]*?<\/li>/g) ?? [];
  /** What is left for a screen reader: every `aria-hidden` element taken out, then the tags. */
  const heard = (row: string) =>
    row
      .replace(/<span aria-hidden="true"[^>]*>(?:(?!<span\b)[\s\S])*?<\/span>/g, "")
      .replace(/<span aria-hidden="true"[^>]*>[\s\S]*?<\/span><\/span>/g, "")
      .replace(/<svg\b[\s\S]*?<\/svg>/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  it("is an ordered list of three", () => {
    expect(html).toMatch(/^<ol\b/);
    expect(rows).toHaveLength(3);
  });

  it("each row says its heading, then its one line", () => {
    BUILD_STEPS.forEach((step, index) => {
      expect(rows[index].indexOf(step.title)).toBeGreaterThan(-1);
      expect(rows[index].indexOf(step.body)).toBeGreaterThan(rows[index].indexOf(step.title));
    });
  });

  it("a screen reader hears the words and none of the picture", () => {
    BUILD_STEPS.forEach((step, index) => {
      expect(heard(rows[index])).toBe(`${step.title} ${step.body}`);
    });
  });

  it("draws the strategy's own icon on the first row, and a line down to the second", () => {
    expect(rows[0]).toContain('data-part="strategy"');
    expect(rows[0]).toContain("bg-[linear-gradient(180deg,#3d6bff,#7a5cff)]");
  });

  it("lights the second row, where an agent starts, and marks it paper", () => {
    expect(rows[1]).toContain("ring-[#7a5cff]/60");
    expect(rows[1]).toContain("shadow-[0_0_0_3px_rgb(122_92_255/0.12)]");
    expect(rows[1]).toMatch(/<span aria-hidden="true"[^>]*><span[^>]*>paper<\/span><\/span>/);
    // The way on from here is later: a dashed line, not the silk.
    expect(rows[1]).toContain("border-dashed border-white/20");
  });

  it("draws the third row as later: a dashed, empty tile, a quieter heading, and live", () => {
    expect(rows[2]).toContain("border-dashed border-white/25");
    expect(rows[2]).toContain("text-foreground/70");
    expect(rows[2]).toMatch(/opacity-60[^>]*>(?:<span[^>]*><\/span>)?live<\/span>/);
    // Nothing leads on from the last row.
    expect(rows[2]).not.toContain("origin-top");
  });

  it("is still when asked to be: no row starts hidden", () => {
    expect(html).not.toMatch(/opacity:\s*0/);
    expect(html).not.toMatch(/translateY\(6px\)/);
  });
});

describe("the card is the sign-in page's own", () => {
  const popup = /<Dialog\.Popup\b[\s\S]*?>\n/.exec(code(CARD))?.[0] ?? "";

  it("takes its material from auth-card", () => {
    expect(popup).toContain('"auth-card flex max-h-full flex-col outline-none"');
  });

  it("names no width, padding, border, radius, colour, blur or shadow of its own", () => {
    // auth.css is unlayered and wins: a utility for any of these would be a lie.
    expect(popup).not.toMatch(/\b(?:max-)?w-|\bp[xytblr]?-|\bborder\b|\bborder-|\brounded|\bbg-|\bbackdrop-|\bshadow|\bring-/);
  });

  it("does not clip: the top edge is a pseudo-element on the border, and scrolling is inside", () => {
    expect(popup).not.toContain("overflow");
    expect(code(CARD)).toMatch(/min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain/);
  });

  it("animates opacity and scale only, on the popup itself, and only opacity for reduced motion", () => {
    expect(popup).toContain("transition-[opacity,scale] duration-[240ms]");
    expect(popup).toContain("data-ending-style:duration-[160ms]");
    expect(popup).toContain("motion-safe:data-starting-style:scale-[0.96]");
    expect(popup).not.toMatch(/(?<!motion-safe:)data-(?:starting|ending)-style:scale/);
  });

  it("has no backdrop of its own: the ground behind it is opaque", () => {
    expect(code(CARD)).not.toContain("Dialog.Backdrop");
    expect(code(SCREENS)).not.toContain("Dialog.Backdrop");
  });

  it("has no close button", () => {
    expect(code(CARD)).not.toContain("Dialog.Close");
    expect(code(SCREENS)).not.toContain("Dialog.Close");
  });

  it("sits where the sign-in card sits", () => {
    expect(code(CARD)).toContain("fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[72px] pb-4");
    expect(code(CARD)).toContain("sm:pt-[max(88px,calc(50dvh_-_255px))]");
  });

  it("uses the sign-in card's own submit for both buttons, each in a form of its own", () => {
    expect(imports(SCREENS)).toContain("@/components/auth/metal-submit");
    expect(code(SCREENS).match(/<MetalSubmit\b/g)).toHaveLength(2);
    expect(code(SCREENS).match(/<form\b/g)).toHaveLength(2);
  });

  it("draws the person through UserAvatar: the preview, and the header of the second screen", () => {
    expect(code(SCREENS)).toMatch(/<UserAvatar\b[^>]*px=\{72\}[^>]*className="size-16 sm:size-\[72px\]"/);
    expect(code(CARD)).toMatch(/<UserAvatar user=\{person\} px=\{24\} className="size-6" \/>/);
  });
});

describe("the username field", () => {
  const input = /<Input\b[\s\S]*?\/>/.exec(code(SCREENS))?.[0] ?? "";

  it("is labelled, described by its address and its status, and marked when it is wrong", () => {
    expect(code(SCREENS)).toMatch(/<label htmlFor=\{`\$\{id\}-name`\}/);
    expect(input).toContain("id={`${id}-name`}");
    expect(input).toContain("aria-describedby={`${id}-address ${id}-status`}");
    expect(input).toContain("aria-invalid={view.invalid || undefined}");
  });

  it("is nothing a password manager or a keyboard should help with", () => {
    for (const attribute of [
      'autoComplete="off"',
      'autoCapitalize="none"',
      'autoCorrect="off"',
      "spellCheck={false}",
      'enterKeyHint="go"',
      "data-1p-ignore",
      'data-lpignore="true"',
      "maxLength={USERNAME_MAX}",
    ]) {
      expect(input).toContain(attribute);
    }
  });

  it("is the sign-in card's field, 44px tall, with room for the @ and the mark", () => {
    expect(input).toContain('"h-11 rounded-[12px] bg-white/[0.04] pr-9 pl-7 dark:bg-white/[0.04]"');
  });

  it("says verdicts in one polite region that is always there, and refused saves as alerts", () => {
    const source = code(SCREENS);
    expect(source.match(/role="status" aria-live="polite"/g)).toHaveLength(1);
    expect(source).toMatch(/role="status" aria-live="polite"[^>]*>\s*\{view\.said === "status" \? view\.text : null\}/);
    expect(source.match(/role="alert"/g)).toHaveLength(2);
    // "Checking…" and the hints are drawn in a node of their own, outside both.
    expect(source).toMatch(/\{view\.said === "quiet" \? <p className=/);
  });

  it("shows where the profile will live", () => {
    expect(code(SCREENS)).toMatch(/\{ADDRESS_PREFIX\}\s*<span className="text-foreground">\{addressName\(field\)\}<\/span>/);
  });
});

describe("the ground", () => {
  it("covers the app, opaque, under the card and over everything else", () => {
    expect(code(GROUND)).toContain('"fixed inset-0 z-[99] isolate bg-black"');
    expect(code(GROUND)).toMatch(/<div\s+aria-hidden\b/);
  });

  it("is the sign-in page's backdrop and lockup, not a copy", () => {
    expect(imports(GROUND)).toContain("@/components/auth/login-backdrop");
    expect(code(GROUND)).toContain("<LoginBackdrop />");
    expect(code(GROUND)).toMatch(/<div className="auth-top">\s*<span className="auth-brand">\s*<TockerMark height=\{24\}/);
  });

  it("is not a link: the way on is the card", () => {
    expect(code(GROUND)).not.toMatch(/<Link\b|<a\b|href=/);
  });

  it("loads nothing heavy: the silk loads itself, after the page is idle", () => {
    expect(imports(GROUND).sort()).toEqual(
      ["@/components/auth/login-backdrop", "@/components/brand/tocker-mark", "@/lib/utils"].sort(),
    );
  });
});

describe("the gate", () => {
  it("draws the ground itself, from a static import, so it is in the first paint", () => {
    expect(code(GATE)).toContain('import { FirstRunGround } from "./first-run-ground";');
    expect(code(GATE)).toMatch(/\{run && ground !== "gone" \? <FirstRunGround\b/);
  });

  it("loads the card only through next/dynamic, rendered on the server so it is asked for with the page", () => {
    expect(code(GATE)).toContain('const FirstRun = dynamic(() => import("./first-run").then((mod) => mod.FirstRun));');
    expect(imports(GATE)).not.toContain("./first-run");
    expect(imports(GATE)).not.toContain("./first-run-screens");
  });

  it("loads the key prompt as it always did: in the browser only", () => {
    expect(code(GATE)).toMatch(
      /const KeyPrompt = dynamic\(\(\) => import\("\.\/key-prompt"\)\.then\(\(mod\) => mod\.KeyPrompt\), \{\s*ssr: false,?\s*\}\);/,
    );
    expect(imports(GATE)).not.toContain("./key-prompt");
  });

  it("holds the card's code behind a boundary of its own, and gives the app back if it never comes", () => {
    expect(code(GATE)).toMatch(/<CardBoundary onError=\{dropAll\}>\s*<Suspense fallback=\{null\}>\s*<FirstRun\b/);
    expect(code(GATE)).toContain("static getDerivedStateFromError()");
  });

  it("keeps every key from the app until the card opens, and only until then", () => {
    const source = code(GATE);
    // On the way down, before any listener of the app's (the palette's is on the window too).
    expect(source).toContain('window.addEventListener("keydown", hold, true);');
    expect(source).toContain('window.removeEventListener("keydown", hold, true);');
    expect(source).toContain('window.addEventListener("keyup", hold, true);');
    expect(source).toContain('window.removeEventListener("keyup", hold, true);');
    expect(source).toMatch(/event\.stopPropagation\(\);\s*if \(keptFromPage\(event\)\) event\.preventDefault\(\);/);
    // Lifted when the card opens, when the ground starts to leave, and when it is dropped.
    expect(source).toContain('const waiting = run !== null && ground === "up";');
    expect(source).toContain("const keysHeld = waiting && !cardOpen;");
    expect(source).toMatch(/if \(!keysHeld\) return;[\s\S]*?\}, \[keysHeld\]\);/);
    expect(source).toContain("onOpen={onOpen}");
  });

  it("is told the card is open in the same breath as it opens, or the card could not be typed in", () => {
    expect(code(CARD)).toMatch(/setOpened\(true\);\s*onOpen\(\);/);
    expect(code(CARD).match(/setOpened\(true\)/g)).toHaveLength(1);
  });

  it("is told who needs the screens by the server: strictly a null onboarded_at", () => {
    expect(code(LAYOUT)).toContain("needsOnboarding={session?.onboardedAt === null}");
    // No request made in the browser decides the first-run flow.
    expect(code(GATE)).not.toContain("fetch(");
  });

  it("reads the same device flag the key prompt writes", () => {
    const key = /const STORAGE_KEY = "([^"]+)";/;
    expect(key.exec(GATE)?.[1]).toBe("tocker:onboarding-dismissed");
    expect(key.exec(KEY_PROMPT)?.[1]).toBe("tocker:onboarding-dismissed");
  });
});

describe("what is left of the old modal", () => {
  it("is the key prompt alone", () => {
    expect(existsSync(new URL("./onboarding-modal.tsx", import.meta.url))).toBe(false);
    for (const gone of ["WelcomeStep", "AgentStep", "PayPerUseStep", "LookAroundStep", "AnimatePresence", "STEPS"]) {
      expect(code(KEY_PROMPT)).not.toContain(gone);
    }
    expect(code(KEY_PROMPT)).not.toContain("onboarding=1");
  });

  it("still asks whether the account has a key, and stays closed where it is held back", () => {
    expect(code(KEY_PROMPT)).toContain('fetch("/api/me/llm-keys"');
    expect(code(KEY_PROMPT)).toContain("if (!show || suppressedRef.current) return;");
  });

  it("still lets the provider list use Escape without closing the prompt for good", () => {
    expect(code(KEY_PROMPT)).toContain('details.reason === "escape-key" && details.event.defaultPrevented');
  });

  it("says what it said", () => {
    expect(KEY_PROMPT).toContain('"Add an LLM key for your agents" : "Your agents need an LLM key to run"');
    expect(KEY_PROMPT).toContain("I&rsquo;ll do this later");
    expect(KEY_PROMPT).toContain('<AddLlmKeyForm compact aboveDialog submitLabel="Save key" onAdded={onAdded} />');
  });
});

describe("what the card asks of the server", () => {
  it("is two actions, called from two files", () => {
    expect(imports(CARD)).toContain("@/server/actions/onboarding");
    expect(imports(read("./use-handle-check.ts"))).toContain("@/server/actions/onboarding");
    for (const pure of ["./first-run-screens.tsx", "./first-run-ground.tsx", "./onboarding-gate.tsx"]) {
      expect(imports(read(pure)).filter((from) => from.startsWith("@/server/"))).toEqual([]);
    }
  });

  it("refreshes the page and the whole query cache after a save, without waiting", () => {
    const source = code(CARD);
    expect(source).toContain("router.refresh();");
    expect(source).toContain("void queryClient.invalidateQueries();");
    expect(source).not.toMatch(/await\s+(?:router|queryClient)\./);
  });

  it("types over a refused name with the refusal in hand, so its old answer is forgotten", () => {
    const source = code(SCREENS);
    expect(source).toContain('dispatch({ type: "typed", raw: event.target.value, refused: field.refused });');
    expect(source).toContain("typed(action.refused === null ? field : refusedSave(field, action.refused), action.raw)");
  });

  it("starts no check while a save is on its way", () => {
    expect(code(SCREENS)).toContain("useHandleCheck(field.value, wantsCheck(field) && !saving, onAnswer);");
  });
});
