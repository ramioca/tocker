# 25 · ClawPump (added to the competition slide, Oct 8 2026)

**What it is.** Its own site calls it the "financial layer for autonomous AI agents on Solana".
- Agents get self-custody wallets and 104–132 MCP tools (the count differs by page). The tools cover swaps, perps, DeFi yield, market intel and payments.
- Agents can launch tokens on pump.fun without paying gas. ClawPump is the fee recipient and passes most creator fees back to the agent: 75% per the clawpump.tech docs, 65% on older listings.
- Agents run 24/7 on its infrastructure. Its pitch is "Where agents become agentic companies".

**Cells on the slide (marks as of Oct 2026)**

| Column | Mark | Evidence |
|---|---|---|
| USDC inference | ◐ partial | Docs: built-in models (Llama, DeepSeek, Claude, GPT, Kimi) billed via **platform credits** at a 30% markup on inference; BYO OpenAI/Anthropic also supported. I found no source saying the agent pays per call in USDC. |
| x402 alpha | ✓ live | Docs: "Discover Pay.sh / x402 providers, approve a spend cap, and let agents call paid APIs in USDC." It also *sells* x402 market-intel calls. |
| Filters & gates | ◐ partial | No built-in rug gate found. A community "Meme Token Analyzer" skill does rug detection, and a third-party "Gatekeeper" skill runs a 12-check screen. Both are opt-in, not enforced before a buy. |
| Social trading | — not found | "Social skills" means agents post. I found no public trade feed, follow or copy feature, and no leaderboard. |
| Autonomous 24/7 | ✓ | "Agents run 24/7 on our infrastructure." |

**Best at.** Agent wallets + token launches: it is the agent-economy launchpad on Solana.

**Backing.**
- Pump Fund invested $250K as the 5th winner of Pump.fun's $3M Build in Public hackathon.
- It is in Colosseum's portfolio (Cohort 5) and was a Colosseum Frontier hackathon winner.
- Its site also cites the Solana Incubator.

**Traction (company-reported, unaudited, figures conflict).**
- Over $10M on launch day; over $55M and 1,700 agents after three weeks.
- Later $170M volume, 14,000 agents and $2M+ revenue (El Economista); $180M and 17,500 agents (Ecosistema Startup).
- The slide shows backers, not volume, because the volume figures are unverified and inconsistent.

**Why it matters for the narrative.** ClawPump is the strongest proof that the category is real and early. It is infrastructure for agents to *earn* (launch tokens, collect fees). Tocker is a strategy agent that *trades for a person*, with paid alpha, enforced gates and a public record. Including it means the old headline "Only one buys alpha" is no longer true, so the headline is now "An early category. A different approach."

**Sources (fetched via search, Oct 8 2026)**
- clawpump.tech homepage, /docs, /developers, /analytics
- Pump Spotlight on X (Build in Public, 5th $250K investment): https://x.com/pumpspotlight/status/2033637904065388863
- SolanaCompass, Colosseum Frontier 2026 winners: https://solanacompass.com/news/colosseum-announces-26-winners-of-the-solana-frontier-hackathon-the-largest-crypto-hackathon-ever
- El Economista ($170M, 14,000 agents): https://eleconomista.com.ar/finanzas/clawpump-nueva-economia-agentes-plataforma-solana-ya-proceso-us-170-millones-n98580
- Ecosistema Startup ($180M, 17,500 agents): https://ecosistemastartup.com/clawpump-la-startup-que-mueve-us180m-con-agentes-ia/
- Rankia (launch-day and three-week figures): https://www.rankia.mx/blog/blockchain-latinoamerica/7375971-hackathon-produccion-stack-clawpump-que-atrajo-mirada-pump-fun
- Gatekeeper skill (third-party): https://github.com/trelnar/clawpump-products
- Note: clawpump.net and clawpumpsol.com are separate sites with different fee claims. Only clawpump.tech is linked from @clawpumptech.
