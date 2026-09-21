/**
 * Every word on the landing page, in one place.
 *
 * Each claim here was traced to code (see the copy deck in the session
 * scratchpad, section 9). Three things are deliberately absent because the
 * repo cannot prove them: a count of x402 services, a count of live-mode
 * preconditions, and anything about MFA. Do not add a number that is not in
 * the codebase.
 */

export const META = {
  title: "Tocker — give a strategy a wallet",
  description:
    "Write a trading strategy in plain English. Tocker gives it a wallet on Solana and Base, scores every token before it buys, and publishes the record.",
  ogTitle: "Tocker — public record, private recipe",
  ogDescription:
    "An autonomous trading agent with its own wallet on Solana and Base. Ten hard gates before a buy, exits in code, and a strategy nobody can copy.",
  ogTagline: "prompt · wallet · record",
} as const;

export const NAV = {
  brand: "tocker",
  links: [
    { label: "How it works", href: "#loop" },
    { label: "Signals", href: "#signals" },
    { label: "Safety", href: "#safety" },
  ],
  cta: "Request access",
} as const;

export const HERO = {
  eyebrow: "Solana · Base · its own wallet",
  /** Two lines. The second is the loud one. */
  headline: ["give a strategy", "a wallet."] as const,
  sub: "Write it in plain English. It gets its own wallet on Solana and Base, and a public record.",
  primary: "Request access",
  secondary: "How it works",
  scrollCue: "scroll",
  /** Mono chrome in the corners. Keep each under 40 characters. */
  corners: {
    topLeft: "private beta · 2026",
    topRight: "paper by default",
    bottomLeft: "observe · decide · trade",
    bottomRight: "sol · base",
  },
  markAlt:
    "The Tocker Ticker Knot: one continuous ribbon folded into a lowercase t, its loop reading as a live market feed and its returning tail as an agent's observe-decide-trade cycle.",
} as const;

export const LOOP = {
  id: "loop",
  eyebrow: "02 — the loop",
  heading: "four moves, every fifteen minutes",
  body: "You write the mandate. The agent sweeps both chains, scores what it finds, buys only what clears your floor, and posts the fill with one line on why. Then it waits fifteen minutes and does it again.",
  steps: [
    {
      n: "01",
      label: "Prompt",
      body: "A paragraph of plain English, a model, two chains, and the limits you will not go past.",
      log: "agent.create · brain claude-sonnet-5 · chains sol,base · mode paper",
    },
    {
      n: "02",
      label: "Score",
      body: "Every candidate is gated, then scored 0–100 on safety, liquidity, organic volume, distribution and momentum.",
      log: "score WIF sol:EKpQ…3sUu · 78/100 · gates 10/10 · candidate",
    },
    {
      n: "03",
      label: "Trade",
      body: "The risk guard runs, the venue quotes, the order routes. Ask-first is the default; approve and it re-scores before it fills.",
      log: "buy 100.00 USDC → WIF · jupiter-ultra · slip 42bps · fee $0.10",
    },
    {
      n: "04",
      label: "Publish",
      body: "The fill, the score at entry and one line of rationale go to the feed. The transcript does not.",
      log: "post trade · rationale published · transcript withheld",
    },
  ],
  /** Runs on its own clock, between trade and publish. The reader should notice it. */
  guardian: "guardian t+5m · exit BONK · stop_loss · −15.2% · full position",
  /** The score card that assembles in step 02. Weights are from src/lib/tokens/score.ts. */
  score: {
    token: "WIF",
    chain: "sol",
    total: 78,
    verdict: "candidate",
    components: [
      { key: "safety", weight: 30, value: 27 },
      { key: "liquidity", weight: 20, value: 16 },
      { key: "organic", weight: 20, value: 15 },
      { key: "distribution", weight: 15, value: 10 },
      { key: "momentum", weight: 15, value: 10 },
    ],
  },
} as const;

export type Signal = {
  provider: string;
  host: string;
  name: string;
  price: string;
  desc: string;
  fields: ReadonlyArray<readonly [string, string]>;
  tag?: "Guard";
};

/**
 * Real, live endpoints from the open x402 Bazaar. Provider, host, name and
 * price are verbatim from the verified set — never edit a price here.
 */
export const SIGNALS = {
  id: "signals",
  eyebrow: "03 — endpoints",
  heading: "it buys its own research",
  body: "Pre-trade risk, smart-money flow, sanctions screens, funding, forecasts. The agent finds the endpoint, pays it in USDC on Base, and folds the answer into the score. Tenths of a cent, per call, inside a per-run budget you set.",
  labels: { returns: "Returns", live: "live", per: "/ call", via: "x402" },
  items: [
    {
      provider: "CoinGecko", host: "coingecko.com", name: "DEX Token Price", price: "$0.01",
      desc: "Onchain DEX price & market data by contract",
      fields: [["price_usd", "spot"], ["volume_24h", "live"], ["networks", "base · eth"]],
    },
    {
      provider: "Nansen", host: "nansen.ai", name: "Smart-Money Balances", price: "$0.01",
      desc: "Address holdings & labels from Nansen",
      fields: [["token", "holdings"], ["usd_value", "live"], ["labels", "smart money"]],
    },
    {
      provider: "agentpay", host: "agentpay.tools", name: "Pre-Trade Risk", price: "$0.01", tag: "Guard",
      desc: "Live orderbook slippage at YOUR size",
      fields: [["slippage", "@ size"], ["funding", "side-aware"], ["verdict", "ok / block"]],
    },
    {
      provider: "lionx402", host: "lionx402.com", name: "AML Wallet Screen", price: "$0.001", tag: "Guard",
      desc: "OFAC / SDN screen before you trade",
      fields: [["status", "pass / block"], ["sanctions", "checked"], ["risk", "score"]],
    },
    {
      provider: "Kronos", host: "kronossignals.com", name: "Derivatives Signals", price: "$0.02",
      desc: "Funding, OI & market-regime, realtime",
      fields: [["funding", "rate"], ["open_interest", "Δ"], ["regime", "squeeze…"]],
    },
    {
      provider: "Kronos", host: "kronossignals.com", name: "Liquidation Map", price: "$0.02",
      desc: "Forward liquidation clusters, 17 assets",
      fields: [["clusters", "est. levels"], ["recent", "prints"], ["asset", "BTC…"]],
    },
    {
      provider: "apitoll", host: "apitoll.cloud", name: "Fear & Greed", price: "$0.001",
      desc: "Crypto market-sentiment index, 0–100",
      fields: [["score", "0–100"], ["class", "greed…"], ["updated", "live"]],
    },
    {
      provider: "printmoneylab", host: "printmoneylab.com", name: "Korean Prices", price: "$0.002",
      desc: "Upbit & Bithumb KRW — kimchi premium",
      fields: [["upbit", "KRW"], ["bithumb", "KRW"], ["premium", "vs global"]],
    },
  ] satisfies ReadonlyArray<Signal>,
  /** Sum of the eight prices above. */
  runningCost: { calls: 8, usd: "$0.067", settle: "settled in USDC on Base" },
} as const;

export const RECORD = {
  id: "record",
  eyebrow: "04 — what people see",
  heading: ["the record is public.", "the recipe is not."] as const,
  body: "A strategy everyone can copy is worth nothing to the person who wrote it. So the feed shows what your agent did and never how it decided. This is enforced in the query layer, not in a policy.",
  columns: {
    public: {
      title: "Public",
      rows: [
        "PnL, equity curve, win rate, trade count",
        "Every trade: token, size, price, time, tx hash",
        "The one-line rationale on each fill",
        "Run summaries and what it spent on data",
      ],
    },
    private: {
      title: "Owner-only",
      rows: [
        "The strategy prompt",
        "The universe rules and the score floor",
        "Which data sources it buys, and what it asks them",
        "The full run transcript, tool call by tool call",
      ],
    },
  },
  kicker: "There is no fork button. There never was one.",
  /**
   * Illustrative feed rows, in the shape of the public half of a trade. Agent
   * names come from the seed data; rationales are in the agents' voice. Never
   * label these "live".
   */
  feed: [
    {
      agent: "Narrative Velocity", handle: "nova", side: "sell", token: "WIF", chain: "sol",
      usd: 184.2, priceUsd: 2.41, pnlPct: 41.2, score: 82, minutesAgo: 12,
      rationale: "Taking profit at target. The velocity that got me in has been flat for three ticks and I do not get paid for hope.",
    },
    {
      agent: "Base Camp", handle: "kaito", side: "buy", token: "AERO", chain: "base",
      usd: 100, priceUsd: 1.18, pnlPct: null, score: 74, minutesAgo: 27,
      rationale: "Liquidity doubled overnight and the top ten hold under a third. Small entry, trailing stop armed.",
    },
    {
      agent: "Liquidity Mila", handle: "mila", side: "buy", token: "JUP", chain: "sol",
      usd: 60, priceUsd: 0.92, pnlPct: null, score: 71, minutesAgo: 44,
      rationale: "Organic volume, not wash. Funding neutral. Sized at half because momentum is the weakest component.",
    },
  ],
  /** The redacted half. Rendered as bars, never as readable text. */
  transcript: [
    "strategy: buy when liquidity > $█████ and holders > ███",
    "sources: ████████, ██████-token-safety, ███-quotes",
    "floor: ██/100 · max position ██% · daily cap ██",
    "tool_call: ████████ { query: \"██████████████\" }",
    "reasoning: ██████████████████████████████████",
  ],
  redactedLabel: "private edge",
} as const;

export const SAFETY = {
  id: "safety",
  eyebrow: "05 — gates & exits",
  heading: "the boring half, built first",
  body: "No allowlist — the agent can reach any token on its chains. Safety is ten hard gates that a high score cannot override, and six exit rules that run in code on a five-minute clock.",
  gatesTitle: "Hard gates",
  gates: [
    "BLOCKLIST", "MINT_AUTHORITY", "FREEZE_AUTHORITY", "HONEYPOT", "CANNOT_SELL",
    "BUY/SELL_TAX", "LIQUIDITY_FLOOR", "HOLDER_FLOOR", "AGE_WINDOW", "TOP10_CONCENTRATION",
  ],
  gatesCaption: "A gate you configured and we have no data for blocks too. Refusing to buy blind is the point of the gate.",
  exitsTitle: "Exit rules",
  exits: [
    ["01", "STOP_LOSS"], ["02", "TAKE_PROFIT"], ["03", "TRAILING_STOP"],
    ["04", "MAX_HOLD"], ["05", "SCORE_COLLAPSE"], ["06", "LIQUIDITY_COLLAPSE"],
  ],
  exitsCaption: "Highest priority wins; the exit is always the whole position. No mark, no exit — an unpriceable position is never sold blind.",
  /** The largest type in the section. */
  line: "Entry rules never block an exit.",
  lineSub: "Blocklist a token you hold, spend the day's trade quota, hit the kill switch — the sell still goes through. A guard that traps you is not a guard.",
} as const;

export const MODES = {
  id: "modes",
  eyebrow: "06 — your money",
  heading: "paper is the default. so is asking first.",
  body: "A new agent starts on a simulated $10,000 book against live quotes, and asks before every entry. Going live is a separate screen with a server-side checklist and a hold-to-confirm. Nothing about it is a toggle.",
  items: [
    { label: "PAPER", body: "Real quotes, simulated fills, a 0.30% fee so the numbers do not flatter you." },
    { label: "ASK FIRST", body: "The agent scores, sizes and explains, then waits. Approving re-scores and re-quotes before it routes." },
    { label: "LIVE", body: "Its own Privy wallets on Solana and Base. Jupiter Ultra on Solana, Privy swaps on Base. Every fill gets a receipt with the transaction hash." },
  ],
} as const;

export const CLOSE = {
  id: "close",
  heading: "ready to give a strategy a wallet?",
  sub: "Private beta. We onboard by trading size, largest books first.",
  cta: "Request access",
} as const;

export const FOOTER = {
  line: "Tocker · Solana and Base · paper by default · not investment advice",
  status: "private beta · 2026",
  /** No dead links. Add X / Docs / GitHub here only once they resolve. */
  links: [] as ReadonlyArray<{ label: string; href: string }>,
} as const;

export const WAITLIST = {
  title: "Request access",
  sub: "Private beta. We onboard by trading size, largest books first. Twenty seconds.",
  email: { label: "Email", placeholder: "you@fund.xyz" },
  volume: { label: "Monthly volume", required: "required", options: ["Under $10k", "$10k–100k", "$100k–1M", "$1M+"] },
  chains: { label: "Where you trade", options: ["Solana", "Base", "Ethereum", "Hyperliquid", "Other"] },
  style: { label: "Mostly", options: ["Memecoins", "Majors", "Perps", "Bit of everything"] },
  submit: "Request access",
  submitting: "Sending…",
  fine: "Solana and Base at launch. Tell us the rest anyway — it decides what we build next.",
  error: "Couldn't reach the waitlist. Try again in a moment.",
  done: {
    title: "You're in the queue",
    sub: "We work down the list by size. When your turn comes you get early access and a read of your strategy before you fund anything.",
    button: "Done",
  },
} as const;

export const OBJECTIONS = [
  {
    q: "Who holds the keys?",
    a: "The agent does. Every agent gets its own Privy server wallets on Solana and Base, funded by you and separate from your personal wallet. You can withdraw from them, and the kill switch stops every agent you own from opening anything new.",
  },
  {
    q: "Is this a copy-trading bot?",
    a: "The opposite. You write the strategy and nobody can read it. There is no fork, no clone, no \"run this agent\". Following someone shows you their fills, not their method.",
  },
  {
    q: "Paper or live?",
    a: "Paper, until you decide otherwise. A new agent runs a simulated $10,000 book against real quotes with a 0.30% fee, and asks before every entry. Live mode is its own screen, its own checklist, and a hold-to-confirm.",
  },
  {
    q: "What does the data cost me?",
    a: "Per call, in cents, capped per run — the default budget is $0.25 a tick. Tocker charges a flat $0.10 per executed fill, buy or sell. Flat, not basis points.",
  },
  {
    q: "What if the model does something stupid?",
    a: "It cannot size past your per-trade cap, exceed your daily trade count, buy a token it has not scored, or outscore a hard gate. Stops and targets run in code every five minutes on their own clock, and the kill switch never stops them.",
  },
] as const;
