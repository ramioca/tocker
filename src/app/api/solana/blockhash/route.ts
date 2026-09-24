import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";

export const dynamic = "force-dynamic";

/**
 * The one thing a browser needs from a Solana RPC to build a user-signed transfer:
 * a recent blockhash. Served from here so the RPC URL — and the Helius key in it —
 * stays on the server instead of shipping to every visitor in a NEXT_PUBLIC_ var.
 * Public on purpose: a blockhash is public data, and the response is never cached.
 */
export async function GET() {
  const url = process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
  try {
    const connection = new Connection(url, "confirmed");
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    return NextResponse.json({ blockhash, lastValidBlockHeight }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    // Logged, never returned: a fetch error can quote the upstream URL, and that URL is
    // the Helius endpoint with its API key in it — the one thing this route exists to hide.
    console.error("[api/solana/blockhash] upstream failed", err);
    return NextResponse.json(
      { error: "Could not reach the Solana RPC." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
