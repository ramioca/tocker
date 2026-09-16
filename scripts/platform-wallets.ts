/**
 * Create (or verify) the platform wallets and print their addresses and USDC balances.
 *
 *   pnpm platform:wallets
 *
 * One app-owned Privy server wallet per chain; the Base one pays every x402 data call
 * and both receive the per-fill fee sweeps. Idempotent: a unique index on `chain` means
 * running this twice creates nothing twice. Stop the dev server first — the embedded
 * database is single-process.
 */
import { ensurePlatformWallet, readPlatformBalances } from "../src/lib/platform/wallets";

async function main() {
  for (const chain of ["base", "solana"] as const) {
    const row = await ensurePlatformWallet(chain);
    const bal = await readPlatformBalances(row);
    const usdc = bal.balances.find((b) => b.asset === "usdc")?.amount ?? 0;
    console.log(`${chain.padEnd(7)} ${row.address}   USDC ${usdc}${chain === "base" ? "   ← fund this one: it pays for data" : ""}`);
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
