import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, isPglite } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Liveness + database check. Public on purpose (no secrets in the response) so a
 * uptime monitor or the deploy pipeline can hit it without credentials.
 */
export async function GET() {
  const started = Date.now();
  let database: "ok" | "unreachable" = "unreachable";
  let error: string | null = null;

  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    database = "ok";
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const embedded = isPglite();
  // PGlite is a file on the function's ephemeral disk: it "works" and then silently
  // loses every write when the instance recycles. Never let that pass as healthy.
  const ok = database === "ok" && !(process.env.NODE_ENV === "production" && embedded);

  return NextResponse.json(
    {
      ok,
      database,
      embedded,
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      mocks: {
        // Match the runtime: paidFetch treats X402_MOCK as mock only when it is
        // exactly "1" (unset ⇒ real payments). Reporting `!== "0"` here would tell
        // the operator payments are simulated while real USDC moves.
        llm: process.env.LLM_MOCK === "1",
        x402: process.env.X402_MOCK === "1",
        tokens: process.env.TOKENS_MOCK === "1",
      },
      privyConfigured: Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID && process.env.PRIVY_APP_SECRET),
      impersonation: Boolean(process.env.DEV_IMPERSONATE_USER_ID),
      ms: Date.now() - started,
      ...(error === null ? {} : { error }),
    },
    { status: ok ? 200 : 503 },
  );
}
