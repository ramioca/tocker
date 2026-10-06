# Tocker Series A deck: narrative proposal (9 slides)

The arc in one line: retail loses on memecoins and can't afford a bot of its own → Tocker is the infrastructure for that bot → you can see it working → it pays for data that screens out rugs → traders already pay 1% for worse tools → nobody else runs the whole loop → every trade is distribution, then new markets.

Speaker notes total **439 words**, about 3 minutes at 145 wpm. Per slide: 40 / 73 / 49 / 44 / 61 / 42 / 45 / 56 / 29.

Rules applied throughout: one message per slide, every figure dated and sourced, roadmap items said in the future tense.

---

## 1. Cover (unchanged)
- **Message:** Tocker is the infrastructure for agentic trading.
- **Headline:** keep exactly as is: "The infrastructure for agentic trading."
- **Elements:** keep as is.
- **Speaker note (40):** Hi, I'm [name], and this is Tocker: the infrastructure for agentic trading. You describe a strategy in plain English, and your own AI agent trades it around the clock, with the wallet, the data and the guardrails already built in.

## 2. Problem
- **Message:** Retail loses on memecoins, and building your own bot is out of reach.
- **Headline (7 words):** **Retail loses on memecoins. Bots cost too much.**
- **Elements (3):**
  1. **9 in 10** pump.fun traders lost money or made under $100. *Source: Dune wallet PnL, Aug 2024, via The Defiant (60% lost, 4.7% made $0, 24% made <$100).*
  2. **~21,000 new tokens a day**, and **15,000+ launches a month sniped in the first block** by deployer-funded wallets. *Source: CoinGecko Research, Jun 2026 (18.67M tokens ÷ 886 days is our arithmetic); Pine Analytics, 2025.* This covers no alpha, bots and FOMO in a single line.
  3. **~$159/mo for data alone** to run your own bot (Nansen Pro $69 + LunarCrush $90), before servers, RPC and keys. *Source: CostBench; LunarCrush support (research/12).*
- **Change from current:** replace the "0.4s" tile and the "24/7 … Only funds can" tile. Neither has a source behind it (0.4s is just a Solana slot time). The $159 figure is the only sourced cost for running a bot yourself.
- **Speaker note (73):** Memecoins are where retail trades on-chain, and retail loses. In 2024, nine in ten pump.fun traders lost money or made under a hundred dollars. About twenty-one thousand tokens launch a day, and insiders snipe fifteen thousand a month in the first block. The fix is your own bot, but you'd have to build it, host it 24/7 and pay for data: about a hundred and sixty dollars a month for two subscriptions alone.

## 3. Solution
- **Message:** Tocker provides the bot infrastructure: wallet, paid data, guardrails and execution.
- **Headline (4):** **Tocker is that infrastructure.** (keep)
- **Elements:** keep the 4-step flow (strategy → any LLM → x402 data → trades 24/7) and the 4 pillars:
  - **Wallet:** its own Solana and Base wallet.
  - **Data:** pays per call over x402.
  - **Guardrails:** 10 hard gates before a buy, exits in code.
  - **Execution:** Jupiter on Solana, native swaps on Base.
- **Fix:** change "We sponsor the gas" to **"We pay Solana gas."** The code and SPEC confirm sponsorship on Solana only (SPEC.md:174).
- **Speaker note (49):** Tocker is that infrastructure. You write a strategy in plain English and bring any AI model. Your agent gets its own wallet, pays for premium data per call over x402, and trades around the clock. Ten hard safety gates run before every buy, and exits are enforced in code.

## 4. Product
- **Message:** You write the strategy in words, and the agent does the rest.
- **Headline (7):** **You describe it. The agent runs it.** (keep)
- **Elements:** the product screenshot, with the caption kept as "Sample run". Optionally add 3 mono tags: **Score 0–100 · 10 hard gates · Paper first** (score.ts, config.ts).
- **Speaker note (44):** Here's a sample run in the product. The agent scores every new launch from zero to a hundred, checks your floor and all ten gates, sizes the trade and sets its stop and target. Every agent starts on paper and asks before it buys.

## 5. x402 alpha
- **Message:** Before buying, the agent pays for data that screens out rug setups.
- **Headline (8):** **Before every buy, the agent checks for rugs.** It replaces "pays for the truth" and makes the rug link the founder wants explicit.
- **Elements:**
  1. The 4 cards stay. Each has its question, provider and price from the code registry:
     - Sentiment: x402Atlas, $0.006
     - Rug risk: Deepnets, $0.01
     - Smart money: Nansen, $0.05
     - Sell check: Plexa, $0.05
  2. **About $0.10 for a full check** (Base: $0.006 + $0.05 + $0.05 = $0.106, research/12). A failed sell check blocks the buy.
  3. Footnote: the same data by subscription costs ~$159/mo (Nansen Pro + LunarCrush).
- **Honesty fixes (footnote):**
  - "Sell check on Base; on by default: sentiment and rug risk." Plexa's check runs only on Base tokens (index.ts:437), and Nansen and Plexa are not default sources.
  - Never say "prevents rugs". Say "screens" or "skips". Slow rugs, KOL dumps and insider supply spread across many wallets still get through (research/02).
- **Speaker note (61):** This is how it screens for rugs. Before it buys, the agent pays a few cents per answer. Is the chatter real or a paid shill? Are insiders holding the supply? Is smart money buying or selling? Can it actually sell, or is it a honeypot? A full check costs about ten cents, and a failed sell check blocks the trade.

## 6. Business model
- **Message:** Traders already pay 1% for trading tools; Tocker will charge 0.2%.
- **Headline (7):** **Traders already pay 1%. We'll charge 0.2%.**
- **Elements (2):**
  1. **$940M** paid to trading bots and terminals by Solana traders **in 2025**. *Source: Solana Foundation 2025 recap, data by Blockworks Research.*
     - Use $940M, not $1.7B. The $1.7B adds $762M of launchpad fees, and launchpads are not "trading tools" or something Tocker replaces (research/04 SAM). If you keep $1.7B, label it "bots, terminals and launchpads".
  2. **20 bps planned vs 1%** at Photon, Trojan and BonkBot (Axiom 0.75–1%): 5× cheaper. Users bring their own AI key. *Source: madeonsol; TYN Magazine, 2026.*
- **Honesty fix:** the code charges a **flat $0.10 per fill** today (platform/fee.ts:24). Label the fee "planned" or "at launch", or move to 20 bps in code before the pitch.
- **Speaker note (42):** Traders already pay for tools. In 2025, Solana traders paid nine hundred and forty million dollars to bots and terminals, most charging one percent a trade. We're moving to twenty basis points, five times cheaper, and users bring their own AI key.

## 7. Competition
- **Message:** Others have built pieces; only Tocker combines all five.
- **Headline (6):** **Nobody else runs the whole loop.** Plainer than "Others built pieces. We run the loop."
- **Elements:**
  - Keep the matrix exactly:
    - **Columns:** Runs 24/7 · Your strategy · Rug gates · x402 data · Public record
    - **Rows:** Tocker, Sail, Senpi, Ask Gina, Coinbase for Agents, GMGN Agent API, Axiom, fomo
  - Keep the footnote "Tocker's assessment from public docs, Oct 2026".
- **Honesty fixes:**
  - Claim the combination, never "first" or "only AI agent". Fere AI, Bankr and Senpi exist (research/07).
  - Ask Gina's "Rug gates —" and "Public record —" mean "not found". The footnote already says so.
  - Tocker's gates are enforced in Tocker's own code, not on-chain like Sail's mandates. Don't oversell them.
- **Speaker note (45):** Others built pieces. Terminals like Axiom make you click every trade. Chat agents like Ask Gina wait for instructions. Coinbase gives agents wallets, and Sail gives them guardrails. None we've found runs your own strategy 24/7 with rug gates, paid data and a public record.

## 8. Go-to-market
- **Message:** Every trade is public, so growth is built in, and the same agent then expands to new markets.
- **Headline (4):** **Every trade markets itself.** (keep)
- **Elements:**
  1. The loop, in 4 steps:
     1. An agent trades in public.
     2. Each post carries a verified PnL; the strategy stays private.
     3. Followers launch their own agent.
     4. Creators earn a fee share (*planned*).
  2. **fomo: 120K → 1.9M users** on a verified-trade feed. *Source: Decrypt citing TechCrunch, Nov 2025; Odaily, Sep 2026.*
  3. Footer: **Next: Polymarket, then tokenized stocks.** Optionally add one figure each:
     - Polymarket $21.5B traded in 2025 (Sacra, snippet-only)
     - Solana tokenized-stock DEX volume $5.8B in Q2 2026 (SolanaCompass, snippet-only)
- **Honesty fixes:**
  - Creator payouts are not built, so mark them "planned". A creator's cut is cents, so pitch reputation over income.
  - Never use the word "copy" here.
  - Polymarket and tokenized stocks are roadmap. Ask Gina is already live on Polymarket, so prepare an answer.
  - "Verified" means frozen entry scores plus fill receipts. Be ready to explain it.
- **Speaker note (56):** Distribution is built in. Every agent trades in public with a verified record, while its strategy stays private. Followers launch their own agent, and next, creators earn a share of fees. fomo grew from a hundred and twenty thousand to 1.9 million users on verified trades. Then the same agent moves to Polymarket and tokenized stocks.

## 9. Thanks
- **Message:** Built fast, live in beta, here's the ask.
- **Headline:** **Thank you.** (keep), with tocker.xyz.
- **Elements:** add one line, "Raising [$__] to [goal]", if the round is being pitched. Optionally add "Shipped in 23 days · private beta on Solana and Base" (269 commits, 10 Sep → 3 Oct, research/09).
- **Speaker note (29):** We built and shipped this in under four weeks, and it's in private beta at tocker.xyz on Solana and Base. Tocker: your agent trades while you sleep. Thank you.

---

## Credibility risks and how to phrase them

| Risk | Where | Honest phrasing |
|---|---|---|
| **20 bps is not in the product.** Code charges $0.10 flat per fill (fee.ts:24). | Business | "We'll charge 20 bps" / "Planned: 20 bps". Or switch the code before pitching. |
| **Unit economics are negative today.** Typical data spend is ~$8.80/day per default agent. Fees max out at ~$2/day at $0.10, or ~$4/day at 20 bps on $100 × 20 fills. | Q&A | "Revenue scales with fills and data cost with ticks, so next we buy data per token, shared across agents, not per agent." None of these levers are built yet (research/05). |
| **Creator payouts are not built.** | GTM | "next, creators earn a share of fees" / "(planned)" |
| **Polymarket and tokenized stocks are roadmap.** Market figures are snippet-only. | GTM | "Next:". Don't claim integrations; verify Sacra and SolanaCompass first. |
| **No traction.** There is a waitlist only; seed data is demo data, and live trading is founder-tested only. | Overall / Thanks | Use "private beta" and "every agent starts on paper". Don't show feed numbers as real (the GTM caption already says "demo data"). For a Series A this is the biggest gap: add a real waitlist count, active paper agents or fills if they exist. |
| **"9 in 10 lose".** | Problem | Always "lost money **or made under $100**", dated 2024. Outright losers were 50–70%. In Apr 2026, 73% were profitable after the losers left. |
| **"0.4s" and "Only funds can".** Neither is sourced. | Problem | Replace with the Pine Analytics first-block stat and the $159/mo data cost. |
| **"Protects you from rugs".** | Alpha | Say "screens for rug setups" or "skips". A sell check runs only on Base. |
| **"We sponsor the gas".** | Solution | "We pay Solana gas." |
| **$1.7B "trading tools".** | Business | Use $940M (bots and terminals), or label $1.7B as including launchpads. Always say "in 2025": Q2 2026 ran at ~43% of 2025's pace. |
| **"Only" / "first".** | Competition | "None we've found combines all five" plus the dated assessment footnote. |
| **Snippet-sourced figures.** Research pages could not be opened directly. | All | Click through each cited source before the deck goes out (README "Check these" table). |
