/**
 * The time limit of every route that runs an agent, against the figure a pay-per-use run
 * counts its clocks from.
 *
 * A pay-per-use run signs payments, and the platform ends a function at its `maxDuration`
 * whatever is in flight. So such a run is started only with most of its invocation left
 * and stops paying before the end, and all of that is arithmetic on one constant
 * (`RUN_ROUTE_MAX_DURATION_S`, 300). The run loop cannot see the limit a function really
 * has. If a route that runs an agent were given less, a paid run would still start in it
 * and would be cut off mid-payment.
 *
 * The routes cannot import the constant: Next takes `maxDuration` from a route's source
 * text at build time, and only a number written there (checked below against the copy of
 * Next that is installed). So the literal in each route and the constant are held
 * together here, by reading the files. Nothing is run and nothing is imported from a route.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_INVOCATION_REMAINING_MS, NO_NEW_STEP_AFTER_MS } from "@/lib/x402/inference-types";
import { INVOCATION_LIMIT_MS, INVOCATION_PAY_UNTIL_MS, RUN_ROUTE_MAX_DURATION_S, fitsInvocation } from "./inference";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/**
 * Every entry point whose function can start an agent's run, and how it does.
 *
 * A route handler has a `functions` entry in `vercel.json` as well. A page has none: a
 * server action takes its limit from the page it is called on, and the page says it.
 */
const RUNS_AN_AGENT = [
  { file: "src/app/api/cron/tick/route.ts", how: "the tick cron: every due agent's run", inVercelJson: true },
  { file: "src/app/api/agents/[id]/run/route.ts", how: "the run route: a run started from the go-live wizard", inVercelJson: true },
  { file: "src/app/(client)/(app)/agents/[slug]/page.tsx", how: "the agent page: Run now is the `triggerRun` server action", inVercelJson: false },
] as const;

/** Every source file under `src`, tests left out. */
function sources(dir = "src"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sources(file));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(file);
  }
  return out;
}

const files = sources();
/** The files whose code (comments left out) matches `pattern`. */
function filesWith(pattern: RegExp): string[] {
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return files.filter((file) => pattern.test(code(read(file)))).sort();
}

describe("the limit one invocation has", () => {
  it("is one figure: the routes' 300 seconds, and everything a paid run counts from it", () => {
    expect(RUN_ROUTE_MAX_DURATION_S).toBe(300);
    expect(INVOCATION_LIMIT_MS).toBe(RUN_ROUTE_MAX_DURATION_S * 1000);
    // It stops paying before the platform would stop it, and after its last step may start.
    expect(INVOCATION_PAY_UNTIL_MS).toBeLessThan(INVOCATION_LIMIT_MS);
    expect(INVOCATION_PAY_UNTIL_MS).toBeGreaterThan(NO_NEW_STEP_AFTER_MS);
    // A run is started only in what is left after the time it must have ahead of it.
    const startWindowMs = INVOCATION_LIMIT_MS - MIN_INVOCATION_REMAINING_MS;
    expect(startWindowMs).toBe(50_000);
    expect(fitsInvocation(0, startWindowMs)).toBe(true);
    expect(fitsInvocation(0, startWindowMs + 1)).toBe(false);
  });

  /**
   * The reason the routes repeat the number. If a later Next accepts a name here, the
   * routes should import the constant and this test should go.
   */
  it("cannot be imported by a route: Next reads `maxDuration` from the source text and takes a number only", () => {
    const extractor = read("node_modules/next/dist/build/analysis/extract-const-value.js");
    expect(extractor).toContain("isNumericLiteral(node)");
    expect(extractor).toContain('unsupported: `Unknown identifier "${node.value}"`');
    const staticInfo = read("node_modules/next/dist/build/analysis/get-page-static-info.js");
    expect(staticInfo).toContain("extractExportedConstValue)(ast, property)");
    expect(read("node_modules/next/dist/build/segment-config/app/app-segment-config.js")).toMatch(/maxDuration: _zod\.z\.number\(\)/);
  });
});

describe("every route that runs an agent", () => {
  it.each(RUNS_AN_AGENT)("$file says 300, as a number ($how)", ({ file }) => {
    const declared = /^export const maxDuration = (.+);\s*$/m.exec(read(file));
    expect(declared, `${file} has no \`export const maxDuration\``).not.toBeNull();
    // A number written out. Not a name, not a sum: Next would not read either.
    expect(declared?.[1], `${file}: a pay-per-use run started here counts its clocks from ${RUN_ROUTE_MAX_DURATION_S} s. With less, do not set INFERENCE_USDC (DEPLOY.md, "Agent runs and the 60-second cap").`).toBe(
      String(RUN_ROUTE_MAX_DURATION_S),
    );
  });

  it("has the same limit in vercel.json, where it is a route handler", () => {
    const vercel = JSON.parse(read("vercel.json")) as { functions?: Record<string, { maxDuration?: number }> };
    for (const route of RUNS_AN_AGENT) {
      if (!route.inVercelJson) continue;
      expect(vercel.functions?.[route.file]?.maxDuration, route.file).toBe(RUN_ROUTE_MAX_DURATION_S);
    }
    // No entry there gives any function that runs an agent a different limit.
    for (const [file, entry] of Object.entries(vercel.functions ?? {})) {
      if (RUNS_AN_AGENT.some((route) => route.file === file)) expect(entry.maxDuration, file).toBe(RUN_ROUTE_MAX_DURATION_S);
    }
  });

  /**
   * The list above is only worth something while it is whole. Each way a run can be
   * started is followed here from the run loop out to the files that reach it; a new
   * caller anywhere along the way fails this until its route is on the list with its 300.
   */
  it("is on that list: nothing else in the app can start a run", () => {
    // The run loop's two entry points, and the scheduler pass that uses one of them.
    expect(filesWith(/\b(startRun|runAgent)\(/)).toEqual(
      ["src/app/api/agents/[id]/run/route.ts", "src/lib/agent/run.ts", "src/lib/agent/scheduler.ts", "src/server/actions/agents.ts"].sort(),
    );
    expect(filesWith(/\btickDueAgents\b/)).toEqual(["src/app/api/cron/tick/route.ts", "src/lib/agent/scheduler.ts"].sort());
    // `triggerRun` is a server action: it runs in the function of the page that calls it.
    expect(filesWith(/\btriggerRun\b/)).toEqual(["src/components/agents/agent-actions.ts", "src/server/actions/agents.ts"].sort());
    expect(filesWith(/\btriggerRunAction\b/)).toEqual(["src/components/agents/agent-actions.ts", "src/components/agents/agent-header.tsx"].sort());
    expect(filesWith(/\bAgentHeader\b/)).toEqual(["src/app/(client)/(app)/agents/[slug]/page.tsx", "src/components/agents/agent-header.tsx"].sort());
  });
});
