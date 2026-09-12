/**
 * GoPlus token security — free contract analysis for Base (chain id 8453).
 *
 * Verified live:
 *   GET https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=<a,b,c>
 *   → { code: 1, result: { "<lowercased addr>": { is_honeypot, buy_tax, … } } }
 *
 * Two traps this module absorbs so nothing downstream has to:
 *   1. **every value is a string** ("0"/"1", "0.05"), and fields are sometimes
 *      missing entirely — a contract GoPlus has not analysed returns `{}`;
 *   2. **percent fields are fractions.** `owner_percent: "0.0"`, and a holder at
 *      22.5% of supply comes back as `"0.225173516370147198"`. We multiply by 100 so
 *      everything downstream is a real percent, matching Jupiter's convention.
 *
 * The endpoint accepts a comma-separated address list, so batching is one request.
 */
import fixture from "../fixtures/goplus.json";
import type { GoPlusSecurity } from "../types";
import { asArray, asRecord, flag, getJson, isTokensMock, num, str, TtlCache } from "./http";

const URL_BASE = "https://api.gopluslabs.io/api/v1/token_security/8453";
const TTL_MS = 600_000;
/** GoPlus documents a limit around 100 addresses per call; stay well inside it. */
const BATCH_SIZE = 20;

const cache = new TtlCache<GoPlusSecurity>(TTL_MS);

export function resetGoPlusCache(): void {
  cache.clear();
}

const FIXTURE = fixture as unknown as Record<string, unknown>;

/** GoPlus fraction ("0.225…") → percent (22.5). */
function pct(value: unknown): number | null {
  const n = num(value);
  return n === null ? null : n * 100;
}

/** Sums the `percent` of the top-10 holder list GoPlus returns. */
function topHoldersPct(value: unknown): number | null {
  const rows = asArray(value);
  if (rows.length === 0) return null;
  let total: number | null = null;
  for (const raw of rows.slice(0, 10)) {
    const r = asRecord(raw);
    const p = r ? pct(r.percent) : null;
    if (p !== null) total = (total ?? 0) + p;
  }
  return total === null ? null : Math.min(100, total);
}

/** Share of LP tokens sitting in a lock contract or burn address. */
function lpLockedPct(value: unknown): number | null {
  const rows = asArray(value);
  if (rows.length === 0) return null;
  let locked: number | null = null;
  for (const raw of rows) {
    const r = asRecord(raw);
    if (!r) continue;
    const p = pct(r.percent);
    if (p === null) continue;
    const isLocked = flag(r.is_locked) === true;
    const address = str(r.address)?.toLowerCase() ?? "";
    const burned = address === "0x0000000000000000000000000000000000000000" || address === "0x000000000000000000000000000000000000dead";
    if (isLocked || burned) locked = (locked ?? 0) + p;
    else locked = locked ?? 0;
  }
  return locked === null ? null : Math.min(100, locked);
}

const DEAD_OWNERS = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

/** `""` / zero / dead → renounced; a real address → not; field absent → unknown. */
export function ownerRenounced(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const owner = value.trim().toLowerCase();
  if (owner === "") return true;
  return DEAD_OWNERS.has(owner);
}

export function parseGoPlusSecurity(address: string, value: unknown): GoPlusSecurity | null {
  const r = asRecord(value);
  if (!r || Object.keys(r).length === 0) return null;
  return {
    address,
    symbol: str(r.token_symbol),
    name: str(r.token_name),
    isHoneypot: flag(r.is_honeypot),
    buyTaxPct: pct(r.buy_tax),
    sellTaxPct: pct(r.sell_tax),
    isOpenSource: flag(r.is_open_source),
    isMintable: flag(r.is_mintable),
    isProxy: flag(r.is_proxy),
    canTakeBackOwnership: flag(r.can_take_back_ownership),
    ownerRenounced: ownerRenounced(r.owner_address),
    hiddenOwner: flag(r.hidden_owner),
    transferPausable: flag(r.transfer_pausable),
    cannotSellAll: flag(r.cannot_sell_all),
    tradingCooldown: flag(r.trading_cooldown),
    slippageModifiable: flag(r.slippage_modifiable),
    isBlacklisted: flag(r.is_blacklisted),
    selfdestruct: flag(r.selfdestruct),
    ownerPercent: pct(r.owner_percent),
    creatorPercent: pct(r.creator_percent),
    top10HolderPct: topHoldersPct(r.holders),
    lpLockedPct: lpLockedPct(r.lp_holders),
    holderCount: num(r.holder_count),
    lpHolderCount: num(r.lp_holder_count),
    totalSupply: num(r.total_supply),
  };
}

/** Contract security for one Base token. `null` when GoPlus has no analysis or is down. */
export async function getGoPlusSecurity(address: string): Promise<GoPlusSecurity | null> {
  const found = await getGoPlusSecurities([address]);
  return found.get(address.toLowerCase()) ?? null;
}

/** Batched lookup — GoPlus takes a comma-separated address list, so one call per 20. */
export async function getGoPlusSecurities(addresses: readonly string[]): Promise<Map<string, GoPlusSecurity>> {
  const out = new Map<string, GoPlusSecurity>();
  const pending: string[] = [];
  for (const raw of new Set(addresses.map((a) => a.toLowerCase()))) {
    if (!raw.startsWith("0x")) continue;
    const cached = cache.get(raw);
    if (cached.hit) {
      if (cached.value) out.set(raw, cached.value);
    } else {
      pending.push(raw);
    }
  }
  if (pending.length === 0) return out;

  if (isTokensMock()) {
    for (const address of pending) {
      const parsed = parseGoPlusSecurity(address, FIXTURE[address] ?? null);
      cache.set(address, parsed);
      if (parsed) out.set(address, parsed);
    }
    return out;
  }

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const body = asRecord(await getJson(`${URL_BASE}?contract_addresses=${batch.join(",")}`));
    const result = body ? asRecord(body.result) : null;
    for (const address of batch) {
      const parsed = result ? parseGoPlusSecurity(address, result[address]) : null;
      // Only remember a miss when GoPlus actually answered; a transport failure
      // should be retried on the next sweep rather than cached as "no data".
      if (body !== null) cache.set(address, parsed);
      if (parsed) out.set(address, parsed);
    }
  }
  return out;
}
