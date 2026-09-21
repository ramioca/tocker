/**
 * Create (or verify) the platform wallets and print their addresses and balances.
 *
 *   pnpm platform:wallets
 *
 * One app-owned Privy server wallet per chain. **Both** are load-bearing: Base pays every
 * 402 priced on `eip155:8453` and Solana pays every 402 priced on Solana
 * (`deepnets-token-safety`, `solenrich-launches`, and the Solana option several other
 * vendors offer), and both receive per-fill fee sweeps. The Solana one also needs a little
 * SOL — it drips gas to agent wallets and opens their USDC token accounts.
 *
 * Idempotent: a unique index on `chain` means running this twice creates nothing twice.
 *
 * **It writes to whatever `DATABASE_URL` points at.** From a laptop that is the local
 * PGlite file, and a wallet created there is not the wallet your deployment uses — funding
 * the address it prints would send USDC somewhere no deployed agent can spend from. For
 * production, use the button under **Settings → Admin → Platform wallets** on the deployed
 * site. Stop the dev server first either way; the embedded database is single-process.
 */
import { databaseUrl } from "../src/db/url";
import { dataChainsFor } from "../src/lib/data-sources/registry";
import { DEFAULT_AGENT_CONFIG } from "../src/lib/agent/config";
import { ensurePlatformWallet, platformWalletPurpose, readPlatformBalance } from "../src/lib/platform/wallets";

async function main() {
  const url = databaseUrl();
  if (url?.startsWith("pglite://")) {
    console.log(
      "! DATABASE_URL is embedded PGlite: these are LOCAL wallets. Do not fund them — create the real ones\n" +
        "  from Settings → Admin → Platform wallets on the deployed site.\n",
    );
  }

  const needed = dataChainsFor(DEFAULT_AGENT_CONFIG.dataSources);

  for (const chain of ["base", "solana"] as const) {
    const row = await ensurePlatformWallet(chain);
    const reading = await readPlatformBalance(row);
    const usdc = reading.usdc === null ? "unreadable" : reading.usdc.toFixed(2);
    const native = reading.native === null ? "unreadable" : reading.native.toFixed(4);
    console.log(`${chain.padEnd(7)} ${row.address}`);
    console.log(`        USDC ${usdc}   ${chain === "base" ? "ETH" : "SOL"} ${native}`);
    console.log(`        ${platformWalletPurpose(chain)}`);
    if (reading.error) console.log(`        ! balance unreadable: ${reading.error}`);
    if (needed.includes(chain) && reading.usdc === 0) {
      console.log(`        ! fund this one: the default source list prices on ${chain}, and it holds no USDC`);
    }
    if (chain === "solana" && reading.native === 0) {
      console.log("        ! also send it ~0.05 SOL: it drips gas to agent wallets and opens their token accounts");
    }
    console.log("");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
