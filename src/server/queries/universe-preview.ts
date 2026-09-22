import "server-only";
import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import { agents, getDb, tokenScoreHistory, tokenScores, tokens } from "@/db";
import { toNum, toNumOrNull } from "@/lib/money";
import { isNativeAsset } from "@/lib/tokens/score";
import type { AgentConfig } from "@/db/schema";
import type { Chain } from "@/server/types";

/**
 * "What would these floors have let through?" — a dry run of the universe gates over
 * the score history, so an operator sees the effect of a threshold *before* saving it.
 * The bug this exists for: a one-hour `maxAgeHours` silently emptied every sweep, and
 * the only place that showed up was a run summary the next morning.
 *
 * ## What the history can and cannot answer
 *
 * `token_score_history` carries `total`, `verdict`, `components`, `blockers`,
 * `priceUsd`, `liquidityUsd`, `holderCount` and `scoredAt`. That is the whole row.
 * So the preview is *exact* for the score, liquidity, holder and blocklist gates, and
 * necessarily partial for the rest:
 *
 * | Gate | Source | Faithfulness |
 * |---|---|---|
 * | `minScore` | `history.total` | exact |
 * | `minLiquidityUsd` | `history.liquidityUsd` | exact, unknown **fails** (as live) |
 * | `minHolderCount` | `history.holderCount` | exact, unknown **fails** (as live) |
 * | `blocklist` | the proposed list vs the token id | exact |
 * | `minAgeMinutes` / `maxAgeHours` | back-projected from the `token_scores` cache | best effort, see below |
 * | `requireMintRevoked` / `requireFreezeRevoked` | `blockers` | known failures only |
 * | `maxTop10HolderPct` | `blockers` | known failures only, exact percentage |
 * | `maxBuyTaxPct` | `blockers` | known failures only, exact percentage |
 *
 * **Age.** Neither `tokens` nor `token_score_history` records when a token was born —
 * `tokens` has no `createdAt` or `firstPoolAt`, and history has no age column. The one
 * age anywhere in the database is `token_scores.ageHours`, a point-in-time age on the
 * shared score cache. Age advances one hour per hour, so an age taken at the cache
 * row's `scoredAt` back-projects exactly onto the history row's `scoredAt`:
 * `age − (cacheScoredAt − historyScoredAt)`. Where there is no cache row (or it has no
 * age) the age gates are skipped for that token rather than guessed, and the result
 * says so. {@link UniversePreview.ageGateApplied} is false when no row could be aged.
 *
 * **Authorities, concentration and tax.** These reach the preview only through the
 * `blockers` array, which means a *failure* is knowable and a *pass* is not: the
 * absence of `mint_authority_active` may mean the authority was revoked, or may mean
 * whichever agent scored that token did not require it revoked. So the preview blocks
 * on a known failure and skips otherwise, counting each skip in `unknownGates`. It
 * never claims a token is clean, and the UI says these are checked live at run time.
 *
 * Reading another agent's `blockers` publishes nothing of that agent's strategy: a
 * blocker names a fact about a token, never a threshold, and none of it is rendered
 * beside an owner. The thresholds applied here are the caller's own.
 *
 * **Direction of error.** Every deviation from {@link import("@/lib/tokens/score").hardGates}
 * is toward optimism only where it must be (an unknowable gate is skipped, never failed
 * blind) and toward caution everywhere else: honeypot and proven-unsellable rows are
 * dropped outright, because those gates do not depend on any threshold the operator can
 * move. Read the number as "at most this many", not "exactly this many".
 */

export type Universe = AgentConfig["universe"];

/** One history point, flattened to the facts the gates read. */
export interface PreviewRow {
  tokenId: string;
  chain: Chain;
  address: string;
  symbol: string;
  total: number;
  liquidityUsd: number | null;
  holderCount: number | null;
  /** Age at the moment the score was taken, back-projected from the cache. */
  ageHours: number | null;
  /** `false` when a blocker proves the authority was live; `null` when unknown. */
  mintRevoked: boolean | null;
  freezeRevoked: boolean | null;
  /** Read out of a `top10_holders_NNpct` blocker; `null` when no blocker said. */
  top10HolderPct: number | null;
  /** The larger of buy/sell tax, out of a `buy_tax_NNpct` blocker; `null` when unknown. */
  taxPct: number | null;
  /** A gate no threshold can relax: honeypot, or a proven-unsellable position. */
  hardFail: boolean;
}

export interface PreviewExample {
  symbol: string;
  chain: Chain;
  address: string;
  total: number;
  liquidityUsd: number | null;
  holderCount: number | null;
  ageHours: number | null;
}

export interface UniversePreview {
  /** Distinct tokens with a score in the window, on the agent's chains. */
  scanned: number;
  /** How many of them these floors would have let through. */
  passing: number;
  /** Up to 8 of the passing tokens, highest score first. */
  examples: PreviewExample[];
  /** Gates evaluated on at least one row. */
  gatesApplied: string[];
  /** Gates the history could not answer for at least one row. Overlaps `gatesApplied`. */
  gatesSkipped: string[];
  /** Total (row, gate) checks skipped for want of data. */
  unknownGates: number;
  /** False when the universe has no age gate, or nothing in the window could be aged. */
  ageGateApplied: boolean;
  windowHours: number;
}

/**
 * The most tokens one preview will look at. Two thousand distinct tokens is more than
 * a day of sweeps produces, and the gate pass is pure arithmetic over the rows, so the
 * cap protects the query plan rather than the loop.
 */
export const PREVIEW_ROW_CAP = 2_000;

/** How many passing tokens come back as examples. */
export const PREVIEW_EXAMPLE_LIMIT = 8;

/** Gate labels. Short enough to list in a sentence, stable enough to compare. */
export const GATE = {
  score: "score",
  liquidity: "liquidity",
  holders: "holders",
  age: "age",
  mint: "mint authority",
  freeze: "freeze authority",
  top10: "top-10 holders",
  tax: "tax",
  blocklist: "blocklist",
} as const;

export interface PreviewGateResult {
  passed: boolean;
  /** Gates that could not be checked on this row. */
  unknown: string[];
}

function sameAddress(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

/**
 * The gate pass, pure and synchronous — the same shape and the same order as
 * {@link import("@/lib/tokens/score").hardGates}, over the subset of facts history
 * keeps. Unknown liquidity and unknown holders **fail**, exactly as they do live;
 * unknown authority, concentration, tax and age are reported as skipped rather than
 * failed, because history simply never recorded them.
 */
export function passesPreviewGates(row: PreviewRow, universe: Universe): PreviewGateResult {
  const unknown: string[] = [];

  if (universe.blocklist.some((b) => b.chain === row.chain && sameAddress(b.address, row.address))) {
    return { passed: false, unknown };
  }

  if (row.total < universe.minScore) return { passed: false, unknown };

  // A native asset has no issuer, so `hardGates` returns after the blocklist and
  // nothing else can touch it — not liquidity, not holders, not the authorities.
  // The score above is the risk guard's own gate and still applies.
  if (isNativeAsset(row.chain, row.address)) return { passed: true, unknown };

  // Not an operator threshold: a honeypot or a proven-unsellable token is out at any
  // setting, so it is dropped rather than counted as something a floor let through.
  if (row.hardFail) return { passed: false, unknown };

  if (universe.minLiquidityUsd > 0) {
    if (row.liquidityUsd === null || row.liquidityUsd < universe.minLiquidityUsd) {
      return { passed: false, unknown };
    }
  }

  if (universe.minHolderCount > 0) {
    if (row.holderCount === null || row.holderCount < universe.minHolderCount) {
      return { passed: false, unknown };
    }
  }

  const ageGated = universe.minAgeMinutes > 0 || universe.maxAgeHours !== null;
  if (ageGated) {
    if (row.ageHours === null) unknown.push(GATE.age);
    else {
      if (row.ageHours * 60 < universe.minAgeMinutes) return { passed: false, unknown };
      if (universe.maxAgeHours !== null && row.ageHours > universe.maxAgeHours) {
        return { passed: false, unknown };
      }
    }
  }

  if (universe.requireMintRevoked) {
    if (row.mintRevoked === false) return { passed: false, unknown };
    if (row.mintRevoked === null) unknown.push(GATE.mint);
  }

  if (universe.requireFreezeRevoked) {
    if (row.freezeRevoked === false) return { passed: false, unknown };
    if (row.freezeRevoked === null) unknown.push(GATE.freeze);
  }

  if (universe.maxTop10HolderPct < 100) {
    if (row.top10HolderPct === null) unknown.push(GATE.top10);
    else if (row.top10HolderPct > universe.maxTop10HolderPct) return { passed: false, unknown };
  }

  if (universe.maxBuyTaxPct < 100) {
    if (row.taxPct === null) unknown.push(GATE.tax);
    else if (row.taxPct > universe.maxBuyTaxPct) return { passed: false, unknown };
  }

  return { passed: true, unknown };
}

// ---------------------------------------------------------------- blockers → facts

const TOP10_BLOCKER = /^top10_holders_([\d.]+)pct$/;
const TAX_BLOCKER = /^(?:buy|sell)_tax_([\d.]+)pct$/;

/**
 * Reads the facts a blocker array proves. Only failures are provable — see the file
 * header — so everything here answers `false`/a number or stays `null`.
 */
export function factsFromBlockers(blockers: readonly string[]): Pick<
  PreviewRow,
  "mintRevoked" | "freezeRevoked" | "top10HolderPct" | "taxPct" | "hardFail"
> {
  let top10HolderPct: number | null = null;
  let taxPct: number | null = null;
  for (const blocker of blockers) {
    const top10 = TOP10_BLOCKER.exec(blocker);
    if (top10) top10HolderPct = Math.max(top10HolderPct ?? 0, Number(top10[1]));
    const tax = TAX_BLOCKER.exec(blocker);
    if (tax) taxPct = Math.max(taxPct ?? 0, Number(tax[1]));
  }
  return {
    mintRevoked: blockers.includes("mint_authority_active") ? false : null,
    freezeRevoked: blockers.includes("freeze_authority_active") ? false : null,
    top10HolderPct,
    taxPct,
    hardFail: blockers.includes("honeypot") || blockers.includes("cannot_sell"),
  };
}

/** `${chain}:${address}` — history is keyed by it and does not reference `tokens`. */
function splitTokenId(tokenId: string): { chain: Chain; address: string } | null {
  const cut = tokenId.indexOf(":");
  if (cut <= 0) return null;
  const chain = tokenId.slice(0, cut);
  const address = tokenId.slice(cut + 1);
  if ((chain !== "solana" && chain !== "base") || !address) return null;
  return { chain, address };
}

/**
 * Age at `at`, from a cache row's age taken at `cachedAt`. Age advances with the clock,
 * so this is a subtraction rather than an estimate — but a negative result means the
 * cache and the history disagree about the token existing, and that is not an age.
 */
export function ageAt(
  cachedAgeHours: number | null,
  cachedAt: Date | null,
  at: Date,
): number | null {
  if (cachedAgeHours === null || cachedAt === null) return null;
  const elapsedHours = (cachedAt.getTime() - at.getTime()) / 3_600_000;
  const age = cachedAgeHours - elapsedHours;
  return age >= 0 && Number.isFinite(age) ? age : null;
}

// ---------------------------------------------------------------------- the query

export interface PreviewUniverseArgs {
  agentId: string;
  universe: Universe;
  hours?: number;
  /**
   * Chains to scan. Defaults to the agent's saved chains — pass the form's chains so a
   * chain the operator just toggled is reflected in the preview.
   */
  chains?: Chain[];
  /** Injectable for tests; the age back-projection is relative to the history row. */
  now?: Date;
}

const EMPTY: Omit<UniversePreview, "windowHours"> = {
  scanned: 0,
  passing: 0,
  examples: [],
  gatesApplied: [],
  gatesSkipped: [],
  unknownGates: 0,
  ageGateApplied: false,
};

/**
 * Dry-runs `universe` over the last `hours` of score history for the agent's chains.
 * Owner-gating belongs to the caller — {@link import("@/server/actions/universe-preview").previewUniverseAction}.
 */
export async function previewUniverse({
  agentId,
  universe,
  hours = 24,
  chains,
  now,
}: PreviewUniverseArgs): Promise<UniversePreview> {
  const windowHours = Math.min(Math.max(hours, 1), 24 * 30);
  const db = await getDb();

  let scanChains = chains;
  if (!scanChains || scanChains.length === 0) {
    const [agent] = await db.select({ config: agents.config }).from(agents).where(eq(agents.id, agentId)).limit(1);
    scanChains = agent?.config.chains ?? [];
  }
  if (scanChains.length === 0) return { ...EMPTY, windowHours };

  const since = new Date((now?.getTime() ?? Date.now()) - windowHours * 3_600_000);
  const onChain = or(
    ...scanChains.map((chain) => sql`${tokenScoreHistory.tokenId} LIKE ${`${chain}:%`}`),
  );

  // One row per token — the newest score in the window. `DISTINCT ON` needs the
  // dedupe key to lead the sort; the cap then bounds distinct tokens, not raw points.
  const rows = await db
    .selectDistinctOn([tokenScoreHistory.tokenId], {
      tokenId: tokenScoreHistory.tokenId,
      total: tokenScoreHistory.total,
      blockers: tokenScoreHistory.blockers,
      liquidityUsd: tokenScoreHistory.liquidityUsd,
      holderCount: tokenScoreHistory.holderCount,
      scoredAt: tokenScoreHistory.scoredAt,
      symbol: tokens.symbol,
      chain: tokens.chain,
      address: tokens.address,
      cacheSymbol: tokenScores.symbol,
      cacheAgeHours: tokenScores.ageHours,
      cacheScoredAt: tokenScores.scoredAt,
    })
    .from(tokenScoreHistory)
    // Left joins on purpose: history is not foreign-keyed to `tokens`, and the score
    // cache is a TTL cache. A token missing from either still has a history row worth
    // counting, and the id carries its chain and address.
    .leftJoin(tokens, eq(tokens.id, tokenScoreHistory.tokenId))
    .leftJoin(tokenScores, eq(tokenScores.id, tokenScoreHistory.tokenId))
    .where(and(gte(tokenScoreHistory.scoredAt, since), onChain))
    .orderBy(tokenScoreHistory.tokenId, desc(tokenScoreHistory.scoredAt))
    .limit(PREVIEW_ROW_CAP);

  const previewRows: PreviewRow[] = [];
  for (const row of rows) {
    const parts = splitTokenId(row.tokenId);
    const chain = (row.chain as Chain | null) ?? parts?.chain ?? null;
    const address = row.address ?? parts?.address ?? null;
    if (!chain || !address) continue;
    previewRows.push({
      tokenId: row.tokenId,
      chain,
      address,
      symbol: row.symbol ?? row.cacheSymbol ?? `${address.slice(0, 4)}…${address.slice(-4)}`,
      total: toNum(row.total),
      liquidityUsd: toNumOrNull(row.liquidityUsd),
      holderCount: row.holderCount,
      ageHours: ageAt(toNumOrNull(row.cacheAgeHours), row.cacheScoredAt, row.scoredAt),
      ...factsFromBlockers(row.blockers),
    });
  }

  return { ...summarise(previewRows, universe), windowHours };
}

/**
 * The pass over the rows. Split out from the query so the whole summary — counts,
 * examples and which gates actually ran — is testable without a database.
 */
export function summarise(rows: PreviewRow[], universe: Universe): Omit<UniversePreview, "windowHours"> {
  const applied = new Set<string>();
  const skipped = new Set<string>();
  let unknownGates = 0;
  let ageGateApplied = false;
  const passing: PreviewRow[] = [];

  const ageGated = universe.minAgeMinutes > 0 || universe.maxAgeHours !== null;

  for (const row of rows) {
    const { passed, unknown } = passesPreviewGates(row, universe);
    unknownGates += unknown.length;
    for (const gate of unknown) skipped.add(gate);
    if (ageGated && row.ageHours !== null) ageGateApplied = true;
    if (passed) passing.push(row);
  }

  if (rows.length > 0) {
    applied.add(GATE.score);
    if (universe.minLiquidityUsd > 0) applied.add(GATE.liquidity);
    if (universe.minHolderCount > 0) applied.add(GATE.holders);
    if (universe.blocklist.length > 0) applied.add(GATE.blocklist);
    if (ageGateApplied) applied.add(GATE.age);
    // The threshold gates below only ever prove a failure, so "applied" means a row
    // in this window actually carried the fact — not that every row did.
    if (universe.requireMintRevoked && rows.some((r) => r.mintRevoked !== null)) applied.add(GATE.mint);
    if (universe.requireFreezeRevoked && rows.some((r) => r.freezeRevoked !== null)) applied.add(GATE.freeze);
    if (universe.maxTop10HolderPct < 100 && rows.some((r) => r.top10HolderPct !== null)) applied.add(GATE.top10);
    if (universe.maxBuyTaxPct < 100 && rows.some((r) => r.taxPct !== null)) applied.add(GATE.tax);
  }

  const examples = passing
    .slice()
    .sort((a, b) => b.total - a.total)
    .slice(0, PREVIEW_EXAMPLE_LIMIT)
    .map((row) => ({
      symbol: row.symbol,
      chain: row.chain,
      address: row.address,
      total: row.total,
      liquidityUsd: row.liquidityUsd,
      holderCount: row.holderCount,
      ageHours: row.ageHours,
    }));

  return {
    scanned: rows.length,
    passing: passing.length,
    examples,
    gatesApplied: [...applied],
    gatesSkipped: [...skipped],
    unknownGates,
    ageGateApplied,
  };
}
