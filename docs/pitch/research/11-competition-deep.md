# 11 — Competitive landscape (as of 2026-10-03)

**Method note.** WebSearch worked; WebFetch was egress-blocked for sail.money and definitive.fi, so Sail facts come from its public GitHub repos (cloned read-only) plus search snippets. Snippet-only facts are marked (s). "?" = unverified.

## Which "Sail"? (confidence: high, ~85%)
It is **Sail / sail.money**: "Onchain Separately Managed Accounts run by agents". This is not **Sail Research**, the $80M Sequoia/Kleiner-backed agent-inference company (Jun 25 2026, $450M valuation), and not SailPoint (SAIL).
- **What it does:** The **Sail Protocol** keeps user funds in a self-custodied Safe. An agent "manager" can only act through a *mandate*, a set of Solidity `IPermission` contracts that the kernel checks on every transaction, and the owner can revoke it instantly. **Sailor** (MIT, npm `@sail.money/sailor`, v2.3.0 on 2026-09-11) turns Claude Code or Codex into a "money agent" builder: strategy → mandate → tick loop, all **running on the user's own machine**. **Harbor** is a registry of ready-to-run blueprints. The reference blueprint is a rebalancing portfolio basket across Base, Ethereum and Robinhood Chain.
- **Chains:** 10 EVM mainnets: Ethereum, Base, Optimism, Arbitrum, Unichain, BSC, World, MegaETH, HyperEVM and Robinhood. **No Solana.**
- **Pricing:** The protocol charges a flat native-token fee per permission registered. Its cut of manager fees is capped at 25% and set to **0% at launch**. Managers can charge management and performance fees on AUM above a high-water mark.
- **Funding / traction:** I found no funding or usage numbers. A search snippet linked a Definitive "Flash API" blog post to Sail (s, page blocked).
- **Vs Tocker:** Sail sells **bounded custody** to developers (DeFi portfolio, yield and DCA, an SMA/fund model). Tocker is a **hosted, no-code, discovery-first** product for new-launch Solana and Base tokens. It adds a 0–100 scoring screen, x402 data and a public rationale feed. Sail's mandates are the strongest *enforced* safety model in the field. Tocker's gates are enforced in its own code, not on-chain.

## Field scan (2025–26)
| Player | What / autonomy | Chains | Funding · traction (source, date) |
|---|---|---|---|
| **Senpi** | Personal autonomous perp agents (OpenClaw), 31 tools | Hyperliquid | $4M seed (Coinbase Ventures, Lemniscap; CrowdfundInsider, Sep 2025); >$100M volume (The Defiant, Feb 2026) |
| **Fere AI** | Self-improving 24/7 agent with its own wallet; $29/mo Pro | ETH, SOL, Base, Arb, BNB, Polymarket | $1.3M seed led by Ethereal (GlobeNewswire, Apr 23 2026); 10M+ agent actions |
| **Bankr** | Chat/social agent for swaps and token launches; earns from swap fees | Base and others | Fair-launch token; $35.8B swap volume since Q3-25 (0x case study, 2026) |
| **Coinbase for Agents / Agentic Wallets** | Wallets, MCP and CLI so any agent can trade and pay over x402 | Base and Coinbase | Launched Feb 11 and Jun 11 2026 (Cointelegraph, LetsDataScience) |
| **GMGN Agent API / Skills** | MCP API: 500+ data fields, TP/SL orders | SOL, BSC, Base | Internal test opened Mar 18 2026 (s) |
| **Cod3x** | Natural-language perp agents with smart wallets | Hyperliquid, GMX | ? |
| **Nof1 (Alpha Arena)** | Public real-money benchmark of LLM traders | Hyperliquid | $15M (May 2026, s) |
| **Recall** | On-chain agent competitions and reputation | multi | AlphaWave drew 1,000+ agent teams (Alea, 2025) |
| **Virtuals** | Agent launchpad plus ACP agent commerce; large x402 user | Base+ | $479M aGDP, 18k agents (Mar 2026, BlockEden) |
| **Surf** | Crypto research AI, not an executor | — | $15M led by Pantera (Dec 2025); 1M+ reports |
| **Almanak / Giza** | Quant and yield agent swarms | EVM | $8.4M (Aug 2025) / $5.2M; ARMA ~$3M AUA |
| **Griffain / Hey Anon / Wayfinder / Spectral** | Chat DeFAI copilots, mostly token-driven | SOL / multi | No 2026 traction found |
| **Axiom** | Human-click trading terminal | SOL, Base | $100M revenue in 4 months (The Block, 2025) |
| **Photon / Trojan** | Click terminal / Telegram bot, ~1% fee | SOL | Trojan: $25B+ volume, 2M users (CrowdfundInsider) |
| **fomo** | Social trading app with public trades | multi | $75M Series B led by Index at $550M valuation; 625k traders, $4B volume (Cointelegraph, Jun 2026) |
| **Kolscan** | Free tracker and leaderboard of KOL wallets | SOL | — |
| **Nava** | Escrow for agent payments with reasoning posted on-chain | Arbitrum | $8.3M (Fortune, Apr 2026) |

## 1. Slide: 8 competitors in 3 categories
- **Autonomous agent platforms:** Sail, Senpi, Fere AI
- **Agent rails / chat agents:** Coinbase for Agents, Bankr, GMGN Agent API
- **Human-click and social trading:** Axiom, fomo

(Nof1 and Recall are better used as *demand proof* than as competitors.)

## 2. Matrix (Y / P = partial / N)
| | 24/7 autonomous | User's own strategy | Enforced safety gates | Pays for data via x402 | Public verifiable record |
|---|---|---|---|---|---|
| **Tocker** | Y | Y | Y (10 hard gates) | Y | Y (feed + rationale) |
| **Sail** | P: the loop runs on the user's machine | Y | Y: on-chain mandate (bounds actions, does not screen tokens) | N? (none seen in repo) | P: on-chain SMA, no feed |
| **Senpi** | Y | Y | P? (no new-launch screening; perps on majors) | ? | P: Hyperliquid fills are public |
| **Fere AI** | Y | P: goal-set, self-improving | ? | ? | P |
| **Coinbase for Agents** | P: depends on the user's agent | Y (bring your own agent) | N? | Y: built to pay for premium data | N |
| **Bankr** | P: limit/DCA automations | P: prompt by prompt | N | ? | P: public social commands |
| **GMGN API** | P: developer-built | Y | P: safety data supplied, not enforced | N? | N |
| **Axiom** | N | P: manual | P: filters only | N | N |
| **fomo** | N | P: manual | N | N | Y: public social trades |

## 3. Biggest threat and Tocker's answer
**Threat:** Coinbase for Agents and Agentic Wallets plus x402 turn "an agent with a wallet that pays for data" into a free primitive for any ChatGPT or Claude user. **Tocker's answer:** it is the hosted, opinionated layer above those rails. It discovers and scores every new launch, enforces safety gates before any trade, and builds a public, auditable track record while the strategy stays private. Coinbase's rails ship none of those, and a public record makes a strategy worth more over time.
