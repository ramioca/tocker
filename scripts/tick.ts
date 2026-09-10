/**
 * Local scheduler: `pnpm tick`.
 *
 * Calls `tickDueAgents()` in-process every 60 seconds — the same code path the Vercel
 * cron route uses, minus the HTTP hop. Ctrl-C to stop.
 */
import { tickDueAgents } from "../src/lib/agent/scheduler";

const INTERVAL_MS = 60_000;
let stopping = false;

function stamp(): string {
  return new Date().toISOString();
}

async function tick(): Promise<void> {
  try {
    const result = await tickDueAgents();
    if (result.due === 0) {
      console.log(`[${stamp()}] no agents due`);
      return;
    }
    console.log(`[${stamp()}] ${result.due} agent(s) due`);
    for (const r of result.results) {
      const detail = r.status === "succeeded" ? (r.summary ?? "") : (r.error ?? "");
      console.log(`  ${r.agentId} → ${r.status}${detail ? `: ${detail}` : ""}`);
    }
  } catch (err) {
    console.error(`[${stamp()}] tick failed:`, err instanceof Error ? err.message : err);
  }
}

async function main(): Promise<void> {
  console.log(`Vibe scheduler running — every ${INTERVAL_MS / 1000}s. Ctrl-C to stop.`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopping = true;
      console.log(`\n[${stamp()}] shutting down`);
      process.exit(0);
    });
  }
  while (!stopping) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

void main();
