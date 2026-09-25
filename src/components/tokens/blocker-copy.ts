/**
 * Blockers and warnings arrive as machine codes (`top10_holders_72pct`). A code
 * is not an explanation, so this file is the translation layer: every code the
 * scorer (`lib/tokens/score.ts`) emits becomes a sentence a person can act on, and
 * anything unknown degrades to a readable phrase instead of a dead end.
 *
 * Pure and JSX-free so the "no code falls through" test can import it.
 *
 * **Audience.** The same failed gate reads differently depending on whose rules
 * produced it. On an agent's own views the universe is the operator's, so "your
 * floor" is true. On a public surface (Discover, a token page) the score was taken
 * under the platform default, and "your floor" would be addressed to nobody.
 */

export interface BlockerCopy {
  /** The sentence. Always says what is true, not which rule fired. */
  title: string;
  /** Why it matters, when the title alone is not enough. */
  detail?: string;
}

/** `owner`: scored under the viewer's own agent's rules. `public`: under the platform default. */
export type BlockerAudience = "owner" | "public";

type Copy = BlockerCopy | ((audience: BlockerAudience) => BlockerCopy);

/** "your floor" to an operator, "the platform's floor" to everyone else. */
const whose = (audience: BlockerAudience) => (audience === "owner" ? "your" : "the platform's");

/** Codes with no embedded number. */
const EXACT: Record<string, Copy> = {
  // ---- hard gates ----
  // Short titles: a Discover row shows the first one on a single truncated line, with
  // "+2 more" after it, and a long title cut the count off.
  blocklisted: (audience) =>
    audience === "owner"
      ? { title: "On your blocklist", detail: "You told this agent never to touch it." }
      : { title: "On the platform blocklist" },
  mint_authority_active: {
    title: "Mint authority not revoked",
    detail: "Whoever deployed it can print more supply at any moment and sell it into your bid.",
  },
  mint_authority_unknown: {
    title: "Mint authority unverified",
    detail: "No provider could confirm it is revoked, so the deployer may still be able to print more supply.",
  },
  freeze_authority_active: {
    title: "Freeze authority not revoked",
    detail: "The deployer can freeze your account and stop you selling.",
  },
  freeze_authority_unknown: {
    title: "Freeze authority unverified",
    detail: "No provider could confirm it is revoked, so the deployer may still be able to freeze balances.",
  },
  honeypot: {
    title: "You can buy it but you cannot sell it",
    detail: "The contract blocks sells. Every dollar in is a dollar gone.",
  },
  cannot_sell: {
    title: "A test sell failed",
    detail: "A sell simulated at this block could not exit the position.",
  },
  liquidity_below_floor: (audience) => ({
    title: `Liquidity is below ${whose(audience)} floor`,
    detail: "There is not enough depth to get in and back out at a price worth having.",
  }),
  liquidity_unknown: {
    title: "No provider reported liquidity",
    detail: "Without a depth figure there is no telling whether a sell would fill.",
  },
  liquidity_unlocked: { title: "The liquidity pool is not locked" },
  holders_below_floor: (audience) => ({ title: `Fewer holders than ${whose(audience)} minimum` }),
  holder_count_unknown: { title: "No provider reported a holder count" },
  age_below_min: (audience) => ({
    title: `Younger than ${whose(audience)} minimum age`,
    detail: "Most snipe-and-dump rugs are over inside the first half hour.",
  }),
  age_above_max: (audience) => ({ title: `Older than ${whose(audience)} maximum age` }),
  age_unknown: { title: "Its age could not be established" },
  top10_holders_unknown: { title: "No provider reported the top 10 wallets' share" },
  score_below_floor: (audience) => ({ title: `Scores below ${whose(audience)} bar` }),
  no_route: { title: "No route to trade it", detail: "No venue will quote a swap for this token." },
  chain_not_enabled: { title: "On a chain this agent does not trade" },

  // ---- warnings ----
  jupiter_flags_suspicious: { title: "Jupiter flags it as suspicious" },
  lp_barely_locked: {
    title: "Almost none of the liquidity is locked",
    detail: "Under 10% of the pool is locked, so the rest can be pulled at any time.",
  },
  dev_holds_over_25pct: { title: "The deployer still holds over 25% of supply" },
  no_contract_security_data: {
    title: "No security scan of the contract",
    detail: "No provider returned a contract audit, so safety is unscored.",
  },
  contract_not_verified: { title: "The contract source is not verified" },
  contract_is_mintable: {
    title: "The contract can mint more supply",
    detail: "Whoever controls it can dilute every holder.",
  },
  ownership_can_be_reclaimed: {
    title: "Ownership can be reclaimed",
    detail: "The contract was renounced in a way that can be undone.",
  },
  hidden_owner: { title: "The contract has a hidden owner" },
  transfers_pausable: { title: "The contract owner can pause transfers" },
  tax_can_be_changed: {
    title: "The owner can change the tax",
    detail: "A low tax today can be raised after you buy.",
  },
  cannot_sell_entire_balance: {
    title: "A holder cannot sell their whole balance",
    detail: "The contract caps how much of a position can leave at once.",
  },
  volume_without_organic_buyers: {
    title: "Volume with almost no organic buyers behind it",
    detail: "Dozens of buys from one or two real wallets is the wash-trading tell.",
  },
  no_organic_score: {
    title: "No organic-activity score for it",
    detail: "Organic activity is estimated from buy and sell counts instead.",
  },
  organic_proxy_only: {
    title: "Organic activity is estimated from trade counts",
    detail: "No organic-volume feed covers it, so raw DEX buys and sells stand in.",
  },
  turnover_suggests_wash_trading: {
    title: "Daily volume is over 15× its liquidity",
    detail: "Turnover that high is usually manufactured.",
  },
  top10_holders_concentrated: { title: "The top 10 wallets hold over half the supply" },
  parabolic_1h_move: {
    title: "Up over 50% in the last hour",
    detail: "Chasing a vertical candle is how agents buy tops.",
  },
  down_over_40pct_24h: { title: "Down over 40% in the last 24 hours" },
  gt_score_low: { title: "GeckoTerminal rates it below 40 out of 100" },
  low_confidence: {
    title: "Scored on thin data",
    detail: "Too few providers answered to trust it, so it cannot read as strong.",
  },
  safety_unscored: { title: "Safety could not be scored", detail: "No security provider answered for it." },
  rugcheck_unavailable: { title: "RugCheck did not answer" },
};

/** `<something>_<number>pct` codes, keyed by the part before the number. */
const PERCENT_PATTERNS: Array<{
  match: RegExp;
  copy: (pct: string) => BlockerCopy;
}> = [
  {
    match: /^top10_holders_(\d+(?:\.\d+)?)pct$/,
    copy: (pct) => ({
      title: `Top 10 wallets hold ${pct}% of supply`,
      detail: "A handful of wallets can end this token in one transaction.",
    }),
  },
  {
    match: /^dev_balance_(\d+(?:\.\d+)?)pct$/,
    copy: (pct) => ({
      title: `The deployer still holds ${pct}% of supply`,
    }),
  },
  {
    match: /^buy_tax_(\d+(?:\.\d+)?)pct$/,
    copy: (pct) => ({ title: `Buying costs a ${pct}% tax` }),
  },
  {
    match: /^sell_tax_(\d+(?:\.\d+)?)pct$/,
    copy: (pct) => ({ title: `Selling costs a ${pct}% tax` }),
  },
  {
    match: /^owner_(\d+(?:\.\d+)?)pct$/,
    copy: (pct) => ({ title: `The contract owner holds ${pct}% of supply` }),
  },
  {
    match: /^liquidity_drop_(\d+(?:\.\d+)?)pct$/,
    copy: (pct) => ({ title: `Liquidity fell ${pct}% in the last day` }),
  },
];

/** Codes with a count or an age in them. */
const COUNT_PATTERNS: Array<{ match: RegExp; copy: (n: string) => BlockerCopy }> = [
  {
    match: /^rugcheck_(\d+)_danger_risks$/,
    copy: (n) => ({ title: `RugCheck flags ${n} danger-level risk${n === "1" ? "" : "s"}` }),
  },
  { match: /^age_(\d+)m$/, copy: (n) => ({ title: `Only ${n} minutes old` }) },
  { match: /^age_(\d+)h$/, copy: (n) => ({ title: `Only ${n} hours old` }) },
  { match: /^holders_(\d+)$/, copy: (n) => ({ title: `Only ${n} holders` }) },
];

/** `low_organic_volume` → "Low organic volume". Never shows a raw code to a user. */
function humanise(code: string): string {
  const words = code.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (words.length === 0) return "Unknown check failed";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The written copy for a code, or null when it would fall through to {@link humanise}. */
export function knownBlocker(code: string, audience: BlockerAudience = "owner"): BlockerCopy | null {
  const key = code.trim().toLowerCase();
  const exact = EXACT[key];
  if (exact) return typeof exact === "function" ? exact(audience) : exact;

  for (const pattern of [...PERCENT_PATTERNS, ...COUNT_PATTERNS]) {
    const found = key.match(pattern.match);
    if (found) return pattern.copy(found[1]);
  }
  return null;
}

export function describeBlocker(code: string, audience: BlockerAudience = "owner"): BlockerCopy {
  return knownBlocker(code, audience) ?? { title: humanise(code.trim().toLowerCase()) };
}

/** Warning → the blocker prefix that already says it. */
const SAID_BY_BLOCKER: Record<string, string> = {
  top10_holders_concentrated: "top10_holders_",
  contract_is_mintable: "mint_authority_active",
};

/**
 * Warnings minus the ones a blocker already says. "Top 10 wallets hold 66% of
 * supply" as a failed gate and "the top 10 wallets hold over half the supply" as a
 * warning directly under it is one fact told twice.
 */
export function visibleWarnings(warnings: readonly string[], blockers: readonly string[]): string[] {
  return warnings.filter((code) => {
    const prefix = SAID_BY_BLOCKER[code];
    return prefix === undefined || !blockers.some((blocker) => blocker.startsWith(prefix));
  });
}
