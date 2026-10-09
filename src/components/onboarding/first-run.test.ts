/**
 * The first-run card and what stands around it, read as text and, for the parts that
 * need no dialog around them, rendered to markup. None of it can be opened in this
 * environment: what a press or a keystroke does is in `username-field.test.ts`,
 * `save-outcome.test.ts` and `gate-decision.test.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { APP_BACKDROP } from "./backdrop";
import {
  BUILD,
  BUILD_STEPS,
  BuildSteps,
  CHOOSE,
  Header,
  NOT_NOW,
  TOUR,
  TOUR_POINTS,
  TOUR_SPECIMENS,
  TourPoints,
} from "./first-run-screens";
import { progress, type FirstRunScreen } from "./gate-decision";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
const CARD = read("./first-run.tsx");
const SCREENS = read("./first-run-screens.tsx");
const GATE = read("./onboarding-gate.tsx");
const KEY_PROMPT = read("./key-prompt.tsx");
const LAYOUT = read("../../app/(client)/(app)/layout.tsx");

/** The source with its comments taken out, so a rule about code is not broken by a sentence about it. */
const code = (source: string) =>
  source
    // A comment in markup first, braces and all, so none is left behind as `{}`.
    .replace(/\{\s*\/\*(?:(?!\*\/)[\s\S])*\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

/** Every module a source imports from, a bare `import "x"` included. */
const imports = (source: string) =>
  [...code(source).matchAll(/(?:from|^import)\s+"([^"]+)"/gm)].map((match) => match[1]);

/** Markup with every `aria-hidden` element cut out, whatever is nested in it. */
function withoutHidden(html: string): string {
  const hidden = /<(span|svg|div)\b[^>]*\baria-hidden="true"[^>]*>/;
  let out = html;
  for (let open = hidden.exec(out); open; open = hidden.exec(out)) {
    const tags = new RegExp(`<${open[1]}\\b[^>]*>|</${open[1]}>`, "g");
    tags.lastIndex = open.index + open[0].length;
    let depth = 1;
    let end = out.length;
    for (let tag = tags.exec(out); tag; tag = tags.exec(out)) {
      depth += tag[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        end = tag.index + tag[0].length;
        break;
      }
    }
    out = out.slice(0, open.index) + out.slice(end);
  }
  return out;
}

/** What is left of a piece of markup for a screen reader: no hidden element, no tag. */
const heard = (html: string) =>
  withoutHidden(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The words a sighted person reads in a piece of markup, hidden pictures included. */
const seen = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

describe("every word on the three screens", () => {
  it("screen 1", () => {
    expect(CHOOSE).toEqual({
      title: "Choose your name and avatar",
      helper: "This is how people see you on Tocker.",
      label: "Username",
      quiet: "You can change both later in Settings.",
    });
  });

  it("screen 2", () => {
    expect(TOUR).toEqual({
      title: "How it works",
      helper: "Three things, then you build one.",
      primary: "Next",
      quiet: "Skip",
    });
    expect(TOUR_POINTS).toEqual([
      { title: "You write the rules", body: "A strategy in plain words, and limits it cannot break." },
      { title: "It runs on a schedule", body: "Each run it finds new tokens, scores them and trades by your rules." },
      { title: "You see every move", body: "Each trade is on its page with the reason. Pause it any time." },
    ]);
  });

  it("screen 3", () => {
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

  it("tells a screen reader who they are now on the screen that follows the save, before its helper", () => {
    expect(SCREENS).toMatch(/<span className="sr-only">You are @\{handle\} now\. <\/span>\s*\{TOUR\.helper\}/);
    expect(SCREENS.match(/You are @\{handle\} now\./g)).toHaveLength(1);
  });

  it("promises nothing a paper agent does not keep", () => {
    // It still pays for its model and its data.
    const said = JSON.stringify([CHOOSE, TOUR, TOUR_POINTS, TOUR_SPECIMENS, BUILD, BUILD_STEPS]).toLowerCase();
    expect(said).not.toContain("nothing at risk");
    expect(said).not.toContain("risk-free");
    expect(said).not.toContain("free");
    expect(said).not.toContain("profit");
    expect(said).not.toContain("guarantee");
  });

  it("has no exclamation mark, and nothing welcomes anyone aboard", () => {
    const said = JSON.stringify([CHOOSE, TOUR, TOUR_POINTS, TOUR_SPECIMENS, BUILD, BUILD_STEPS, NOT_NOW]);
    expect(said).not.toContain("!");
    expect(said.toLowerCase()).not.toContain("welcome");
  });

  it("is in sentence case, and short enough to read at a glance", () => {
    for (const { title, body } of TOUR_POINTS) {
      expect(title).toMatch(/^[A-Z][a-z ]+$/);
      expect(title.length).toBeLessThanOrEqual(24);
      // Two lines of the card's small type at most.
      expect(body.length).toBeLessThanOrEqual(70);
      expect(body).toMatch(/\.$/);
    }
  });
});

describe("the tour, as drawn", () => {
  const html = renderToStaticMarkup(createElement(TourPoints, { animate: false }));
  const rows: string[] = html.match(/<li\b[\s\S]*?<\/li>/g) ?? [];

  it("is a list of three, not a numbered one: these are three things, not three steps", () => {
    expect(html).toMatch(/^<ul\b/);
    expect(rows).toHaveLength(3);
  });

  it("each row says its heading, then its one sentence or two", () => {
    TOUR_POINTS.forEach((point, index) => {
      expect(rows[index].indexOf(point.title)).toBeGreaterThan(-1);
      expect(rows[index].indexOf(point.body)).toBeGreaterThan(rows[index].indexOf(point.title));
    });
  });

  it("a screen reader hears the words and none of the pictures", () => {
    TOUR_POINTS.forEach((point, index) => {
      expect(heard(rows[index])).toBe(`${point.title} ${point.body}`);
    });
    expect(heard(html)).toBe(TOUR_POINTS.map((point) => `${point.title} ${point.body}`).join(" "));
  });

  it("gives every row one small picture, at the end of its heading line", () => {
    for (const row of rows) {
      // The rule down the left, and the picture: the two hidden things in a row.
      expect(row.match(/<span aria-hidden="true"/g)).toHaveLength(2);
      expect(row).toMatch(/<div class="flex items-center justify-between gap-2"><p[^>]*>[^<]+<\/p><span aria-hidden="true"/);
    }
  });

  it("frames each picture as a 20px well that gives way before the heading does", () => {
    for (const row of rows) {
      const well = /<\/p><span aria-hidden="true" class="([^"]+)"/.exec(row)?.[1] ?? "";
      for (const part of ["h-5", "min-w-0", "rounded-md", "border", "border-white/[0.07]", "bg-white/[0.04]", "text-[11px]"]) {
        expect(well.split(" "), part).toContain(part);
      }
      // Left out whole where a heading and its picture cannot share a line.
      expect(well.split(" ")).toContain("max-[360px]:hidden");
      // The words keep their colour beside their size: one class did not replace the other.
      expect(well.split(" ")).toContain("text-muted-foreground");
      expect(row).toMatch(/<p class="[^"]*\bshrink-0\b[^"]*">/);
    }
  });

  it("draws the first as a strategy being typed: a line of plain words and a caret", () => {
    expect(seen(rows[0])).toContain(TOUR_SPECIMENS.strategy);
    expect(rows[0]).toContain(`>${TOUR_SPECIMENS.strategy}</span><span class="h-3 w-px shrink-0 bg-primary"></span>`);
  });

  it("draws the second as a run's figures: words muted, numbers in mono", () => {
    expect(seen(rows[1])).toContain("scored 5 · bought 1");
    expect(rows[1].match(/<span class="font-mono text-foreground">\d+<\/span>/g)).toHaveLength(2);
  });

  it("draws the third as a trade with its reason: the feed's buy mark, then why", () => {
    expect(rows[2]).toMatch(/bg-positive\/15[^"]*text-positive[^"]*uppercase">buy<\/span>/);
    expect(seen(rows[2])).toContain(`buy${TOUR_SPECIMENS.reason}`);
  });

  it("names no token and shows no price or gain in its pictures", () => {
    const pictures = JSON.stringify(TOUR_SPECIMENS);
    expect(pictures).not.toMatch(/\$|%|[A-Z]{3,}/);
  });

  it("runs the silk down the left, a third beside each row", () => {
    const rules = rows.map((row) => /bg-\[linear-gradient\(180deg,[^\]]+\)\]/.exec(row)?.[0]);
    expect(rules).toEqual([
      "bg-[linear-gradient(180deg,#3d6bff,#6461ff)]",
      "bg-[linear-gradient(180deg,#6461ff,#7a5cff_56%,#a353ef)]",
      "bg-[linear-gradient(180deg,#a353ef,#ff3dcb)]",
    ]);
  });

  it("uses no tile and no image: a heading and its picture must fit one line on a small phone", () => {
    expect(html).not.toContain("size-8");
    expect(html).not.toMatch(/<svg\b|<img\b/);
  });

  it("holds the lines under each heading to one width, so they break the same way on a phone and a desktop", () => {
    expect(html.match(/max-w-\[17rem\]/g)).toHaveLength(3);
  });

  it("is still when asked to be: nothing starts hidden or out of place", () => {
    expect(html).not.toMatch(/opacity:\s*0/);
    expect(html).not.toMatch(/translateY\(6px\)|scaleY\(0\)/);
  });

  it("moves only by transform and opacity when it does move", () => {
    const moving = renderToStaticMarkup(createElement(TourPoints, { animate: true }));
    const styles = [...moving.matchAll(/style="([^"]*)"/g)].map((match) => match[1]);
    expect(styles.length).toBeGreaterThan(0);
    for (const style of styles) {
      for (const property of style.split(";").filter(Boolean)) {
        expect(property.split(":")[0].trim(), style).toMatch(/^(opacity|transform)$/);
      }
    }
  });
});

describe("the three steps, as drawn", () => {
  const html = renderToStaticMarkup(createElement(BuildSteps, { animate: false }));
  const rows = html.match(/<li\b[\s\S]*?<\/li>/g) ?? [];

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

describe("the row above the title", () => {
  const person = { handle: "rami", avatarSeed: "k3v9x0q2ab", avatarUrl: null };
  const still = { travel: 0, seconds: 0 };
  const header = (screen: FirstRunScreen) =>
    renderToStaticMarkup(
      createElement(Header, { steps: progress(3, screen)!, person: screen > 1 ? person : null, swap: still }),
    );
  /** Each pip's fill, in order: whether it is drawn full. */
  const lit = (html: string) =>
    [...html.matchAll(/<span class="[^"]*\borigin-left\b[^"]*"><\/span>/g)].map((match) =>
      match[0].includes("scale-x-100"),
    );

  it.each([1, 2, 3] as const)("shows three pips and says %i of 3", (screen) => {
    const html = header(screen);
    expect(html.match(/<span class="h-1 w-5 overflow-hidden rounded-full bg-white\/\[0\.12\]">/g)).toHaveLength(3);
    expect(lit(html)).toEqual([1, 2, 3].map((pip) => pip <= screen));
    expect(html).toContain(`<span aria-hidden="true">${screen} of 3</span>`);
    expect(html).toContain(`<span class="sr-only">Step ${screen} of 3</span>`);
  });

  it("is heard as the count alone on the first screen, and with the new name after it", () => {
    expect(heard(header(1))).toBe("Step 1 of 3");
    expect(heard(header(2))).toBe("Step 2 of 3 @rami");
    expect(heard(header(3))).toBe("Step 3 of 3 @rami");
  });

  it("cuts the silk in three, one third on each pip", () => {
    const fills = [...header(3).matchAll(/bg-\[linear-gradient\(90deg,[^\]]+\)\]/g)].map((match) => match[0]);
    expect(fills).toEqual([
      "bg-[linear-gradient(90deg,#3d6bff,#6461ff)]",
      "bg-[linear-gradient(90deg,#6461ff,#7a5cff_56%,#a353ef)]",
      "bg-[linear-gradient(90deg,#a353ef,#ff3dcb)]",
    ]);
  });

  it("is 24px tall whatever is in it, so the title under it never moves", () => {
    for (const screen of [1, 2, 3] as const) expect(header(screen)).toMatch(/^<div class="flex h-6 shrink-0 items-center gap-3">/);
  });

  it("is not drawn for the one screen an owner sees", () => {
    expect(progress(1, 1)).toBeNull();
    expect(code(CARD)).toContain("const steps = progress(screens, screen);");
    expect(code(CARD)).toMatch(/\{steps \? <Header steps=\{steps\} person=\{screen > 1 \? person : null\} swap=\{swap\} \/> : null\}/);
  });

  it("draws the person through UserAvatar, as the account menu will", () => {
    expect(code(SCREENS)).toMatch(/<UserAvatar user=\{person\} px=\{24\} className="size-6" \/>/);
  });
});

describe("the screens, in the card", () => {
  const source = code(CARD);

  it("shows them in order: who you are, how it works, build one", () => {
    expect(source).toMatch(
      /\{screen === 1 \? \(\s*<ChooseScreen\b[\s\S]*?\) : screen === 2 \? \(\s*<TourScreen\b[\s\S]*?\) : \(\s*<BuildScreen\b/,
    );
  });

  it("goes on from the first by the save's answer, and from the second by its button", () => {
    expect(source).toMatch(/if \(outcome\.then === "screen-2"\) \{\s*setScreens\(3\);\s*goOn\(1, 3, pressed\);/);
    expect(source).toContain("onNext={(pressed) => goOn(2, 3, pressed)}");
    expect(source).toMatch(/const next = screenAfter\(of, from\);\s*if \(next === null\) \{\s*setClosed\(true\);/);
  });

  it("holds all three stand-ins in one cell, so the tallest sets the card's one height", () => {
    expect(source).toMatch(/\{screens === 3 \? \(\s*<>\s*<ChooseGhost \/>\s*<TourGhost \/>\s*<BuildGhost \/>\s*<\/>\s*\) : null\}/);
    // No height is written down for the card: the browser measures it.
    expect(source).not.toMatch(/min-h-\[\d|50dvh/);
    const ghosts = code(SCREENS);
    for (const name of ["ChooseGhost", "TourGhost", "BuildGhost"]) {
      expect(ghosts).toMatch(new RegExp(`export function ${name}\\(\\) \\{\\s*return \\(\\s*<Ghost>[\\s\\S]*?<div className=\\{FOOTER\\} />\\s*</Ghost>`));
    }
    expect(ghosts).toContain('<div aria-hidden inert className="invisible col-start-1 row-start-1 flex min-w-0 flex-col">');
  });

  it("ends every screen in the same footer, so the three buttons are on the same pixels", () => {
    const screens = code(SCREENS);
    expect(screens).toContain('const FOOTER = "mt-auto h-[116px] shrink-0 pt-4";');
    expect(screens.match(/<Footer\b/g)).toHaveLength(3);
    expect(imports(SCREENS)).toContain("@/components/auth/metal-submit");
    expect(screens.match(/<MetalSubmit\b/g)).toHaveLength(3);
    expect(screens.match(/<form\b/g)).toHaveLength(3);
  });

  it("says Next on the tour's button and Skip under it", () => {
    const screens = code(SCREENS);
    expect(screens).toContain("button={<MetalSubmit disabled={false}>{TOUR.primary}</MetalSubmit>}");
    expect(screens).toContain("quiet={<QuietButton onClick={onSkip}>{TOUR.quiet}</QuietButton>}");
  });

  it("puts the keyboard on the button of a screen with nothing to fill in", () => {
    expect(code(SCREENS).match(/querySelector<HTMLButtonElement>\('button\[type="submit"\]'\)\?\.focus\(\{ preventScroll: true \}\)/g)).toHaveLength(2);
  });

  it("presses once however long Enter is held, so one screen's key never presses the next one's button", () => {
    expect(source).toContain('if (event.key === "Enter" && event.repeat) event.preventDefault();');
  });

  it("changes screen without motion after a key press, and with opacity alone for less motion", () => {
    expect(source).toContain("const swap: Swap = { travel: reduce || fromKeys ? 0 : 12, seconds: fromKeys ? 0 : reduce ? 0.15 : 0.2 };");
    expect(source.match(/animate=\{!reduce && !fromKeys\}/g)).toHaveLength(2);
  });
});

describe("closing the card", () => {
  const source = code(CARD);

  it("asks one rule whether this screen can be left", () => {
    expect(source).toContain("const closable = canClose(plan, screen, failed);");
  });

  it("refuses Escape and a press outside where it cannot, and while a save is on its way", () => {
    expect(source).toContain("disablePointerDismissal={!closable}");
    expect(source).toMatch(/if \(!closable \|\| saving\) \{\s*details\.cancel\(\);\s*return;\s*\}\s*setClosed\(true\);/);
  });

  it("is a modal dialog: the app behind takes no press and no key while it is open", () => {
    expect(source).toMatch(/<Dialog\.Root\s+open=\{open\}\s+modal\s/);
  });

  it("closes from the quiet row on every screen that has one", () => {
    expect(source).toContain("onSkip={() => setClosed(true)}");
    expect(source.match(/onNotNow=\{\(\) => setClosed\(true\)\}/g)).toHaveLength(2);
    // Screen 1 offers it to an owner from the start, and to anyone once a save has failed.
    expect(source).toContain('notNow={failed || (mode === "real" && !plan.required)}');
  });

  it("writes nothing when it closes: what ends the flow is the save, on the server", () => {
    for (const source of [code(CARD), code(SCREENS), code(GATE)]) {
      expect(source).not.toContain("sessionStorage");
      expect(source).not.toContain("document.cookie");
    }
    expect(code(CARD)).not.toContain("localStorage");
    expect(code(SCREENS)).not.toContain("localStorage");
    // The gate only reads the key prompt's flag.
    expect(code(GATE)).not.toContain("localStorage.setItem");
  });

  it("tells the gate when its exit has finished, and nothing before", () => {
    expect(source).toMatch(/onOpenChangeComplete=\{\(next\) => \{\s*if \(!next && opened\) onClosed\(\);\s*\}\}/);
    for (const gone of ["onReady", "onOpen(", "onClosing"]) expect(source).not.toContain(gone);
  });
});

describe("the card opens over the app", () => {
  const source = code(CARD);
  const popup = /<Dialog\.Popup\b[\s\S]*?>\n/.exec(source)?.[0] ?? "";

  it("dims and softly blurs the page behind it, with the backdrop the key prompt uses", () => {
    expect(imports(CARD)).toContain("./backdrop");
    expect(imports(KEY_PROMPT)).toContain("./backdrop");
    expect(source).toContain(
      '<Dialog.Backdrop className={cn(APP_BACKDROP, "duration-[240ms] data-ending-style:duration-[160ms]")} />',
    );
    expect(code(KEY_PROMPT)).toContain('<Dialog.Backdrop className={cn(APP_BACKDROP, "duration-[180ms]")} />');
    // Neither names a dim or a blur of its own beside it.
    for (const file of [CARD, KEY_PROMPT]) expect(code(file)).not.toMatch(/bg-black\/|backdrop-blur/);
  });

  it("puts the backdrop under the card, in the same portal", () => {
    expect(source).toMatch(/<Dialog\.Portal>\s*<Dialog\.Backdrop\b[^>]*\/>\s*<Dialog\.Viewport\b/);
  });

  it("fades the backdrop for as long as the card takes, in and out, so the two move as one", () => {
    expect(popup).toContain("transition-[opacity,scale] duration-[240ms]");
    expect(popup).toContain("data-ending-style:duration-[160ms]");
  });

  it("draws no ground of its own: no silk, no poster, no lockup, nothing from the sign-in page but the card", () => {
    expect(existsSync(new URL("./first-run-ground.tsx", import.meta.url))).toBe(false);
    for (const file of [CARD, SCREENS, GATE]) {
      const from = imports(file);
      expect(from.filter((name) => /login-|first-run-ground|\/liquid\/|tocker-mark/.test(name))).toEqual([]);
      for (const name of ["LoginBackdrop", "LoginSilk", "FirstRunGround", "TockerMark", "auth-bg", "auth-top", "auth-brand", "auth-shell", "<canvas"]) {
        expect(code(file), name).not.toContain(name);
      }
    }
    // Opaque black over the app is what the ground was.
    for (const file of [CARD, SCREENS, GATE]) expect(code(file)).not.toMatch(/\bbg-black\b(?!\/)/);
  });

  it("attaches the card's stylesheet itself: nothing else in the app does", () => {
    expect(imports(CARD)).toContain("@/components/auth/auth.css");
    expect(imports(GATE).filter((name) => name.endsWith(".css"))).toEqual([]);
  });

  it("sits under the app's top bar on a phone, and in the middle of the screen from 640px", () => {
    expect(source).toContain(
      'const VIEWPORT = "fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[72px] pb-4 sm:items-center sm:p-6";',
    );
    expect(source).toContain("<Dialog.Viewport className={VIEWPORT}>");
  });
});

describe("the backdrop", () => {
  const classes = APP_BACKDROP.split(" ");

  it("covers the page above the app's own chrome", () => {
    for (const part of ["fixed", "inset-0", "z-[100]"]) expect(classes).toContain(part);
  });

  it("dims by 40% and blurs by 8px, so the app is still recognisably there", () => {
    expect(classes).toContain("bg-black/40");
    // `backdrop-blur-sm` is 8px in this version of Tailwind.
    expect(classes).toContain("backdrop-blur-sm");
    expect(classes.filter((part) => /^bg-|^backdrop-/.test(part))).toEqual(["bg-black/40", "backdrop-blur-sm"]);
  });

  it("drops the blur and deepens the dim for less transparency and for more contrast", () => {
    for (const asked of ["[@media(prefers-reduced-transparency:reduce)]", "contrast-more"]) {
      expect(classes).toContain(`${asked}:bg-black/80`);
      expect(classes).toContain(`${asked}:backdrop-blur-none`);
    }
  });

  it("fades by opacity alone, on the dialog's starting and ending styles", () => {
    for (const part of ["transition-opacity", "data-starting-style:opacity-0", "data-ending-style:opacity-0"]) {
      expect(classes).toContain(part);
    }
    // How long is the caller's to say, beside its own panel's.
    expect(classes.filter((part) => part.includes("duration"))).toEqual([]);
  });
});

describe("the card is the sign-in page's own", () => {
  const popup = /<Dialog\.Popup\b[\s\S]*?>\n/.exec(code(CARD))?.[0] ?? "";

  it("takes its material from auth-card, with the fuller tint it needs over the app", () => {
    expect(popup).toContain('"auth-card auth-card-app flex max-h-full flex-col outline-none"');
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
    expect(popup).toContain("motion-safe:data-starting-style:scale-[0.96]");
    expect(popup).not.toMatch(/(?<!motion-safe:)data-(?:starting|ending)-style:scale/);
  });

  it("has no close button", () => {
    expect(code(CARD)).not.toContain("Dialog.Close");
    expect(code(SCREENS)).not.toContain("Dialog.Close");
  });

  it("draws the person through UserAvatar on the first screen too: the preview beside the field", () => {
    expect(code(SCREENS)).toMatch(/<UserAvatar\b[^>]*px=\{72\}[^>]*className="size-16 sm:size-\[72px\]"/);
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

describe("the gate", () => {
  const source = code(GATE);

  it("draws nothing before the card: the app is what is seen until the card's code has arrived", () => {
    // What it returns is the card behind its boundary, and the key prompt. Nothing else.
    expect(source).toMatch(
      /return \(\s*<>\s*\{run && !cardDone \? \(\s*<CardBoundary[\s\S]*?<\/CardBoundary>\s*\) : null\}\s*\{keyPrompt \? <KeyPrompt[^>]*\/> : null\}\s*<\/>\s*\);/,
    );
    expect(source).not.toMatch(/className=/);
  });

  it("holds nothing back while it waits: no key listener, no timer, no state for a ground", () => {
    for (const gone of ["addEventListener", "setTimeout", "keydown", "preventDefault", "useEffect", "useRef", "ground"]) {
      expect(source, gone).not.toContain(gone);
    }
  });

  it("loads the card only through next/dynamic, rendered on the server so it is asked for with the page", () => {
    expect(source).toContain('const FirstRun = dynamic(() => import("./first-run").then((mod) => mod.FirstRun));');
    expect(imports(GATE)).not.toContain("./first-run");
    expect(imports(GATE)).not.toContain("./first-run-screens");
  });

  it("loads the key prompt as it always did: in the browser only", () => {
    expect(source).toMatch(
      /const KeyPrompt = dynamic\(\(\) => import\("\.\/key-prompt"\)\.then\(\(mod\) => mod\.KeyPrompt\), \{\s*ssr: false,?\s*\}\);/,
    );
    expect(imports(GATE)).not.toContain("./key-prompt");
  });

  it("holds the card's code behind a boundary of its own, and leaves the app as it is if it never comes", () => {
    expect(source).toMatch(/<CardBoundary onError=\{dropCard\}>\s*<Suspense fallback=\{null\}>\s*<FirstRun\b/);
    expect(source).toContain("static getDerivedStateFromError()");
    expect(source).toContain("return this.state.failed ? null : this.props.children;");
  });

  it("takes the card out of the tree once it has closed, and starts nothing in its place", () => {
    expect(source).toContain("<FirstRun mode={run.mode} profile={run.profile} ownsAgent={ownedAgentCount > 0} onClosed={dropCard} />");
    expect(source).toContain("const dropCard = useCallback(() => setCardDone(true), []);");
    // The run stays latched: only the card is dropped.
    expect(source).not.toContain("setRun(null)");
    expect(source).toContain('started: run ? "first-run" : keyPrompt ? "key-prompt" : "nothing",');
  });

  it("is told who needs the screens by the server: strictly a null onboarded_at", () => {
    expect(code(LAYOUT)).toContain("needsOnboarding={session?.onboardedAt === null}");
    // No request made in the browser decides the first-run flow.
    expect(source).not.toContain("fetch(");
  });

  it("reads the same device flag the key prompt writes", () => {
    const key = /const STORAGE_KEY = "([^"]+)";/;
    expect(key.exec(GATE)?.[1]).toBe("tocker:onboarding-dismissed");
    expect(key.exec(KEY_PROMPT)?.[1]).toBe("tocker:onboarding-dismissed");
  });
});

describe("the card opens a frame after it mounts", () => {
  const source = code(CARD);

  it("once, by the first of a frame and a timer", () => {
    expect(source.match(/setOpened\(true\)/g)).toHaveLength(1);
    expect(source).toMatch(/if \(shown\.current\) return;\s*shown\.current = true;/);
    expect(source).toContain("const frame = requestAnimationFrame(show);");
    expect(source).toContain("const timer = window.setTimeout(show, OPEN_WITHOUT_A_FRAME_MS);");
  });

  it("remembers what had focus before it took it", () => {
    expect(source).toMatch(/returnFocus\.current = document\.activeElement instanceof HTMLElement \? document\.activeElement : null;\s*setOpened\(true\);/);
    expect(source).toContain('return document.getElementById("main");');
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

  it("keeps its own panel: solid, centred, with a close button", () => {
    expect(code(KEY_PROMPT)).toContain('<Dialog.Viewport className="fixed inset-0 z-[100] grid place-items-center p-4">');
    expect(code(KEY_PROMPT)).toContain("bg-card");
    expect(code(KEY_PROMPT)).toContain("<Dialog.Close");
  });
});

describe("what the card asks of the server", () => {
  it("is two actions, called from two files", () => {
    expect(imports(CARD)).toContain("@/server/actions/onboarding");
    expect(imports(read("./use-handle-check.ts"))).toContain("@/server/actions/onboarding");
    for (const pure of ["./first-run-screens.tsx", "./backdrop.ts", "./gate-decision.ts", "./onboarding-gate.tsx"]) {
      expect(imports(read(pure)).filter((from) => from.startsWith("@/server/"))).toEqual([]);
    }
  });

  it("refreshes the page and the whole query cache after a save, without waiting", () => {
    const source = code(CARD);
    expect(source).toContain("router.refresh();");
    expect(source).toContain("void queryClient.invalidateQueries();");
    expect(source).not.toMatch(/await\s+(?:router|queryClient)\./);
  });

  it("saves on the first screen only: the screens after it send nothing", () => {
    expect(code(CARD).match(/completeOnboarding\(/g)).toHaveLength(1);
    expect(code(SCREENS)).not.toContain("completeOnboarding");
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
