## Competitive landscape: what retail memecoin traders use in 2026

### Landscape table
Autonomy: Click (you click) · Semi (rules, copy or chat) · Auto (unattended). Safety = screening that *blocks* a bad buy. n/v = not verified.

| Player | What it is today | Autonomy | Safety | Fee | Chains | Metric (source, date) |
|---|---|---|---|---|---|---|
| **Axiom** | Solana meme terminal + Hyperliquid perps | Click | Partial (shows, doesn't block) | 1% spot, 0.75–0.95% net ([Medium](https://medium.com/@crypto-deploy/axiom-trade-fees-what-you-actually-pay-and-how-to-pay-less-0df290e57f7b)) | SOL, HL | $100M revenue in ~4 months ([The Block](https://www.theblock.co/post/355676/axiom-exchange-hits-100-million-in-revenue-just-four-months-after-launch), 2025) |
| **GMGN** | Terminal, wallet PnL, copy-trade, Agent API | Click/Semi | Partial | 1% ([Datawallet](https://www.datawallet.com/crypto/gmgn-explained)) | SOL, BNB, ETH, Base +7 | Agent API test 18 Mar 2026; 40+ agent skills Apr 2026 ([MEXC News](https://www.mexc.com/news/953362), secondary) |
| Photon · BullX Neo · Terminal (ex-Padre) | Speed-first web terminals | Click | Partial | ~1% ([MadeOnSol](https://madeonsol.com/blog/gmgn-vs-photon)) | SOL + EVMs | Padre bought by Pump.fun ([Cointelegraph](https://cointelegraph.com/news/pumpfun-acquires-padre-trading-terminal-solana-memecoins), 2025) |
| Trojan · BonkBot · Maestro · Banana Gun | Telegram swap/snipe bots | Click/Semi | Partial | ~1% | SOL; some multi | Trojan ~$24B lifetime volume ([Datawallet](https://www.datawallet.com/crypto/best-crypto-telegram-bots), 2026, secondary) |
| Kolscan · Cielo · Nansen | Wallet leaderboards, alerts, mirroring | Semi | No | n/v | multi | n/v |
| **fomo** | Social trading app: feed, follows, leaderboards | Click | n/v | n/v | multi | $75M Series B ([VCA Online](https://www.vcaonline.com/news/2026062205/fomo-raises-75-million-series-b-led-by-index-ventures-to-scale-global-consumer-trading-app/), 22 Jun 2026); passed Axiom in daily Solana volume ([Solana Compass](https://solanacompass.com/news/fomo-overtakes-axiom-as-solanas-top-daily-trading-terminal-by-volume)) |
| **Bankr** | Chat-to-trade agent on X/Farcaster | Semi | No | n/v | Base+ | $35.8M swaps in 6 months ([0x case study](https://0x.org/case-study/bankr), vendor) |
| **Fere AI** | Agents research, execute, monitor 24/7 with stop-losses | Auto | n/v | n/v | ETH, SOL, Base +2 | $1.3M raised; #2 Product Hunt, 17 May 2026 ([Hunted](https://hunted.space/product/fere-ai)) |
| **Senpi** | Personal perp agents in Telegram | Auto | n/v | n/v | Hyperliquid | ">$100M volume" ([company PR](https://thedefiant.io/news/press-releases/senpi-launches-the-first-personal-trading-agents-for-hyperliquid), 2026) |
| Griffain · Hey Anon · Wayfinder · Spectral · Cod3x | Chat-to-DeFi and agent builders; Spectral moved to perps | Semi/Auto | No | n/v | SOL / multi / HL | 2026 activity n/v |
| Almanak · Giza | AI yield vaults, not memecoins | Auto | n/a | Giza 10% of yield ([Alea](https://alearesearch.substack.com/p/giza-agentic-automated-yieldswhat)) | ETH / Base | Almanak TVL ~$9.8M ([DefiLlama](https://defillama.com/protocol/almanak)) |
| Nof1 (Surf = research only) | LLM live-trading benchmark | Auto | No | n/a | n/a | 6 of 32 model runs profitable ([Business Standard/Bloomberg](https://www.business-standard.com/markets/news/ai-bots-auditioning-for-wall-street-trading-are-mostly-losing-money-126050701793_1.html), 7 May 2026) |
| **Tocker** | Plain-English strategy → own agent + wallets | Auto (entry approval default; code exits every 5 min) | **Yes: 10 gates + score** | **$0.10/fill** | SOL, Base | pre-launch |

### 2×2 placement
X: you click → agent trades 24/7. Y: copyable or opaque → public record, private strategy.

```
              PUBLIC RECORD · PRIVATE STRATEGY
                             │                ★ TOCKER
   fomo (trades copyable)    │  Nof1 (reasoning public)
 YOU CLICK ──────────────────┼────────────────── AGENT 24/7
  GMGN (sells copying)       │  Bankr     Fere AI · Senpi
  Axiom · Photon · Trojan    │
              COPYABLE / OPAQUE
```

### Differentiators
1. Plain-English strategy becomes a 24/7 agent.
2. Ten hard gates refuse rugs before buying.
3. Public record, private recipe, no copy button.
- Bonus: $0.10 flat per fill, not 1%.

### Biggest threat
GMGN or Axiom adding agents to the distribution they already have. GMGN opened an Agent API and skill hub in Mar–Apr 2026, and fomo has the social graph and fresh capital. Tocker's answer:
1. Their social layer *is* copy-trading, which is incompatible with a private strategy.
2. A 1% fee rewards bigger tickets. Tocker's flat fee doesn't, and its gates refuse bad trades in code.
3. Frozen entry scores and per-fill receipts make the record credible, and it doesn't move to another platform.
4. Tocker works with any model (bring your own key) and buys incumbents' data per call (Nansen already).

### Why "no copy-trading" is a feature
Copy-trading taxes the leader. Followers and bots buy in the same blocks, so the leader gets worse fills and crowded exits, and the edge decays once it's visible. Leaders respond by hiding behind fresh wallets, or by farming followers they then sell into. Tocker makes the record public and permanent but keeps the recipe private, so publishing costs a skilled operator nothing and earns reputation. The leaderboard fills with real performance, not bait.

### Suggested slide copy
- "Terminals make you click. Copy-bots make you a follower."
- "Public record. Private strategy. Trading 24/7."
- "Every launch scored. Every rug refused. Every fill public."

Spoken: "Today you click all night on Axiom or copy someone's wallet on GMGN. Tocker turns your own strategy into an agent that trades around the clock, refuses rugs in code, and builds a public record without giving the strategy away."

### Caveats / what not to claim
- **Not "first" or "only" AI agent.** Fere AI, Senpi, Bankr and DIY agents exist, so claim the combination.
- **Not "uncopyable".** Agent wallets are public on-chain. Tocker just doesn't sell copying.
- **Not "cheaper" outright.** The flat fee beats 1% only above $10 a ticket, and LLM costs are extra.
- **Not "rug-proof".** Gate data providers can miss.
- **Skip "AI agents = 34% of Solana meme volume"** ([Blockonomi](https://blockonomi.com/from-8-to-34-how-ai-agents-took-over-solana-memecoin-dex-volume-in-90-days/)): it has no primary data behind it.
- **Nof1's figure** comes from a US-stocks season, not memecoins.
- **Not covered:** Moonshot, Vector, Believe, Nova, Bloom, Sol Trading Bot.
- **Verification gap.** Pages were blocked and the search budget ran out, so figures come from search extracts. Re-check them before the deck ships.
