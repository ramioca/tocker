/**
 * The pay-per-use runbook against the code it describes.
 *
 * DEPLOY.md section 5 is what the owner follows to make the first real payment, with
 * their own money, by hand. A sentence in it that the code no longer bears out is a
 * command that does not run, a drill that cannot show what it promises, or a stage gate
 * that passes on nothing. Each test here pins one such sentence to the thing it is
 * about, so the page and the code cannot drift apart again without a test saying so.
 *
 * It reads files and compares text and constants. Nothing is run, no database is opened
 * and no network is touched.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { costsHint } from "@/components/money/cost-totals";
import { INVOCATION_LIMIT_MS, INVOCATION_PAY_UNTIL_MS, PAYMENT_IN_FLIGHT_MS, RUN_ROUTE_MAX_DURATION_S } from "@/lib/agent/inference";
import { BREAKER_RULES, HOLD_SWITCH_MINUTES } from "@/lib/x402/inference-budget";
import { GIVE_UP_AFTER_MS, LATE_LOOK_MS, RECONCILE_LIMITS } from "@/lib/x402/inference-reconcile";
import {
  AGENT_DAY_REQUESTS,
  DEFAULT_OWNER_DAY_USD,
  DEFAULT_PLATFORM_DAY_USD,
  HARD_STEP_CAP_USD,
  INFERENCE_GATEWAY,
  MAX_PAID_STEPS,
  MIN_INVOCATION_REMAINING_MS,
  NO_NEW_STEP_AFTER_MS,
  OWNER_DAY_MANUAL_RUNS,
  PAID_TIMEOUT_MS,
  QUOTE_TIMEOUT_MS,
  SIGN_MIN_REMAINING_MS,
  SIGN_TIMEOUT_MS,
  USDC_DEFAULT_INTERVAL_MINUTES,
  WALLET_FLOOR_USD,
  describeInferenceStop,
} from "@/lib/x402/inference-types";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
/** Line wraps and table padding are not part of a sentence. */
const flat = (text: string) => text.replace(/\s+/g, " ");

const deploy = read("DEPLOY.md");
const start = deploy.indexOf("## 5. Pay-per-use thinking");
const end = deploy.indexOf("\n## Notes");
/** Section 5, as written and with its whitespace collapsed. */
const section = deploy.slice(start, end);
const text = flat(section);
const envExample = read(".env.example");
const HOUR = 3_600_000;

/** The part of the section between two of its stage headings. */
function stage(n: number): string {
  const from = section.indexOf(`**Stage ${n}.`);
  const next = section.indexOf(`**Stage ${n + 1}.`, from);
  const until = next === -1 ? section.indexOf("### How to stop it") : next;
  return section.slice(from, until);
}

describe("the section", () => {
  it("is found whole", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    for (const n of [0, 1, 2, 3, 4]) expect(stage(n).length, `stage ${n}`).toBeGreaterThan(100);
  });
});

describe("every environment variable the runbook names", () => {
  /** The names the code reads: the switches in the contract, and the gated test's own. */
  const inCode = new Set<string>();
  for (const file of ["src/lib/x402/inference-types.ts", "src/lib/x402/inference-ledger.concurrency.test.ts"]) {
    for (const match of read(file).matchAll(/env\.(INFERENCE_[A-Z_]+)/g)) inCode.add(match[1]);
  }
  const named = (source: string) => new Set([...source.matchAll(/\bINFERENCE_[A-Z_]+\b/g)].map((match) => match[0]));

  it("is one the code reads, and every one the code reads is named", () => {
    expect([...inCode].sort()).toEqual([
      "INFERENCE_CONCURRENCY_DATABASE_URL",
      "INFERENCE_MAX_STEP_USD",
      "INFERENCE_OWNER_DAILY_USD",
      "INFERENCE_PLATFORM_DAILY_USD",
      "INFERENCE_USDC",
      "INFERENCE_USDC_USER_IDS",
    ]);
    expect([...named(section)].sort()).toEqual([...inCode].sort());
    expect([...named(envExample)].sort()).toEqual([...inCode].sort());
  });

  it("has the default the code gives it", () => {
    expect(text).toContain(`| \`INFERENCE_MAX_STEP_USD\` | environment | \`${HARD_STEP_CAP_USD}\` |`);
    expect(text).toContain(`| \`INFERENCE_OWNER_DAILY_USD\` | environment | \`${DEFAULT_OWNER_DAY_USD}\` |`);
    expect(text).toContain(`| \`INFERENCE_PLATFORM_DAILY_USD\` | environment | \`${DEFAULT_PLATFORM_DAY_USD}\` |`);
    expect(text).toContain(`| Requests per agent per day | code | ${AGENT_DAY_REQUESTS} |`);
    expect(text).toContain(`| Runs started by hand, per account per day | code | ${OWNER_DAY_MANUAL_RUNS} |`);
    expect(text).toContain(`at most ${MAX_PAID_STEPS}, plus one to wrap up`);
    expect(text).toContain(`| Wallet floor | code | \`$${WALLET_FLOOR_USD.toFixed(2)}\` |`);
    expect(text).toContain(`| Schedule a new pay-per-use agent starts on | code | ${USDC_DEFAULT_INTERVAL_MINUTES} minutes |`);
    expect(text).toContain(INFERENCE_GATEWAY.solana.url);
    expect(text).toContain(INFERENCE_GATEWAY.solana.payTo[0]);
  });
});

describe("every command the runbook gives", () => {
  it("runs a script that exists, through pnpm, and never from an env file", () => {
    const scripts = [...section.matchAll(/scripts\/[a-z-]+\.ts/g)].map((match) => match[0]);
    expect(new Set(scripts)).toEqual(new Set(["scripts/inference-quote.ts", "scripts/inference-audit.ts"]));
    for (const script of scripts) expect(existsSync(path.join(ROOT, script)), script).toBe(true);
    // `tsx` alone is not on PATH: every invocation goes through pnpm.
    const invocations = [...section.matchAll(/(\S+) tsx /g)];
    expect(invocations.length).toBeGreaterThanOrEqual(2);
    for (const match of invocations) expect(match[1].replace(/^`/, ""), match[0]).toBe("pnpm");
    // A local .env carries X402_MOCK=1 and the public RPC, and an env file fills in
    // whatever the shell leaves unset: the audit would refuse to run, or audit the wrong
    // database.
    expect(section).not.toMatch(/tsx --env-file/);
  });

  it("writes the audit command whole, with the three values it needs and arguments the script parses", () => {
    const command = section.split("\n").find((line) => line.includes("scripts/inference-audit.ts") && line.includes("pnpm tsx"));
    expect(command).toBeDefined();
    expect(command).toMatch(/^\s+X402_MOCK=0 DATABASE_URL=<[^>]+> SOLANA_RPC_URL=<[^>]+> pnpm tsx scripts\/inference-audit\.ts <agent slug> --hours 24$/);
    const audit = read("scripts/inference-audit.ts");
    // What the runbook says of it: it parses --hours, refuses mock mode, needs an RPC,
    // and its three exit codes.
    expect(audit).toContain('arg === "--hours"');
    expect(audit).toContain('process.env.X402_MOCK === "1"');
    expect(audit).toContain("process.env.SOLANA_RPC_URL");
    expect(audit).toContain("hours > 24 * 31");
    expect(text).toContain("`--hours` takes up to 744");
    expect(audit).toContain('"No differences."');
    expect(text).toContain("it prints `No differences.`");
    expect(audit).toContain("result.differences.length === 0 ? 0 : 1");
  });

  it("gives the concurrency test's own command, on a database that is not production", () => {
    const file = "src/lib/x402/inference-ledger.concurrency.test.ts";
    expect(existsSync(path.join(ROOT, file))).toBe(true);
    const source = read(file);
    expect(source).toContain("process.env.INFERENCE_CONCURRENCY_DATABASE_URL");
    expect(source).toMatch(/describe\.skipIf\(!url\)/);
    const command = section.split("\n").find((line) => line.includes("pnpm vitest run") && line.includes(file));
    expect(command).toMatch(/^\s+INFERENCE_CONCURRENCY_DATABASE_URL=<[^>]+> pnpm vitest run /);
    expect(text).toContain("**not production**");
  });
});

describe("the limits under real concurrency", () => {
  it("are said to be proven on the test database only, with the real-Postgres test a step of stage 1", () => {
    const one = flat(stage(1));
    expect(one).toContain("proven on the test database only");
    expect(one).toContain("src/lib/x402/inference-ledger.concurrency.test.ts");
    expect(one).toContain("has never been run");
    expect(one).toContain("do not go to stage 2");
    expect(one).toMatch(/Go on only when .* the concurrency test passes\./);
    // And not left for a later stage, after the first real payments.
    expect(flat(stage(3))).toContain("The concurrency test belongs to stage 1 and must already have passed");
    expect(text).toContain("it must pass before stage 2");
  });
});

describe("the third cron", () => {
  it("is in vercel.json, and the fallback scheduler calls it too", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }>; functions: Record<string, unknown> };
    const cron = vercel.crons.find((entry) => entry.path === "/api/cron/inference");
    expect(cron).toBeDefined();
    expect(text).toContain(`\`/api/cron/inference\` at \`${cron!.schedule}\``);
    expect(vercel.functions["src/app/api/cron/inference/route.ts"]).toBeDefined();

    expect(read(".github/workflows/cron.yml")).toContain("$APP_URL/api/cron/inference");
    expect(text).toContain("`.github/workflows/cron.yml`, **calls it too**");
    // The sentence that used to tell the owner to add a call that is already there.
    expect(text).not.toMatch(/cron\.yml`\) and `pnpm tick` do not call it/);
  });

  it("is not called by the local loop, and the runbook says so", () => {
    expect(read("scripts/tick.ts")).not.toContain("/api/cron/inference");
    expect(text).toContain("`pnpm tick` (the local loop) does **not**");
  });
});

describe("the payment packages", () => {
  const dependencies = (JSON.parse(read("package.json")) as { dependencies: Record<string, string> }).dependencies;
  const onThePayPath = ["@x402/core", "@x402/svm", "@solana/kit", "@solana/web3.js", "@privy-io/node"];

  it("are pinned to exact versions, which is what the runbook says and why it says it", () => {
    for (const name of [...onThePayPath, "@x402/fetch", "@x402/evm"]) {
      expect(dependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
      expect(text, name).toContain(`\`${name}\``);
    }
    expect(text).toContain("**The payment packages are pinned to exact versions**");
    expect(text).toContain("decodes the signed Solana transaction byte by byte before anything is sent");
    // Not a job left for the owner before stage 3: it is already done.
    expect(text).not.toMatch(/pin exact versions of/);
  });
});

describe("the schema paragraph", () => {
  it("counts the new columns as the migration has them, the two NOT NULL ones by name", () => {
    const migration = read("drizzle/0010_tearful_monster_badoon.sql");
    const added = [...migration.matchAll(/ALTER TABLE "(\w+)" ADD COLUMN "(\w+)" ([^;]+);/g)];
    expect(added).toHaveLength(9);
    const notNull = added.filter((match) => match[3].includes("NOT NULL")).map((match) => `${match[1]}.${match[2]}`);
    expect(notNull.sort()).toEqual(["agent_runs.inference_spend_usd", "agents.inference_strikes"]);
    expect(text).toContain("nine new columns");
    expect(text).toContain("Seven are nullable");
    for (const column of notNull) expect(text).toContain(`\`${column}\``);
    expect(text).not.toContain("new nullable columns");
  });
});

describe("the RPC the pay path rests on", () => {
  it("is not said to be checked: only an empty value is refused, and the shipped value is the public endpoint", () => {
    const shipped = /^SOLANA_RPC_URL=(\S+)$/m.exec(envExample)?.[1];
    expect(shipped && new URL(shipped).hostname).toBe("api.mainnet-beta.solana.com");
    // The check before a run asks one thing of it: that it is not empty.
    expect(read("src/lib/agent/inference-gate.ts")).toMatch(/!rpcUrl\)\s*return stop\("no_rpc"/);

    expect(text).not.toContain("without it nothing is signed");
    expect(text).toContain("the code does not check that it is");
    expect(text).toContain("payments **are** signed");
    expect(text).toContain(`"${describeInferenceStop("no_rpc").title}"`);
    expect(flat(stage(1))).toContain("**Check `SOLANA_RPC_URL` in production.**");
    expect(flat(stage(1))).toContain("not `https://api.mainnet-beta.solana.com`");

    const example = flat(envExample.replace(/^# ?/gm, ""));
    expect(example).not.toContain("without them nothing is signed");
    expect(example).toContain("The code only refuses an EMPTY SOLANA_RPC_URL");
    expect(example).toContain("payments ARE signed");
  });
});

describe("stage 2", () => {
  const two = flat(stage(2));

  it("does its two drills in an order in which both messages can appear", () => {
    // Why the order matters: the check before a run looks at the halt before the wallet.
    const gate = read("src/lib/agent/inference-gate.ts");
    const check = gate.slice(gate.indexOf("export async function preflightInference"));
    const looksAtHalt = check.indexOf("controlStop(");
    const looksAtWallet = check.indexOf('stop("needs_funds"');
    expect(looksAtHalt).toBeGreaterThan(0);
    expect(looksAtWallet).toBeGreaterThan(looksAtHalt);

    const halt = two.indexOf("**The halt.**");
    const clear = two.indexOf("**Clear it and prove the agent pays again.**");
    const empty = two.indexOf("**The empty wallet.**");
    const refund = two.indexOf("**First send the wallet USDC again**");
    expect(halt).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(halt);
    expect(empty).toBeGreaterThan(clear);
    expect(refund).toBeGreaterThan(empty);
    // The words the owner is told to look for are the ones the app prints.
    expect(two).toContain(`"${describeInferenceStop("halted").title}"`);
    expect(two).toContain(`"${describeInferenceStop("needs_funds").title}"`);
    const controls = read("src/components/admin/inference-controls.tsx");
    for (const label of ["Halt pay-per-use", "Clear the halt", "Yes, let payments resume"]) {
      expect(controls, label).toContain(label);
      expect(two, label).toContain(`**${label}**`);
    }
  });

  it("cannot pass its soak with nothing paid", () => {
    expect(two).toContain("the audit passes on nothing");
    expect(two).toMatch(/its `Ledger` line counts at least \d+ rows for the 24 hours/);
    expect(read("scripts/inference-audit.ts")).toContain("`Ledger   ${rows.length} rows");
    expect(two).toContain("no row marked \"no verdict in time\"");
    expect(read("src/components/admin/inference-card.tsx")).toContain("no verdict in time");
  });

  it("asks for the one figure this feature changes in public to be looked at", () => {
    expect(two).toContain("**the agent's all-time P&L has not moved by what the run paid**");
  });

  it("does not speak of an `--env-file` form the audit script's usage line no longer shows", () => {
    const usage = /const USAGE = "([^"]+)";/.exec(read("scripts/inference-audit.ts"))?.[1];
    expect(usage).toBe("usage: pnpm tsx scripts/inference-audit.ts <agent id | agent slug | wallet address> [--hours 24]");
    expect(usage).not.toContain("--env-file");
    expect(section).not.toContain("--env-file");
  });

  it("sends the owner to the function that really ran the agent for a run started with Run now", () => {
    // Run now on the agent page is a server action, served by the page's own function.
    const header = read("src/components/agents/agent-header.tsx");
    expect(header).toContain("triggerRunAction(agent.id)");
    expect(header).not.toContain("/api/agents/");
    expect(read("src/components/agents/agent-actions.ts")).toMatch(/^"use server";/);
    // Only the go-live wizard calls the run route.
    expect(read("src/components/live/live-wizard.tsx")).toContain("fetch(`/api/agents/${agent.id}/run`");

    expect(two).toContain("searching the Vercel function logs for `[inference] run`");
    expect(two).toContain("`/api/cron/tick` for a scheduled run");
    expect(two).toContain("the agent's own page, `/agents/<slug>`, for a run started with **Run now**");
    expect(two).toContain("Only a run started from the go-live wizard is under `/api/agents/[id]/run`");
    // The sentence that sent every Run now to the run route.
    expect(two).not.toContain("or the run route for a run started by hand");
  });

  it("points at the log line the pay path writes at `owner`, in the form it writes it", () => {
    const fetch = read("src/lib/x402/inference-fetch.ts");
    expect(fetch).toMatch(/stage === "owner"\)\s*noteGatewayHeaders\(/);
    expect(fetch).toContain("[inference] run ${runId}: paid response ${status} said ");
    expect(fetch).toContain("; read as ${read}");
    expect(section).toContain("[inference] run <run id>: paid response <HTTP status> said <header>=<value> ...; read as <verdict>");
    for (const verdict of ["this payment's transaction id, settled", "not settled", "no proof of settlement"]) {
      expect(fetch, verdict).toContain(`"${verdict}"`);
      expect(two, verdict).toContain(`\`${verdict}\``);
    }
    expect(fetch).toContain('"nothing about the payment or the model"');
    expect(two).toContain('"nothing about the payment or the model"');
    expect(two).toContain("At `owner`, and only at `owner`");
  });
});

describe("stage 3", () => {
  it("says what a user id is and where to find one", () => {
    const three = flat(stage(3));
    expect(three).toContain("did:privy:");
    expect(three).toContain("`users.id`");
    expect(three).toContain("select id from users where handle = '<their handle>';");
  });
});

describe("stage 4", () => {
  const four = flat(stage(4));
  const scheduler = read("src/lib/agent/scheduler.ts");

  /**
   * The scheduler says, in its own comment, that it has a ceiling to lift before
   * pay-per-use is open to everyone, and that this page carries it. The page used to say
   * only "set INFERENCE_USDC=on". Followed as written, that opened the feature with the
   * ceiling in place, and past about sixty hourly pay-per-use agents no agent on a key
   * was picked any more.
   */
  it("makes lifting the scheduler's ceiling a step of its own, before the switch", () => {
    expect(scheduler).toContain("A KNOWN LIMIT, left as it is on purpose.");
    expect(scheduler).toMatch(/\(DEPLOY\.md, stage 4, where lifting it is step 1, before the switch\)/);

    const lift = four.indexOf("1. **Before the switch: lift the scheduler's ceiling.**");
    const on = four.indexOf("2. **Then the switch.** `INFERENCE_USDC=on`");
    expect(lift).toBeGreaterThan(0);
    expect(on).toBeGreaterThan(lift);
    expect(four).toContain("`INFERENCE_USDC=on` is not set until it has shipped");
    // Nowhere in the stage is the switch set before that step.
    expect(four.slice(0, lift)).not.toContain("INFERENCE_USDC=on");
  });

  it("says what the ceiling is in the scheduler's own figures, and the two ways out it names", () => {
    const batch = Number(/^const BATCH_SIZE = (\d+);$/m.exec(scheduler)?.[1]);
    expect(batch).toBe(5);
    expect(four).toContain("**at most five pay-per-use runs start in one pass of `/api/cron/tick`**");
    expect(four).toContain("sixty an hour");
    expect((INVOCATION_LIMIT_MS - MIN_INVOCATION_REMAINING_MS) / 1000).toBe(50);
    expect(four).toContain("only in the first fifty seconds of its invocation");
    expect(four).toContain("`tickDueAgents` in `src/lib/agent/scheduler.ts`");
    // The default pass is one batch: where the route reads its size from.
    expect(read("src/app/api/cron/tick/route.ts")).toContain("process.env.CRON_MAX_AGENTS");
    expect(four).toContain("`CRON_MAX_AGENTS`");

    for (const [inCode, onPage] of [
      ["take no more than `BATCH_SIZE` pay-per-use agents into a", "take no more than five pay-per-use agents into a pass"],
      ["run the pay-per-use batch alongside the first key batch", "run the pay-per-use batch alongside the first batch of key agents"],
    ]) {
      expect(flat(scheduler.replace(/^\s*\* ?/gm, "")), inCode).toContain(inCode);
      expect(four, onPage).toContain(onPage);
    }
    expect(four).toContain("it cannot be reached while only the owner is switched on");
    // Stage 3 is told it already applies.
    expect(flat(stage(3))).toContain("the scheduler's ceiling described under stage 4 already applies");
  });
});

describe("a function with less than 300 seconds", () => {
  const whole = flat(deploy);

  /**
   * The page used to say a pay-per-use run "never starts" on a 60-second function. The
   * code measures against a constant and cannot see the function's real limit: such a
   * run would start, pay, and be frozen mid-step.
   */
  it("is said to be somewhere pay-per-use must stay off, because the code cannot see the limit", () => {
    expect(whole).not.toContain("On a 60s function it therefore never starts");
    expect(whole).toContain("**Do not set `INFERENCE_USDC` on a deployment where any function that runs an agent has less than 300 seconds.**");
    expect(whole).toContain("The code cannot see the limit a function really has.");
    expect(whole).toContain("the run would therefore still **start**");

    expect(RUN_ROUTE_MAX_DURATION_S).toBe(300);
    expect(whole).toContain("300 seconds (`RUN_ROUTE_MAX_DURATION_S` in `src/lib/agent/inference.ts`)");
    expect(whole).toContain(`a run is started only while ${MIN_INVOCATION_REMAINING_MS / 1000} of those seconds remain, and it stops paying at ${INVOCATION_PAY_UNTIL_MS / 1000}`);
    expect(whole).toContain(`in the first ${(INVOCATION_LIMIT_MS - MIN_INVOCATION_REMAINING_MS) / 1000} seconds`);
  });

  it("names the three files that run an agent, each of which says 300 as a number, and the test that holds them to it", () => {
    for (const file of ["src/app/api/cron/tick/route.ts", "src/app/api/agents/[id]/run/route.ts", "src/app/(client)/(app)/agents/[slug]/page.tsx"]) {
      expect(whole, file).toContain(`\`${file}\``);
      expect(read(file), file).toMatch(/^export const maxDuration = 300;$/m);
    }
    expect(whole).toContain("`src/lib/agent/invocation-limit.test.ts`");
    expect(existsSync(path.join(ROOT, "src/lib/agent/invocation-limit.test.ts"))).toBe(true);
  });
});

describe("the wallet's own limit", () => {
  it("is said to hold an agent, in the app's words, when it is below the price of a step", () => {
    const said = describeInferenceStop("wallet_limit_low");
    expect(text).toContain(`"${said.title}" (\`wallet_limit_low\`)`);
    expect(text).toContain("its run is not started at all");
    expect(text).toContain("it adds nothing to the signature breaker's count");
    expect(read("src/lib/agent/inference-gate.ts")).toContain('return stop("wallet_limit_low"');
    // What the page says keeps it at a dollar or more, and what does not.
    expect(read("src/components/agents/builder/types.ts")).toContain("maxTradeUsd: { min: 1,");
    expect(read("src/server/actions/wallets.ts")).toContain("perTxUsd < 1");
    expect(read("src/lib/agent/config.ts")).toContain("maxTradeUsd: z.number().positive()");
    expect(text).toContain("all keep that at `$1` or more");
    expect(text).toContain("the server accepts any positive trade size");
    expect(text).toContain(`well above the \`$${HARD_STEP_CAP_USD.toFixed(2)}\` a step may cost`);
  });
});

describe("clearing the halt", () => {
  it("is said to be refused, in the server's own words, when the reason is no longer the one the page showed", () => {
    const refusal = "The reason changed since this page was loaded. Reload and read it before clearing.";
    expect(read("src/lib/x402/inference-ledger.ts")).toContain(`"${refusal}"`);
    expect(text).toContain(`("${refusal}")`);
    expect(text).toContain("the halt stays on and nothing is acknowledged");
    expect(flat(stage(2))).toContain('"The reason changed since this page was loaded"');
  });
});

describe("the known limits", () => {
  const from = section.indexOf("### Known limits, left as they are on purpose");
  const limits = flat(section.slice(from, section.indexOf("### What is NOT proven until real funds move")));

  it("are listed, with the three things left open on purpose among them", () => {
    expect(from).toBeGreaterThan(0);
    for (const heading of [
      "**Only the first batch of a pass runs pay-per-use agents.**",
      "**The hold-back is one figure for both chains.**",
      "**A schedule expected to cost more than the daily limit is refused by the form, and only by the form.**",
    ]) {
      expect(limits, heading).toContain(heading);
    }
  });

  it("each rests on what the code says of itself", () => {
    // First-batch-only scheduling: the scheduler's own comment.
    expect(read("src/lib/agent/scheduler.ts")).toContain("In practice only the first batch of a pass");
    expect(limits).toContain("lifting it is step 1 of stage 4");
    // The two-chain reserve: the book's own header, and the sentence the owner is shown.
    expect(read("src/lib/agent/portfolio.ts")).toContain("A known gap, for an agent that trades Solana AND Base");
    expect(limits).toContain(`"${describeInferenceStop("needs_funds").title}"`);
    // The daily estimate: refused where the form checks, and stated not to be on the server.
    expect(read("src/components/agents/thinking.ts")).toContain("if (estimate.model && dayOk && dayOverLimit(estimate, usdc))");
    const server = read("src/lib/agent/inference.ts");
    expect(server).toContain("One refusal the settings form makes is NOT made here");
    expect(server.slice(server.indexOf("export function usdcChoiceProblem"), server.indexOf("function runLimitUsd"))).not.toContain("estimateDayUsd");
    expect(limits).toContain("The server makes no such check");
    expect(limits).toContain("enforced whatever was saved, when each payment is reserved");
  });
});

describe("when a payment is netted", () => {
  it("is said as the code dates it: when it was resolved, within two minutes of its signature, and never across a mark", () => {
    expect(PAYMENT_IN_FLIGHT_MS).toBe(2 * 60_000);
    expect(text).toContain("A payment's flow is dated when its step was **resolved**");
    expect(text).toContain("never later than two minutes after the signature");
    expect(text).toContain("**no mark is written for a live pay-per-use agent while one of its paid steps is in flight**");
    expect(text).toContain("A payment signed at or before the book's first live mark is never a flow at all.");
    const queries = read("src/server/queries/_shared.ts");
    expect(queries).toContain("export function thinkingFlowAtSql()");
    expect(queries).toContain("const paidAt = thinkingFlowAtSql();");
    expect(queries).toContain("sql`${signedAt} > ${payers.firstAt}`");
    const book = read("src/lib/agent/portfolio.ts");
    expect(book).toContain("async function paidStepInFlight(");
    expect(book).toContain("await paidStepInFlight(portfolio.agentId, portfolio.cashReadAt)");
    // What it still rests on is said, with where to change it.
    expect(text).toContain("**What the timing of a mark still takes on trust.**");
    expect(text).toContain("`paidStepInFlight` (`src/lib/agent/portfolio.ts`)");

    const spec = flat(read("SPEC.md"));
    expect(spec).toContain("dated when it was resolved, never later than two minutes after its signature (`thinkingFlowAtSql`)");
    expect(spec).toContain("`snapshotEquity` writes no mark for a live pay-per-use agent while one of its paid steps is in flight");
  });
});

describe("the figures the runbook quotes", () => {
  it("are the breakers' own", () => {
    const { unanswered, gateway, signature, pin_mismatch: pin } = BREAKER_RULES;
    expect(text).toContain(
      `${unanswered.rows} steps paid (or maybe paid) with no answer, from ${unanswered.owners} or more accounts, in ${unanswered.windowMinutes} minutes: ${unanswered.pauseMinutes} minutes.`,
    );
    // Accounts, as the rule counts them. It used to say agents.
    expect(text).not.toContain("or more agents");
    expect(gateway).toEqual(signature);
    expect(text).toContain(
      `${gateway.failures} gateway failures or ${signature.failures} signature failures, from ${gateway.owners} or more accounts, in ${gateway.windowMinutes} minutes: ${gateway.pauseMinutes} minutes.`,
    );
    // The sentence that let one account pause everyone through five failed signatures.
    expect(text).not.toMatch(/signature failures in \d+ minutes/);
    expect(pin.failures).toBe(1);
    expect("owners" in pin).toBe(false);
    expect(text).toContain(`Any pin mismatch, from anyone: ${pin.pauseMinutes} minutes.`);
    expect(text).toContain(`look again by themselves every ${HOLD_SWITCH_MINUTES} minutes`);
  });

  it("say one account cannot pause everyone, which is true of every rule that counts accounts", () => {
    for (const rule of [BREAKER_RULES.unanswered, BREAKER_RULES.gateway, BREAKER_RULES.signature]) {
      expect(rule.owners).toBeGreaterThanOrEqual(2);
    }
    expect(text).toContain("Accounts, not agents, in all three");
    expect(text).toContain("so one account cannot pause everyone");
    expect(text).toContain("while only one account is switched on (stage 2) none of the three can trip");
    expect(text).toContain("five such stops, from at least two accounts");
    expect(BREAKER_RULES.signature.failures).toBe(5);
    expect(flat(stage(3))).toContain("can now trip, which they could not with one account");

    const spec = flat(read("SPEC.md"));
    expect(spec).toContain("the unanswered-steps, gateway and signature breakers each need their events to come from at least two accounts");
    expect(spec).not.toContain("the unanswered-steps breaker counts accounts, not agents, so one owner cannot pause everyone");
  });

  it("are the reconciler's own", () => {
    expect(GIVE_UP_AFTER_MS).toBe(6 * HOUR);
    expect(text).toContain("Neither within six hours");
    expect(LATE_LOOK_MS).toBe(7 * 24 * HOUR);
    expect(text).toContain("until it is seven days old");
    expect(text).toContain(`at most ${RECONCILE_LIMITS.rows} rows, ${RECONCILE_LIMITS.rpcCalls} RPC calls and one minute`);
    expect(RECONCILE_LIMITS.deadlineMs).toBe(60_000);
  });

  it("are the pay path's own clocks", () => {
    const markSigned = /const MARK_SIGNED_TIMEOUT_MS = (\d+)_000;/.exec(read("src/lib/x402/inference-fetch.ts"))?.[1];
    expect(markSigned).toBeDefined();
    expect(text).toContain(
      `no new step after ${NO_NEW_STEP_AFTER_MS / 1000} s; no signature with under ${SIGN_MIN_REMAINING_MS / 1000} s left; ${QUOTE_TIMEOUT_MS / 1000} s for a quote (two free retries), ${SIGN_TIMEOUT_MS / 1000} s for the signature, ${markSigned} s for the ledger to record it, ${PAID_TIMEOUT_MS / 1000} s for the paid request`,
    );
    expect(text).toContain(`which is given ${markSigned} seconds to do it`);
  });
});

describe("what the runbook says of the Money page and of P&L", () => {
  it("quotes the Costs heading as the page prints it, with and without pay-per-use", () => {
    expect(text).toContain(`"${costsHint("live", false)}"`);
    expect(text).toContain(`"${costsHint("live", true).replace(/, only one of which we collect\.$/, "")}"`);
    // It used to say the heading still read three with pay-per-use on the page.
    expect(text).not.toContain("with pay-per-use there are four");
  });

  it("says a payment is netted only once it is proven, and what proof is", () => {
    expect(text).toContain("**A payment is netted only once it is proven**");
    expect(text).toContain("a `paid_no_answer` row, or a `settled` row that carries its transaction id");
    expect(text).toContain("A `not_charged` row");
    expect(text).toContain("is never netted and never shown as paid");
    // The one thing still taken on the gateway's word is said, not left to be found.
    expect(text).toContain("**That a transaction the gateway says it settled did land.**");

    const spec = flat(read("SPEC.md"));
    expect(spec).toContain("a `paid_no_answer` row, or a `settled` row whose `tx_hash` is set");
    expect(spec).not.toContain("netted only once the ledger holds it as paid (`settled`, `paid_no_answer`)");
    expect(spec).toContain("**`settled` means answered, not proven paid.**");
  });

  it("says whose wallets the admin signature test signs with", () => {
    expect(text).toContain("**only the wallets of the admin's own agents**");
    expect(flat(stage(1))).toContain("The list offers only the Solana wallets of **your own** agents, and the server refuses any other");
    expect(flat(read("SPEC.md"))).toContain("only the Solana wallets of the admin's **own** agents");
  });
});
