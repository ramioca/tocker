import { NextResponse } from "next/server";
import { MAX_SOLANA_RPC_BODY_BYTES, checkSolanaRpcRequest } from "@/lib/wallets/solana-rpc-proxy";

export const dynamic = "force-dynamic";

/**
 * Same-origin Solana JSON-RPC for the browser.
 *
 * Privy's embedded-wallet confirmation modal needs an RPC for `solana:mainnet` or it
 * throws while rendering (see `src/components/providers/privy-provider.tsx`). The real
 * endpoint (`SOLANA_RPC_URL`, a Helius URL with its key in the path) must not ship to
 * visitors, so the provider is pointed here and this forwards the request verbatim —
 * after checking that every method is on the allowlist in
 * `src/lib/wallets/solana-rpc-proxy.ts`. Public data and a signed transaction are the
 * only things that pass through; nothing here signs, and nothing here is cached.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const upstream = process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";

  const raw = await req.text();
  if (raw.length > MAX_SOLANA_RPC_BODY_BYTES) {
    return NextResponse.json({ error: "request too large" }, { status: 413, headers: { "cache-control": "no-store" } });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "not JSON" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const check = checkSolanaRpcRequest(body);
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 403, headers: { "cache-control": "no-store" } });
  }

  try {
    const res = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (err) {
    // Logged, never returned: a fetch error can quote the upstream URL, and that URL is
    // the Helius endpoint with its API key in it — the one thing this route exists to hide.
    console.error("[api/solana/rpc] upstream failed", err);
    return NextResponse.json(
      { error: "Could not reach the Solana RPC." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
