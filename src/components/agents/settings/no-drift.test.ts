/**
 * Creating an agent and editing one are the same steps, drawn by the same code. That only
 * stays true while neither page draws a config control of its own, so the rule is checked
 * here, by reading the sources: the settings page imports no control, both pages take
 * their steps from the one registry inside the one shell, the form the settings page used
 * to be is gone, and no element id is written twice among the files the page now renders.
 * Nothing is run and nothing is imported from a component.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agents = join(process.cwd(), "src", "components", "agents");
const settingsDir = join(agents, "settings");
const builderDir = join(agents, "builder");

const read = (file: string) => readFileSync(file, "utf8");

/** Every import of a source file: the names it takes, as they are exported, and the module. */
function importsOf(source: string): Array<{ names: string[]; from: string }> {
  return [...source.matchAll(/import\s+(?:type\s+)?([^;]*?)\s+from\s+"([^"]+)"/g)].map(([, clause, from]) => {
    const braces = /\{([^}]*)\}/.exec(clause);
    const named = (braces?.[1] ?? "")
      .split(",")
      .map(
        (name) =>
          name
            .replace(/^\s*type\s+/, "")
            .trim()
            .split(/\s+as\s+/)[0],
      )
      .filter(Boolean);
    // What stands before the braces is a default or a namespace import.
    const rest = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
    return { names: rest ? [...named, rest] : named, from };
  });
}

/** Every literal `id="…"` in a component's source. */
function idsIn(source: string): string[] {
  return [...source.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
}

/** The components of a folder: its `.tsx` files, tests left out. */
function componentsIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
    .map((file) => join(dir, file));
}

/** The controls a config step is made of. Only a step body may draw one. */
const CONTROLS = [
  "RiskSlider",
  "Module",
  "ValueField",
  "Switch",
  "CustomChip",
  "Toggle",
  "Field",
  "UniverseControls",
  "ExecutionControls",
  "DataSourcePicker",
  "ExitRulesFields",
  "ModelPicker",
  "ProviderPicker",
  "PayPerUsePanel",
  "ThinkSourceChoice",
  "SizingControls",
  "SimpleSelect",
  "AddKeyInline",
  "Textarea",
];

/**
 * What those controls are built from. One of these in the page, or a bare form element,
 * would be a control drawn by hand, whatever it was called.
 */
const PRIMITIVES = ["Input", "Slider", "Select", "Label"];

/** The step bodies. A page gets them through the registry, never by name. */
const STEP_BODIES = ["IdentityStep", "StrategyStep", "UniverseStep", "DataStep", "RiskStep", "ScheduleStep", "ThinkStep"];

const HOSTS = {
  builder: join(builderDir, "agent-builder.tsx"),
  settings: join(settingsDir, "agent-settings.tsx"),
};

describe("the settings page draws no config control of its own", () => {
  const files = ["agent-settings.tsx", "agent-bar.tsx", "manage-step.tsx"].map((file) => join(settingsDir, file));

  it("reads the imports it is meant to check", () => {
    const names = importsOf(read(HOSTS.settings)).flatMap((entry) => entry.names);
    expect(names).toContain("AgentBar");
    expect(names).toContain("useAgentEdit");
    // A multi-line import, a type among values, and a default import are all read.
    const sample = importsOf('import Link from "next/link";\nimport {\n  A,\n  type B,\n  C as D,\n} from "./x";');
    expect(sample).toEqual([
      { names: ["Link"], from: "next/link" },
      { names: ["A", "B", "C"], from: "./x" },
    ]);
  });

  it.each(files)("%s imports none", (file) => {
    const names = importsOf(read(file)).flatMap((entry) => entry.names);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => CONTROLS.includes(name))).toEqual([]);
  });

  it.each(files)("%s writes no form element of its own", (file) => {
    const source = read(file);
    const names = importsOf(source).flatMap((entry) => entry.names);
    expect(names.filter((name) => PRIMITIVES.includes(name))).toEqual([]);
    expect(source.match(/<(input|textarea|select)[\s/>]/g) ?? []).toEqual([]);
  });

  it("would catch a control however it is imported", () => {
    const drawn = 'import { RiskSlider as Cap } from "@/components/agents/builder/field";\nimport { Input } from "@/components/ui/input";';
    const names = importsOf(drawn).flatMap((entry) => entry.names);
    expect(names.filter((name) => CONTROLS.includes(name))).toEqual(["RiskSlider"]);
    expect(names.filter((name) => PRIMITIVES.includes(name))).toEqual(["Input"]);
  });
});

describe("both pages draw their steps from the one registry, inside the one shell", () => {
  it.each(Object.entries(HOSTS))("the %s page imports ConfigPanels and StepShell", (_page, file) => {
    const imports = importsOf(read(file));
    const from = (name: string) => imports.find((entry) => entry.names.includes(name))?.from ?? null;
    expect(from("ConfigPanels")).toMatch(/(^|\/)step-registry$/);
    expect(from("StepShell")).toMatch(/(^|\/)step-shell$/);
  });

  it("neither imports a step body: the builder takes only its own last step's funding", () => {
    const fromSteps = (file: string) =>
      importsOf(read(file))
        .filter((entry) => /(^|\/)steps$/.test(entry.from))
        .flatMap((entry) => entry.names);
    expect(fromSteps(HOSTS.builder)).toEqual(["FundingStep"]);
    expect(fromSteps(HOSTS.settings)).toEqual([]);
    // Wherever it might be imported from, a body's name is in neither file.
    for (const file of Object.values(HOSTS)) {
      const names = importsOf(read(file)).flatMap((entry) => entry.names);
      expect(names.filter((name) => STEP_BODIES.includes(name)), file).toEqual([]);
    }
  });

  it("the registry is where the bodies are named", () => {
    const names = importsOf(read(join(builderDir, "step-registry.tsx"))).flatMap((entry) => entry.names);
    for (const body of STEP_BODIES) expect(names, body).toContain(body);
  });
});

describe("the form the settings page used to be", () => {
  it.each(["agent-settings-form.tsx", "money-strip.tsx", "hash-scroll.tsx"])("%s is gone", (file) => {
    expect(existsSync(join(settingsDir, file))).toBe(false);
  });

  it("is imported by nothing", () => {
    const page = join(process.cwd(), "src", "app", "(client)", "(app)", "agents", "[slug]", "settings", "page.tsx");
    const sources = [page, ...componentsIn(settingsDir), ...componentsIn(builderDir)];
    for (const file of sources) {
      const modules = importsOf(read(file)).map((entry) => entry.from);
      expect(modules.filter((from) => /(agent-settings-form|money-strip|hash-scroll)$/.test(from)), file).toEqual([]);
    }
  });
});

/**
 * The settings page renders element ids from two folders now: its own, and the builder's,
 * whose step bodies it draws. An id written in both, or twice in one, would be in the
 * document twice, and a label's `for` or an `aria-describedby` resolves to the first.
 */
describe("the element ids the settings page renders", () => {
  const declared = [settingsDir, builderDir, join(builderDir, "preview")]
    .flatMap(componentsIn)
    .flatMap((file) => idsIn(read(file)).map((id) => ({ id, file })));

  it("finds the ids it is meant to compare", () => {
    const ids = declared.map((entry) => entry.id);
    expect(ids).toContain("agent-name");
    expect(ids).toContain("risk-max-trade");
    expect(ids).toContain("withdraw-amount");
    expect(ids).toContain("agent-status-toggle");
    expect(ids).toContain("manage-withdraw");
  });

  it("are each written once across the settings folder and the builder", () => {
    const seen = new Map<string, string[]>();
    for (const { id, file } of declared) seen.set(id, [...(seen.get(id) ?? []), file.slice(agents.length + 1)]);
    const twice = [...seen].filter(([, files]) => files.length > 1).map(([id, files]) => `${id}: ${files.join(", ")}`);
    expect(twice).toEqual([]);
  });
});
