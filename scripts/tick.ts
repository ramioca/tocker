/**
 * Local scheduler: `pnpm tick`.
 *
 * Calls the running app's two cron routes as Vercel Cron does in production:
 * `/api/cron/marks` first (cheap — marks, peaks, the exit engine, equity snapshots) and
 * then `/api/cron/tick` (the LLM runs), so a position that has blown through its stop is
 * closed before the model is asked what it thinks.
 *
 * The loop wakes every 60 seconds and calls marks each time. It calls tick only once
 * five minutes have gone by since its last tick call began, which is the cron's own
 * spacing. An agent is due a minute short of its interval, so that the cron finds it
 * wherever in its minute it fires (`src/lib/agent/schedule.ts`); a tick every minute
 * found it in that minute every time, and "every 5 min" ran every four.
 *
 * Going over HTTP (rather than importing the scheduler) means only the dev server ever
 * opens the database, which the embedded PGlite requires: a second process on the same
 * data directory silently loses writes. Run it next to `pnpm dev`.
 */
import { PASS_EVERY_MINUTES, passIsDue } from "../src/lib/agent/schedule";

const INTERVAL_MS = 60_000;
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET?.trim();

interface TickResponse {
  ok?: boolean;
  error?: string;
  due?: number;
  results?: Array<{ agentId: string; status: string; summary?: string; error?: string }>;
}

interface MarksResponse {
  ok?: boolean;
  error?: string;
  active?: number;
  guarded?: number;
  exits?: number;
  snapshots?: number;
  agents?: Array<{
    agentId: string;
    positions: number;
    note: string | null;
    exits: Array<{ symbol: string; reason: string; status: string; amountUsd: number }>;
    skipped: Array<{ symbol: string; reason: string }>;
    error: string | null;
  }>;
}

function stamp(): string {
  return new Date().toISOString();
}

/** GETs a cron route with the bearer secret. Returns null when the app is unreachable. */
async function call<T>(path: string): Promise<{ res: Response; body: T } | null> {
  let res: Response;
  try {
    res = await fetch(`${APP_URL}${path}`, {
      headers: { authorization: `Bearer ${SECRET}` },
      signal: AbortSignal.timeout(290_000),
    });
  } catch {
    console.error(`[${stamp()}] ${APP_URL} is not reachable. Start the app with \`pnpm dev\` first.`);
    return null;
  }
  const body = (await res.json().catch(() => ({}))) as T;
  return { res, body };
}

async function marks(): Promise<void> {
  const call1 = await call<MarksResponse>("/api/cron/marks");
  if (!call1) return;
  const { res, body } = call1;
  if (!res.ok) {
    console.error(`[${stamp()}] marks failed (HTTP ${res.status}): ${body.error ?? "unknown error"}`);
    return;
  }
  const fired = body.exits ?? 0;
  if (fired === 0) {
    console.log(
      `[${stamp()}] marks: ${body.guarded ?? 0} holding / ${body.active ?? 0} active · ${body.snapshots ?? 0} snapshot(s) · no exits`,
    );
  } else {
    console.log(`[${stamp()}] marks: ${fired} exit(s) fired across ${body.guarded ?? 0} agent(s)`);
  }
  for (const agent of body.agents ?? []) {
    for (const exit of agent.exits) {
      console.log(
        `  ${agent.agentId} → ${exit.reason} ${exit.symbol} $${exit.amountUsd.toFixed(2)} (${exit.status})`,
      );
    }
    for (const skip of agent.skipped) {
      console.log(`  ${agent.agentId} → skipped ${skip.symbol}: ${skip.reason}`);
    }
    if (agent.error) console.log(`  ${agent.agentId} → error: ${agent.error}`);
  }
}

async function tick(): Promise<void> {
  const call1 = await call<TickResponse>("/api/cron/tick");
  if (!call1) return;
  const { res, body } = call1;
  if (!res.ok) {
    console.error(`[${stamp()}] tick failed (HTTP ${res.status}): ${body.error ?? "unknown error"}`);
    return;
  }
  if (!body.due) {
    console.log(`[${stamp()}] no agents due`);
    return;
  }
  console.log(`[${stamp()}] ${body.due} agent(s) due`);
  for (const r of body.results ?? []) {
    const detail = r.status === "succeeded" ? (r.summary ?? "") : (r.error ?? "");
    console.log(`  ${r.agentId} → ${r.status}${detail ? `: ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  if (!SECRET) {
    console.error("CRON_SECRET is not set. Add it to .env (`openssl rand -hex 32`); the cron routes refuse requests without it.");
    process.exit(1);
  }
  console.log(
    `Petri scheduler → ${APP_URL}/api/cron/marks every ${INTERVAL_MS / 1000}s, /api/cron/tick every ${PASS_EVERY_MINUTES} min. Ctrl-C to stop.`,
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`\n[${stamp()}] shutting down`);
      process.exit(0);
    });
  }
  let lastTickAt: number | null = null;
  for (;;) {
    // Exits before decisions, always.
    await marks();
    // Never two passes closer than the cron's: see the top of this file.
    if (passIsDue(lastTickAt, Date.now())) {
      lastTickAt = Date.now();
      await tick();
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

void main();
