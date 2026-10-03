# 13 — Polymarket as an expansion market for agents (as of 2026-10-03)

Method: WebSearch worked. WebFetch was blocked for theblock.co, docs.polymarket.com, pm.wiki and substack, so the figures below come from search snippets and have not been checked against the primary pages. Verify before the deck ships.

## Scale
- **2025:** about $21.5B traded, roughly 700% YoY. Peak month was Oct-2025 with 477,850 active traders ([Sacra](https://www.sacra.com/c/polymarket/), [TradeTheOutcome](https://www.tradetheoutcome.com/prediction-markets-in-2025-data-stats-key-trends/)). Paradigm notes that some volume is double-counted.
- **2026 monthly:** Feb >$7B, a record at 7.5x YoY ([KuCoin](https://www.kucoin.com/news/flash/polymarket-sets-new-daily-and-monthly-trading-volume-records-in-february-2026)). Mar $12.22B per the DeFi Rate dashboard. Jun $10.8B, driven by the World Cup ([Portals](https://blog.portals.fi/prediction-markets-volume-2026/)). Sources measure this differently.
- **Sector:** Kalshi and Polymarket together traded $45B in Jun-2026, up 75% ([The Block](https://www.theblock.co/post/406983/kalshi-polymarket-volume-45-billion)). The whole sector reached $50.6B in Jul-2026 ([Tangem](https://tangem.com/en/news/markets/35504-prediction-markets-hit-50-6b-record-in-july-2026/)).

## Capital
- Oct-2025: ICE invested up to $2B at a $9B post-money valuation ([The Block](https://theblock.co/post/373641/nyse-parent-firm-ice-eyes-2-billion-investment-in-polymarket-wsj)).
- Apr-2026: $1B raised at $15B, including $600M more from ICE ([Finance Magnates](https://www.financemagnates.com/fintech/polymarket-seeks-valuation-above-20-billion-with-15-billion-round-in-april-went-unreported-until-now/)).
- Later in 2026: a round led by 1789 Capital at $21B post-money ([Bloomberg Gov](https://news.bgov.com/private-equity/polymarket-funding-round-led-by-1789-values-firm-at-21-billion)).
- **Kalshi for context:** $1B at $22B in May-2026, led by Coatue. Over $17B traded in May, about 65% of it sports. Now in talks at around $40B ([The Block](https://www.theblock.co/post/400413/kalshi-hits-22-billion-valuation-after-1-billion-raise-led-by-coatue)).

## US relaunch
- Polymarket bought QCEX, a CFTC-licensed exchange, in Jul-2025. It received an amended CFTC designation in Nov-2025.
- The US iOS app opened with no waitlist on 2026-05-12. It is sports-first, with no Android or web version yet ([Covers](https://covers.com/industry/polymarket-removes-waitlist-launches-for-american-ios-users-may-12-2026)).

## Chain and bot access
- Polymarket currently settles on Polygon.
- Its plan to move to its own Ethereum L2, called "POLY", has only been reported by low-quality outlets (Discord-sourced). It is **unconfirmed**, so do not put it in the deck.
- The order book (CLOB) is hybrid: orders match offchain and settle onchain. There are official TypeScript, Python and Rust SDKs. CLOB V2 shipped on 2026-04-28 with pUSD as collateral ([Polymarket docs](https://docs.polymarket.com/developers/CLOB/clients)).
- Polymarket publishes an open-source AI agent framework under the MIT licence ([github.com/polymarket/agents](https://github.com/polymarket/agents)).

## Bots and agents
- "5% of bot-like wallets do 75% of volume" and "14 of the top-20 profit wallets are bots" come from secondary blogs whose methodology is unclear. **Do not use them in the deck.**
- **PolyStrat** (Olas/Valory) launched in Feb-2026. It runs self-custodied in a Safe account and made 4,200+ trades in its first month. The claim that 37% of agents have positive P&L versus about half that rate for humans comes from Olas itself ([MEXC/Olas coverage](https://www.mexc.com/news/932530)).
- **x402:** these are community projects, not official Polymarket integrations. BlockRunAI's hackathon agent pays for its own LLM calls over x402. Semantic 42 "Prophet Arena" (Nov-2025) runs competing agents built on x402 and Polymarket. Polygon also documents x402 agentic payments ([Polygon docs](https://docs.polygon.technology/payment-services/agentic-payments/agentic-services)).

## Pitch-ready stats
1. "Polymarket: $21.5B traded in 2025, up ~700%." — Sacra
2. "NYSE owner ICE invested $2B; Polymarket now valued $21B." — The Block / Bloomberg
3. "Kalshi + Polymarket traded $45B in June 2026 alone." — The Block

## Why agents fit
Prediction markets reward whoever can read the news fastest, around the clock, and turn it into calibrated, size-capped bets without tilt. That is exactly an agent's edge, and a public record makes the edge verifiable.
