/**
 * Local scheduler: `pnpm tick`.
 *
 * Calls the running app's cron route every 60 seconds, exactly as Vercel Cron does in
 * production. Going over HTTP (rather than importing the scheduler) means only the dev
 * server ever opens the database, which the embedded PGlite requires: a second process
 * on the same data directory silently loses writes. Run it next to `pnpm dev`.
 */
const INTERVAL_MS = 60_000;
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET?.trim();

interface TickResponse {
  ok?: boolean;
  error?: string;
  due?: number;
  results?: Array<{ agentId: string; status: string; summary?: string; error?: string }>;
}

function stamp(): string {
  return new Date().toISOString();
}

async function tick(): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${APP_URL}/api/cron/tick`, {
      headers: { authorization: `Bearer ${SECRET}` },
      signal: AbortSignal.timeout(290_000),
    });
  } catch {
    console.error(`[${stamp()}] ${APP_URL} is not reachable. Start the app with \`pnpm dev\` first.`);
    return;
  }
  const body = (await res.json().catch(() => ({}))) as TickResponse;
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
    console.error("CRON_SECRET is not set. Add it to .env (`openssl rand -hex 32`); the cron route refuses requests without it.");
    process.exit(1);
  }
  console.log(`Petri scheduler → ${APP_URL}/api/cron/tick every ${INTERVAL_MS / 1000}s. Ctrl-C to stop.`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`\n[${stamp()}] shutting down`);
      process.exit(0);
    });
  }
  for (;;) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

void main();
