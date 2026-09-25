/**
 * The transcript, in English.
 *
 * A run step is a tool name and a blob of JSON. That is the right thing to *store* — it
 * is the record, and the raw shape is what you want when something went wrong — but it
 * is the wrong thing to *read*. An operator opening a tick should not have to expand
 * eleven rows of `{"input":{"chain":"solana","address":"7uvL…"}}` to learn that the
 * agent scored six tokens, paid fourteen cents for safety reads, proposed two dollars of
 * DOVE and was refused once by its own daily limit.
 *
 * So this file turns each step into a sentence, and the whole run into a short digest.
 *
 * Three rules hold everything together:
 *
 * 1. **Pure.** No React, no clock, no network, no `Date.now()`. Every sentence is a
 *    function of its input, which is what makes the tests below realistic rather than
 *    ceremonial, and what lets the same helper run on the server and the client.
 * 2. **Never throw.** These payloads come out of a database column that has been through
 *    `JSON.parse`, a truncation guard, three tool versions and a mock generator. A
 *    narrator that throws on an unexpected shape takes the whole transcript down with
 *    it, so every reader here is defensive and every unknown shape falls back to the
 *    tool name.
 * 3. **Numbers first.** The result line is read at a glance, so the score, the dollars
 *    and the counts lead; the prose follows them.
 *
 * The shapes are the ones `src/lib/agent/tools.ts` and `tools-positions.ts` return, plus
 * the `guardian` result `run.ts` writes directly and the `args`-shaped payloads from
 * `src/mocks/core.ts`. Anything else is narrated from whatever it happens to carry.
 */
import { fmtUsd } from "@/lib/money";

// ---------------------------------------------------------------- types

/** A step, as narrow as the narrator needs it. `RunStep` satisfies this. */
export interface NarratableStep {
  kind: "thought" | "tool_call" | "tool_result" | "message" | "error";
  toolName?: string | null;
  payload: Record<string, unknown>;
}

/**
 * What the *result* knows that the call did not. A call carries a mint address; only the
 * result carries `DOVE`, and only the result knows whether an order became a proposal.
 * The UI pairs the two and hands the pair back here, so the primary line can say
 * "Proposing $2.00 buy of DOVE" instead of "Buying $2.00 of 7uvL…mnop".
 */
export interface CallHint {
  symbol?: string | null;
  proposed?: boolean;
}

/** One order the agent tried to place. */
export interface NarratedOrder {
  symbol: string;
  side: string;
  amountUsd: number | null;
}

/** Everything the digest is built from. Exported so a caller can render its own shape. */
export interface RunFacts {
  scored: Array<{ symbol: string; total: number }>;
  blocked: number;
  freshCandidates: number;
  sweeps: number;
  /** The run's data spend at its last observation, in dollars. */
  dataSpentUsd: number;
  /** Human labels for the paid reads that were actually bought, in the order bought. */
  paidReads: string[];
  /** Tokens that got at least one paid read. */
  enrichedTokens: number;
  proposed: NarratedOrder[];
  filled: NarratedOrder[];
  /** Refusal labels, grouped and counted. */
  refusals: Array<{ label: string; count: number }>;
  /** `finish` sent the model back for more work. */
  sentBack: number;
  /** `finish` was accepted. */
  finished: boolean;
  /** A run-level `error` step: the loop itself fell over. */
  failure: string | null;
}

// ---------------------------------------------------------------- readers
//
// Everything below treats its input as hostile. `str` on a number returns null rather
// than coercing, because a symbol that renders as "7" is worse than no symbol at all.

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // Drizzle `numeric` columns arrive as strings; so do a few provider payloads.
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return arr(value)
    .map((entry) => str(entry))
    .filter((entry): entry is string => entry !== null);
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The first sentence, for reasons that run three sentences long.
 *
 * Splits on a period followed by whitespace (or a trailing one) and nothing else: the
 * guard's reasons are full of `$12.00` and `(10/10 buys today; sells never count)`, and
 * breaking on either of those leaves an unbalanced parenthesis or half a price.
 */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const stop = flat.search(/\.(\s|$)/);
  return stop === -1 ? flat : flat.slice(0, stop);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

function round(value: number): string {
  return String(Math.round(value));
}

function chainLabel(value: unknown): string | null {
  const chain = str(value)?.toLowerCase();
  if (chain === "solana") return "Solana";
  if (chain === "base") return "Base";
  return chain === undefined || chain === null ? null : chain;
}

function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Local wall-clock "14:32". `h23` is explicit because `hour12: false` used to mean h24
 * in older ICU builds, which renders half past midnight as "24:32".
 */
function clockText(value: unknown): string | null {
  if (value instanceof Date) return formatClock(value);
  const raw = typeof value === "string" || typeof value === "number" ? value : null;
  if (raw === null) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : formatClock(date);
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function usd(value: unknown, opts?: { compact?: boolean }): string | null {
  const n = num(value);
  if (n === null) return null;
  return fmtUsd(n, opts);
}

/**
 * A token *price*. `fmtUsd` pads sub-cent values to a fixed precision ($0.001230), which
 * is right for a column of figures and wrong inside a sentence, so the trailing zeros
 * come off — and the transcript then agrees with the receipt and the positions table,
 * which print $0.00123 for the same number.
 */
function priceText(value: unknown): string | null {
  const formatted = usd(value);
  if (formatted === null) return null;
  return formatted.replace(/(\.\d*?[1-9])0+$/, "$1");
}

/**
 * "A, B, C +2" — an enumeration inside a status line, where "and" would read as prose
 * and slow the eye down. `list` below is the prose form.
 */
function commaList(items: readonly string[], max = 4): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest}` : shown.join(", ");
}

/** "A, B and C", capped, with the overflow counted rather than listed. */
function list(items: readonly string[], max = 3): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const body =
    shown.length <= 1
      ? (shown[0] ?? "")
      : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : body;
}

/** The token a call is about: the result's symbol, the input's, or a short address. */
function tokenLabel(input: Record<string, unknown>, hint?: CallHint): string {
  const hinted = str(hint?.symbol);
  if (hinted !== null) return hinted;
  const symbol = str(input.symbol);
  if (symbol !== null) return symbol;
  const address = str(input.address) ?? str(input.tokenAddress) ?? str(input.mint);
  return address === null ? "a token" : shortAddress(address);
}

function onChain(input: Record<string, unknown>): string {
  const chain = chainLabel(input.chain);
  return chain === null ? "" : ` on ${chain}`;
}

// ---------------------------------------------------------------- describeCall

/**
 * One short sentence for the call: what the agent is about to do, present tense.
 * `hint` is optional — pass it once the result is in and the line sharpens from the
 * address to the symbol.
 */
export function describeCall(toolName: string | null | undefined, input: unknown, hint?: CallHint): string {
  const name = str(toolName) ?? "tool";
  const args = obj(input);

  switch (name) {
    case "discover_tokens": {
      const feeds = strings(args.feeds);
      const where = chainLabel(args.chain) ?? "every chain";
      const qualifiers: string[] = [];
      const limit = num(args.limit);
      const maxAge = num(args.maxAgeHours);
      const minLiquidity = num(args.minLiquidityUsd);
      if (limit !== null) qualifiers.push(`limit ${round(limit)}`);
      if (maxAge !== null) qualifiers.push(`under ${round(maxAge)}h`);
      if (minLiquidity !== null) qualifiers.push(`min ${fmtUsd(minLiquidity, { compact: true })} liquidity`);
      const tail = qualifiers.length === 0 ? "" : ` (${qualifiers.join(", ")})`;
      return feeds.length === 0
        ? `Sweeping the configured feeds on ${where}${tail}`
        : `Sweeping ${feeds.join(", ")} on ${where}${tail}`;
    }

    case "score_token": {
      const paid = [
        args.deep === true ? "sentiment" : null,
        args.smartMoney === true ? "smart money" : null,
        args.sellCheck === true ? "a sell check" : null,
      ].filter((entry): entry is string => entry !== null);
      const tail = paid.length === 0 ? "" : ` — paying for ${list(paid)}`;
      return `Scoring ${tokenLabel(args, hint)}${onChain(args)}${tail}`;
    }

    case "get_portfolio":
      return "Checking the book";

    case "review_positions":
      return "Reviewing open positions";

    case "get_token_price":
      return `Pricing ${tokenLabel(args, hint)}${onChain(args)}`;

    case "get_token_intel":
      return str(args.chain) === "base"
        ? `Reading free stats for ${tokenLabel(args, hint)}`
        : `Buying safety intel on ${tokenLabel(args, hint)}`;

    case "query_data_source": {
      const source = str(args.sourceId) ?? "a data source";
      const params = obj(args.params);
      const subject = str(params.query) ?? str(params.symbol) ?? str(params.mint) ?? null;
      return subject === null
        ? `Buying ${source} data`
        : `Buying ${source} data for ${clip(subject, 40)}`;
    }

    case "search_data_sources": {
      const query = str(args.query);
      return query === null ? "Searching for data sources" : `Searching data sources for ${clip(query, 48)}`;
    }

    case "place_trade": {
      const side = str(args.side)?.toLowerCase() === "sell" ? "sell" : "buy";
      const amount = usd(args.amountUsd) ?? "an order";
      const token = tokenLabel(args, hint);
      if (hint?.proposed === true) return `Proposing ${amount} ${side} of ${token}`;
      return side === "sell" ? `Selling ${amount} of ${token}` : `Buying ${amount} of ${token}`;
    }

    case "post_note": {
      const body = str(args.body);
      return body === null ? "Posting a note" : `Posting a note: “${clip(body, 80)}”`;
    }

    case "finish":
      return "Finishing";

    case "guardian":
      return "Exit engine";

    default:
      return name;
  }
}

// ---------------------------------------------------------------- describeResult

/**
 * One short sentence for the result, numbers first. Handles the three failure shapes as
 * well as the happy ones: an `error` step's `{ error }`, a tool's `{ ok: false, reason }`
 * and a `finish` that sent the model back.
 */
export function describeResult(toolName: string | null | undefined, result: unknown): string {
  const name = str(toolName) ?? "tool";
  const r = obj(result);

  // An `error` step payload. Whatever threw, its message is the whole story.
  const thrown = str(r.error);
  if (thrown !== null) return clip(thrown, 200);

  if (r.ok === false) return describeFailure(name, r);

  switch (name) {
    case "score_token":
      return describeScore(r);
    case "discover_tokens":
      return describeDiscovery(r);
    case "place_trade":
      return describeTrade(r);
    case "get_portfolio":
      return describePortfolioResult(r);
    case "review_positions":
      return describeReviews(r);
    case "post_note":
      return describeNote(r);
    case "finish":
      return "Finished";
    case "get_token_price": {
      const symbol = str(r.symbol) ?? "Token";
      const price = priceText(r.priceUsd);
      return price === null ? `${symbol} — no price` : `${symbol} at ${price}`;
    }
    case "get_token_intel":
      return describeIntel(r);
    case "query_data_source": {
      const source = str(r.sourceId) ?? "data";
      const summary = str(r.summary);
      return summary === null ? `Bought ${source} data` : `${source}: ${clip(summary, 140)}`;
    }
    case "search_data_sources": {
      const registry = arr(r.registry).length;
      const bazaar = arr(r.bazaar).length;
      return `${registry} configured ${plural(registry, "source")} · ${bazaar} from the Bazaar`;
    }
    default:
      return describeUnknown(name, r);
  }
}

/** `{ ok: false, reason, … }`. Each tool's refusal reads differently. */
function describeFailure(name: string, r: Record<string, unknown>): string {
  const reason = str(r.reason) ?? "refused";

  if (name === "finish") {
    const unscored = strings(r.unscored);
    const unproposed = strings(r.unproposed);
    if (unscored.length > 0) {
      return `Sent back — ${unscored.length} fresh ${plural(unscored.length, "candidate")} not scored: ${list(unscored)}`;
    }
    if (unproposed.length > 0) {
      return `Sent back — above the floor but not proposed: ${list(unproposed)}`;
    }
    return `Sent back — ${clip(firstSentence(reason), 120)}`;
  }

  if (name === "place_trade") {
    const guard = reason.match(/^Rejected by risk guard:\s*([\s\S]+)$/i);
    if (guard?.[1] !== undefined) return `Refused by the risk guard: ${clip(firstSentence(guard[1]), 140)}`;
    return `Refused: ${clip(firstSentence(reason), 140)}`;
  }

  return clip(firstSentence(reason), 160);
}

/**
 * "DOVE 71 · candidate · safety 50, organic 79, distribution 91, GT 41 · Deepnets ok,
 * sentiment bought · clears the 55 floor"
 */
function describeScore(r: Record<string, unknown>): string {
  const segments: string[] = [];
  const symbol = str(r.symbol);
  const total = num(r.total);
  const head = [symbol, total === null ? null : round(total)].filter((part) => part !== null).join(" ");
  if (head !== "") segments.push(head);

  const verdict = str(r.verdict);
  if (verdict !== null) segments.push(verdict);

  const blockers = strings(r.blockers);
  if (blockers.length > 0) segments.push(`blocked: ${commaList(blockers, 3)}`);

  const components = obj(r.components);
  const parts: string[] = [];
  const push = (label: string, value: unknown) => {
    const n = num(value);
    if (n !== null) parts.push(`${label} ${round(n)}`);
  };
  push("safety", components.safety);
  push("liquidity", components.liquidity);
  push("organic", components.organic);
  push("distribution", components.distribution);
  push("momentum", components.momentum);
  push("GT", components.gecko);
  push("sentiment", components.sentiment);
  push("smart money", components.smartMoney);
  if (parts.length > 0) segments.push(parts.join(", "));

  const paid = paidReadLabels(obj(r.paidSignals));
  if (paid.length > 0) segments.push(paid.join(", "));

  const notBought = strings(r.notBought).map(shortSkip);
  if (notBought.length > 0) segments.push(`notBought: ${commaList(notBought, 3)}`);

  // Cross-tick memory: what moved since the agent last scored it, and the velocity verdict.
  const trend = obj(r.trend);
  const velocity = str(trend.velocity);
  if (velocity === "first_look") segments.push("first look");
  else if (velocity !== null) {
    const previous = obj(trend.previous);
    const moves: string[] = [];
    const pricePct = num(previous.pricePct);
    if (pricePct !== null) moves.push(`price ${pricePct > 0 ? "+" : ""}${round(pricePct)}%`);
    const holders = num(previous.holdersDelta);
    if (holders !== null) moves.push(`holders ${holders > 0 ? "+" : ""}${round(holders)}`);
    const rises = num(trend.consecutiveRises);
    const ago = num(previous.minutesAgo);
    segments.push(
      `${velocity}${rises !== null && rises >= 2 ? ` ×${round(rises)}` : ""}${
        moves.length > 0 ? ` (${moves.join(", ")}${ago !== null ? ` vs ${round(ago)}m ago` : ""})` : ""
      }`,
    );
  }

  if (typeof r.meetsMinScore === "boolean") {
    const floor = num(r.minScore);
    const where = floor === null ? "floor" : `${round(floor)} floor`;
    segments.push(r.meetsMinScore ? `clears the ${where}` : `below the ${where}`);
  }

  return segments.length === 0 ? "Scored" : segments.join(" · ");
}

/** `paidSignals` → what was actually bought, in the order the plan buys it. */
function paidReadLabels(signals: Record<string, unknown>): string[] {
  const labels: string[] = [];
  if (signals.intel === true) labels.push("Deepnets ok");
  if (signals.sellCheck === true) labels.push("sell check run");
  if (signals.sentiment === true) labels.push("sentiment bought");
  if (signals.smartMoney === true) labels.push("smart money bought");
  return labels;
}

/**
 * `notBought` entries are written for the model and run long:
 * "smartMoney: $0.05 exceeds the $0.00 left in this run's data budget" → "smartMoney
 * (budget)".
 */
function shortSkip(entry: string): string {
  const split = entry.match(/^([A-Za-z]+):\s*([\s\S]+)$/);
  if (split?.[1] === undefined || split[2] === undefined) return clip(entry, 48);
  const key = split[1];
  const why = split[2];
  if (/budget/i.test(why)) return `${key} (budget)`;
  if (/not configured|not enabled|unknown source/i.test(why)) return `${key} (not configured)`;
  return `${key} (${clip(firstSentence(why), 32)})`;
}

/** "12 fresh candidates, 4 already seen · 5 feeds" */
function describeDiscovery(r: Record<string, unknown>): string {
  const total = num(r.count) ?? arr(r.candidates).length;
  const fresh = num(r.freshCount);
  const feeds = arr(r.feeds).length;
  const segments: string[] = [];

  if (fresh === null) {
    segments.push(`${round(total)} ${plural(total, "candidate")}`);
  } else {
    const seen = Math.max(0, total - fresh);
    segments.push(
      seen === 0
        ? `${round(fresh)} fresh ${plural(fresh, "candidate")}`
        : `${round(fresh)} fresh ${plural(fresh, "candidate")}, ${seen} already seen`,
    );
  }
  if (feeds > 0) segments.push(`${feeds} ${plural(feeds, "feed")}`);
  return segments.join(" · ");
}

/** A proposal, a fill, or whatever the venue gave back. */
function describeTrade(r: Record<string, unknown>): string {
  const symbol = str(r.symbol) ?? "the token";
  const side = str(r.side)?.toLowerCase() === "sell" ? "sell" : "buy";

  if (r.proposed === true) {
    const amount = usd(r.requestedUsd) ?? usd(r.amountUsd) ?? "an order";
    const expires = clockText(r.expiresAt);
    return `Proposed ${amount} ${side} of ${symbol}${expires === null ? "" : ` — expires ${expires}`}`;
  }

  const status = str(r.status);
  if (status === "filled" || num(r.priceUsd) !== null) {
    const amount = usd(r.amountUsd) ?? "";
    const price = priceText(r.priceUsd);
    const head = `Filled ${amount === "" ? symbol : `${amount} of ${symbol}`}`;
    return price === null ? head : `${head} at ${price}`;
  }

  return status === null ? `Order sent for ${symbol}` : `${symbol} ${side} ${status}`;
}

/** "$7.02 cash · 3 positions · 12 trades left today" */
function describePortfolioResult(r: Record<string, unknown>): string {
  const segments: string[] = [];
  const cash = usd(r.cashUsd);
  if (cash !== null) segments.push(`${cash} cash`);

  const positions = arr(r.positions).length;
  segments.push(`${positions} ${plural(positions, "position")}`);

  const equity = usd(r.equityUsd);
  if (equity !== null) segments.push(`${equity} equity`);

  const left = num(r.tradesRemainingToday);
  // The cap counts trades, not buys — `maxDailyTrades` minus what has already gone out.
  if (left !== null) segments.push(`${round(left)} ${plural(left, "trade")} left today`);

  return segments.join(" · ");
}

/** "3 positions · DOVE hold, ACAT watch, PIKA exit candidate" */
function describeReviews(r: Record<string, unknown>): string {
  const positions = arr(r.positions);
  const count = num(r.count) ?? positions.length;
  if (count === 0) return "No open positions";

  const verdicts = positions
    .map((entry) => {
      const p = obj(entry);
      const symbol = str(p.symbol);
      const verdict = str(p.verdict)?.replace(/_/g, " ");
      if (symbol === null) return null;
      return verdict === null ? symbol : `${symbol} ${verdict}`;
    })
    .filter((entry): entry is string => entry !== null);

  const head = `${round(count)} ${plural(count, "position")}`;
  return verdicts.length === 0 ? head : `${head} · ${commaList(verdicts, 4)}`;
}

/**
 * The note's own words when the payload carries them. The live tool returns only
 * `{ ok, postId }` — the body is on the call — so this usually reports the posting and
 * `describeCall` carries the text.
 */
function describeNote(r: Record<string, unknown>): string {
  const body = str(r.body) ?? str(r.summary) ?? str(r.note) ?? str(r.text);
  return body === null ? "Posted to the feed" : clip(body, 80);
}

function describeIntel(r: Record<string, unknown>): string {
  const symbol = str(r.symbol);
  const summary = str(r.summary);
  if (summary !== null) return symbol === null ? clip(summary, 140) : `${symbol}: ${clip(summary, 130)}`;

  // The free Base shape: DexScreener price / liquidity / volume.
  const parts = [
    priceText(r.priceUsd),
    (() => {
      const liquidity = usd(r.liquidityUsd, { compact: true });
      return liquidity === null ? null : `${liquidity} liquidity`;
    })(),
    (() => {
      const volume = usd(r.volume24h, { compact: true });
      return volume === null ? null : `${volume} 24h volume`;
    })(),
  ].filter((part): part is string => part !== null);

  if (parts.length === 0) return symbol === null ? "Intel returned" : `Intel on ${symbol}`;
  return `${symbol === null ? "" : `${symbol} `}${parts.join(" · ")}`;
}

/** Guardian results and anything a future tool returns: say whatever it carries. */
function describeUnknown(name: string, r: Record<string, unknown>): string {
  const summary = str(r.summary) ?? str(r.rendered) ?? str(r.message);
  if (summary !== null) return clip(summary, 160);
  if (r.ok === true) return "Done";
  return name;
}

// ---------------------------------------------------------------- narrateRun

/** Refusal reasons, collapsed to something countable. Order matters: first match wins. */
const REFUSAL_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/daily buy limit/i, "daily buy limit"],
  [/this tick has already proposed|per tick/i, "tick proposal limit"],
  [/already proposed/i, "already proposed"],
  [/blocklist/i, "blocklist"],
  [/hard gate/i, "hard gates"],
  [/minscore|below this agent/i, "below the score floor"],
  [/verdict "avoid"|judged avoidable/i, "avoid verdict"],
  [/no score for/i, "unscored token"],
  [/affordable/i, "not enough cash"],
  [/exceeds maxtradeusd|exceeds what this agent/i, "trade size cap"],
  [/maxpositionpct|% of equity/i, "position concentration"],
  [/no .* position to sell|cannot price/i, "nothing to sell"],
  [/could not quote|quote failed|deviat/i, "bad quote"],
  [/not enabled for this agent/i, "chain not enabled"],
  [/every data provider failed/i, "scoring outage"],
];

function refusalLabel(r: Record<string, unknown>, reason: string): string {
  if (r.limitReached === true) return "tick proposal limit";
  if (r.unaffordable === true) return "not enough cash";
  if (r.alreadyProposed === true) return "already proposed";
  for (const [pattern, label] of REFUSAL_LABELS) {
    if (pattern.test(reason)) return label;
  }
  return clip(firstSentence(reason).toLowerCase(), 48);
}

/** Every number the digest needs, pulled out of the transcript in one pass. */
export function runFacts(steps: readonly NarratableStep[]): RunFacts {
  const facts: RunFacts = {
    scored: [],
    blocked: 0,
    freshCandidates: 0,
    sweeps: 0,
    dataSpentUsd: 0,
    paidReads: [],
    enrichedTokens: 0,
    proposed: [],
    filled: [],
    refusals: [],
    sentBack: 0,
    finished: false,
    failure: null,
  };

  const refusals = new Map<string, number>();
  const paid = new Set<string>();
  // `dataSpentThisRunUsd` is the running total at the moment the tool answered, so the
  // largest one seen is the run's spend. Mock payloads carry per-call `x402` amounts
  // instead, which have to be summed.
  let spendHighWater = 0;
  let x402Total = 0;

  for (const step of steps) {
    const name = str(step.toolName);

    if (step.kind === "error") {
      const message = str(step.payload.error);
      // A tool that threw is a refusal with a worse origin; a run-level error is the
      // loop itself falling over, and that is how the tick ended.
      if (name === null && message !== null) facts.failure = message;
      else if (message !== null) count(refusals, refusalLabel({}, message));
      continue;
    }

    if (step.kind !== "tool_result") continue;

    const payload = step.payload;
    const result = obj("result" in payload ? payload.result : payload);
    const x402 = obj(payload.x402);
    const amount = num(x402.amountUsd);
    if (amount !== null) {
      x402Total += amount;
      const source = str(result.sourceId) ?? str(x402.sourceId);
      if (source !== null) paid.add(source);
    }
    const spent = num(result.dataSpentThisRunUsd);
    if (spent !== null) spendHighWater = Math.max(spendHighWater, spent);

    if (result.ok === false) {
      const reason = str(result.reason);
      if (name === "finish" && result.nudged === true) facts.sentBack += 1;
      else if (reason !== null) count(refusals, refusalLabel(result, reason));
      continue;
    }

    switch (name) {
      case "score_token": {
        const symbol = str(result.symbol);
        const total = num(result.total);
        if (symbol !== null && total !== null) facts.scored.push({ symbol, total });
        if (strings(result.blockers).length > 0) facts.blocked += 1;
        const signals = obj(result.paidSignals);
        const bought = paidReadLabels(signals);
        if (bought.length > 0) facts.enrichedTokens += 1;
        if (signals.intel === true) paid.add("Deepnets safety");
        if (signals.sentiment === true) paid.add("sentiment");
        if (signals.smartMoney === true) paid.add("smart money");
        if (signals.sellCheck === true) paid.add("sell simulation");
        break;
      }
      case "discover_tokens": {
        facts.sweeps += 1;
        facts.freshCandidates += num(result.freshCount) ?? 0;
        break;
      }
      case "query_data_source": {
        const source = str(result.sourceId);
        if (source !== null) paid.add(source);
        break;
      }
      case "get_token_intel": {
        if (num(result.dataSpentThisRunUsd) !== null) paid.add("Deepnets safety");
        break;
      }
      case "place_trade": {
        const symbol = str(result.symbol) ?? "a token";
        const side = str(result.side) ?? "buy";
        if (result.proposed === true) {
          facts.proposed.push({ symbol, side, amountUsd: num(result.requestedUsd) });
        } else if (str(result.status) === "filled" || num(result.priceUsd) !== null) {
          facts.filled.push({ symbol, side, amountUsd: num(result.amountUsd) });
        }
        break;
      }
      case "finish": {
        facts.finished = true;
        break;
      }
      default:
        break;
    }
  }

  facts.dataSpentUsd = Math.max(spendHighWater, x402Total);
  facts.paidReads = [...paid];
  facts.refusals = [...refusals.entries()].map(([label, count]) => ({ label, count }));
  return facts;
}

/**
 * The orders the risk guard or the venue turned down, grouped by why, most frequent
 * first. `place_trade` only: a refused finish or a failed score is not a refused order.
 * Labels are the same ones {@link runFacts} counts, so a banner that quotes this and a
 * digest built from `runFacts` can never disagree about what stopped a buy.
 */
export function tradeRefusals(steps: readonly NarratableStep[]): Array<{ label: string; count: number }> {
  const refusals = new Map<string, number>();
  for (const step of steps) {
    if (str(step.toolName) !== "place_trade") continue;
    if (step.kind === "error") {
      const message = str(step.payload.error);
      if (message !== null) count(refusals, refusalLabel({}, message));
      continue;
    }
    if (step.kind !== "tool_result") continue;
    const payload = step.payload;
    const result = obj("result" in payload ? payload.result : payload);
    const reason = str(result.reason);
    if (result.ok === false && reason !== null) count(refusals, refusalLabel(result, reason));
  }
  return [...refusals.entries()]
    .map(([label, n]) => ({ label, count: n }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function count(counts: Map<string, number>, label: string): void {
  counts.set(label, (counts.get(label) ?? 0) + 1);
}

/**
 * Two to four sentences: what was researched, what was paid for, what was decided, and
 * how the tick ended. Deterministic — the same steps always produce the same digest.
 */
export function narrateRun(steps: readonly NarratableStep[]): string {
  if (steps.length === 0) return "";
  const facts = runFacts(steps);
  const sentences: string[] = [];

  // 1. Research.
  if (facts.scored.length > 0 || facts.freshCandidates > 0) {
    const top = [...facts.scored]
      .sort((a, b) => b.total - a.total || a.symbol.localeCompare(b.symbol))
      .slice(0, 3)
      .map((entry) => `${entry.symbol} ${round(entry.total)}`);
    const clauses: string[] = [];
    if (facts.freshCandidates > 0) {
      clauses.push(
        `Discovery surfaced ${facts.freshCandidates} fresh ${plural(facts.freshCandidates, "candidate")}`,
      );
    }
    if (facts.scored.length > 0) {
      const scored = `scored ${facts.scored.length} ${plural(facts.scored.length, "token")}`;
      const led = top.length === 0 ? "" : ` — ${top.join(", ")}`;
      const blocked = facts.blocked === 0 ? "" : `, ${facts.blocked} hard-blocked`;
      clauses.push(`${clauses.length === 0 ? capitalize(scored) : scored}${led}${blocked}`);
    } else {
      clauses.push("none were scored");
    }
    sentences.push(`${clauses.join("; ")}.`);
  }

  // 2. Money spent on data.
  if (facts.dataSpentUsd > 0) {
    const on = facts.paidReads.length === 0 ? "" : ` on ${list(facts.paidReads)}`;
    const tokens =
      facts.enrichedTokens === 0
        ? ""
        : ` across ${facts.enrichedTokens} ${plural(facts.enrichedTokens, "token")}`;
    sentences.push(`Paid ${fmtUsd(facts.dataSpentUsd)} for data${on}${tokens}.`);
  } else if (facts.paidReads.length > 0) {
    sentences.push(`Bought ${list(facts.paidReads)} at no recorded cost.`);
  } else {
    sentences.push("Spent nothing on data.");
  }

  // 3. What it decided.
  const decisions: string[] = [];
  if (facts.filled.length > 0) decisions.push(`filled ${list(facts.filled.map(orderText))}`);
  if (facts.proposed.length > 0) decisions.push(`proposed ${list(facts.proposed.map(orderText))}`);
  const refusedCount = facts.refusals.reduce((sum, entry) => sum + entry.count, 0);
  if (refusedCount > 0) {
    const labels = facts.refusals.map((entry) => (entry.count > 1 ? `${entry.label} ×${entry.count}` : entry.label));
    decisions.push(`${refusedCount} ${plural(refusedCount, "refusal")} (${list(labels)})`);
  }
  sentences.push(decisions.length === 0 ? "No orders this run." : `${capitalize(list(decisions, 3))}.`);

  // 4. How it ended.
  sentences.push(endingText(facts));

  return sentences.join(" ");
}

function orderText(order: NarratedOrder): string {
  const amount = order.amountUsd === null ? null : fmtUsd(order.amountUsd);
  return amount === null ? order.symbol : `${amount} of ${order.symbol}`;
}

function endingText(facts: RunFacts): string {
  if (facts.failure !== null) return `The run failed: ${clip(firstSentence(facts.failure), 140)}.`;
  if (facts.finished) {
    return facts.sentBack > 0
      ? `Sent back ${facts.sentBack === 1 ? "once" : `${facts.sentBack} times`} for more work, then finished.`
      : "Finished.";
  }
  if (facts.sentBack > 0) return "Sent back for more work and never called finish again.";
  return "Stopped without calling finish — the step limit or the clock ran out.";
}

function capitalize(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}
