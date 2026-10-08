# Proof points for the "what rivals share vs what Tocker does" slide

Researched 2026-10-08. The only primary source I could open directly was the DXRG paper PDF (arXiv 2609.05663), through its GitHub repo. arxiv.org, chainalysis.com and soliduslabs.com were blocked from this container, so every other figure was checked through WebSearch "extended" excerpts of the primary page. Each figure below is marked with where it was verified.

Confidence scale: **H** means quoted from the primary source or several consistent primary excerpts. **M** means a primary excerpt plus a caveat. **L** means secondary, vendor or unverified.

---

## Corrections to the brief

1. **The arXiv ID is split across two papers.**
   - **arXiv 2604.26091** (Barton et al., DXRG, 28 Apr 2026), "Operating-Layer Controls for Onchain Language-Model Agents Under Real Capital", is the source for 3,505 user-funded agents, 21 days, ~$20M volume, 7.5M invocations, ~300K onchain actions, 5,000+ ETH and fabricated sell rules falling from 57% to 3%. Its abstract does not contain "no directional edge".
   - **arXiv 2609.05663** (Barton et al., DXRG, Sep 2026), "What LLM Trading Agents Actually Do in Production", is where that wording appears: *"Fourth, neither fleet shows a directional edge."* (abstract), and *"(iii) No performance claims. Neither population shows a directional edge"* (§1). This paper calls the 3,505 "user-funded vaults".
2. **The Alpha Arena "31–63%" range does not match the final balances.** The founder-reported final balances (via ForkLog, Nov 2025) imply losses of 42–59%: Claude $5,799, Gemini $5,445, Grok $4,208, GPT-5 $4,126, each from $10,000. The "−30.8 / −45.3 / −56.7 / −62.7%" set comes from blog tables that are not tied to a dated capture. Safe wording: "4 of 6 lost money; GPT-5 lost ~60%."
3. **The Chainalysis 94% is confirmed in the primary blog table:** 69,897 of 74,312 suspected pump-and-dump pools were "rugged by the address that created the DEX pool". The 89%/11% split comes from later CryptoPotato coverage. Cite 94%. Date: the chapter went out on 29 Jan 2025 (Chainalysis X post); press calls it Feb 2025.
4. **Solidus Labs has no 2026 memecoin follow-up.** Newer 2026 academic work is listed under SAFETY.

---

## Row 1 — DATA (cost of deciding on bundled in-house data)

### D1. DXRG / DX Terminal Pro — the strongest fit, from the same market as Tocker (Base memecoins)
- **Source:** Barton et al., arXiv 2609.05663, Sep 2026. PDF read directly from https://github.com/ProjectDXAI/continuous-record-llm-trading-agents (paper.pdf). The prior paper is https://arxiv.org/abs/2604.26091 (28 Apr 2026).
- **Exact figures (§3.1):**
  - "3,505 funded vaults (3,454 active)", each a Qwen3-235B agent trading real ETH "in a 12-token memecoin market on Base, for 21 days and 7.5M invocations" (Feb 26–Mar 18, 2026).
  - "Median true return was 0.492×; **16.2% of vaults finished profitable**."
  - Herding: "**1,544 of 3,454 active vaults bought the same token (FEET) within one hour** on Mar 1 (peak 441 buys/min) … the 82 still holding were 89% underwater (mean P&L −20.1%)". "Portfolios converged over the run (mean pairwise Jaccard 0.304 → 0.473)."
  - Abstract: "**neither fleet shows a directional edge**."
- **What an in-house feed does to selection (§4.2, DXAP fleet):** "46.5% [43.4, 49.7] of entries are in [the 9] rendered symbols against an 8.9% random-availability baseline, a 5.2× over-selection". A regression discontinuity at the display cut gives 1.75×: "symbols just below the cut are statistically identical … but are picked far less because they are not shown."
- **Confidence:** H for the numbers. M for using them as proof that data matters (see caveats).
- **Slide lines (≤12 words):**
  - "3,505 AI agents, $20M on Base memecoins: no directional edge." (DXRG, 2026)
  - "Only 16% of 3,505 AI trading agents finished profitable." (DXRG, 2026)
  - "Agents buy what the feed shows: 46.5% of entries, 9 tickers." (DXRG, 2026)

### D2. Nof1 Alpha Arena Season 1 — six frontier LLMs on one price-only feed
- **Source:** ForkLog, Nov 2025, relaying founder Jay Azhang's final results: https://forklog.com/en/four-out-of-six-ai-models-suffer-losses-in-trading-tournament/ ; founder post: https://x.com/jay_azhang/status/1985481491078328621
- **Setup:** Oct 18–Nov 3, 2025; $10K each, real money, Hyperliquid perps.
- **Final balances:** Qwen3 Max $12,231, DeepSeek $10,489, Claude Sonnet 4.5 $5,799, Gemini 2.5 Pro $5,445, Grok 4 $4,208, GPT-5 $4,126.
- **Founder on the data:** LLMs "do not handle numerical time series data well, but that was the entire context we provided them."
- **Confidence:** H for "4 of 6 lost". M for the exact percentages.
- **Slide line:** "Six frontier AIs, same price-only feed: four lost money." (Nof1, Nov 2025)

### D3. Positive evidence that on-chain data helps (weak, the best available)
- **Source:** CryptoTrade, Li et al., EMNLP 2024 / arXiv 2407.09546. Removing Ethereum on-chain transaction stats "results in a significant decrease of the outcome by around 16%". This covers GPT-4o on ETH only, in an Oct–Dec 2023 bull window. **M/L.**
- **No independent evidence found that paid smart-money or wallet-label feeds (Nansen etc.) improve returns.** Only vendor case studies exist.

### DATA caveats (important)
- **DXRG cuts both ways.** 2609.05663 §7 also reports "**No directional edge from any information source**": the signal ledger sorts at chance, 770K tokens of context gave −0.46 pts, a world-context arm went 0/84, and research sub-agent recommendations were null (n = 120). It also reports "Restraint beats added information (provisional)."
  - None of these tested premium on-chain feeds. Still, a diligent investor will see them.
  - So use DXRG for "same bundled feed → herding, no edge". Do not use it for "more data → profit".
- **DX Terminal Pro was structurally hostile:** a "deliberately adversarial" 2.3%/swap fee, a reaping mechanic, and only 12 tokens, which forces overlap. Footnote any "16% profitable" or "FEET herding" claim.
- **The DXAP selection figure (46.5%) is from Hyperliquid perps, mostly paper accounts.**
- **Alpha Arena S1.5 (Dec 2025) added news and sentiment,** and most models still lost (only Grok 4.20 was positive, ~+12%). So "more data fixes it" is not shown.

---

## Row 2 — SAFETY (cost of relying on stop-losses with opt-in rug checks)

### S1. SolRugDetector / "From Hype to Collapse" — 2026, Solana, mechanisms map onto Tocker's gates
- **Source:** Chen, Zheng et al., arXiv 2603.24625. v1 Mar 2026, "SolRugDetector: Investigating Rug Pulls on Solana"; v2 retitled. https://arxiv.org/abs/2603.24625
- **Figures:**
  - **76,469 of 100,063 tokens (76%)** launched on Orca, Raydium and Meteora between 1 Jan and 30 Jun 2025 were labelled rug pulls.
  - A manual audit of 382 samples found a 0.26% false-positive rate.
  - Breakdown: 60,402 pump-and-dump, 15,606 liquidity withdrawal, 461 freeze-authority abuse.
  - v1 also says fraudulent tokens have a "median lifecycle of 0.01 days" (~14 min). That figure may not carry over to v2.
- **Why it fits the slide:** freeze authority and liquidity pulls are exactly the cases where a stop-loss cannot fill. Tocker gates both.
- **Confidence:** M-H. It is a preprint, and the labels are "candidates".
- **Slide lines:**
  - "76% of new Solana DEX tokens in H1 2025 were rug pulls." (arXiv, 2026)
  - "Median scam token lived ~14 minutes — faster than any stop-loss." (use only if v1 is cited)

### S2. Solidus Labs 2025 Rug Pull Report — the biggest number, widely known
- **Source:** Solidus Labs, published 7 May 2025: https://www.soliduslabs.com/reports/solana-rug-pulls-pump-dumps-crypto-compliance ; CoinDesk coverage: https://www.coindesk.com/business/2025/05/07/98-of-tokens-on-pump-fun-have-been-rug-pulls-or-an-act-of-fraud-new-report-says
- **Figures:**
  - Covers 7M+ pump.fun tokens (Jan 2024–Mar 2025, each with ≥5 trades). Only ~97,000 kept more than $1K of liquidity, giving 98.6% (1 − 97k/7M = 98.61%). The executive summary says 98.7%.
  - Raydium: 361,000 of 388,000 pools (93%) showed soft-rug traits. The median rug was $2,832.
- **Confidence:** H for the number. Pump.fun disputes it.
- **Slide line:** "98.6% of 7M pump.fun tokens collapsed below $1K liquidity." (Solidus Labs, 2025)

### S3. Chainalysis — rugged by the creator
- **Source:** Chainalysis, 29 Jan 2025: https://www.chainalysis.com/blog/crypto-market-manipulation-wash-trading-pump-and-dump-2025/
- **Figures:**
  - 74,037 of 2,063,519 tokens launched in 2024 (3.59%) showed pump-and-dump patterns.
  - "approximately 94% of DEX pools involved in suspected pump-and-dump schemes appear to be rugged by the address that created the DEX pool". That is 69,897 of 74,312; the other 6% were rugged by addresses the deployer funded.
  - The average scheme took 6–7 days.
- **Confidence:** H.
- **Slide line:** "94% of pump-and-dump pools were rugged by their own creator." (Chainalysis, 2025)

### S4. USENIX Security 2026 — the tokens an agent chases are mostly fake
- **Source:** Mongardini & Mei, "A Midsummer Meme's Dream", USENIX Security '26: https://www.usenix.org/conference/usenixsecurity26/presentation/mongardini ; arXiv 2507.01963
- **Figures:**
  - 34,988 tokens across Ethereum, BSC, Solana and Base.
  - Among the 707 tokens that gained more than 100%, **82.8%** showed manipulation: wash trading, LP-based price inflation, or concentrated ownership. The figure is 82.89% on the USENIX page and 82.6% in v1.
  - 62.9% used artificial growth to set up exit scams.
  - More than 17,000 victim addresses lost over $9.3M.
- **Confidence:** H. It is peer-reviewed.
- **Slide line:** "83% of memecoins that doubled showed manipulation." (USENIX Security 2026)

### S5. Honeypots — "can't sell" defeats a stop-loss (very fresh)
- **Source:** Cernera, La Morgia, Mei & Sassi, "Pump-and-Dump meets Honeypot Tokens", arXiv 2610.10149, submitted **7 Oct 2026**: https://arxiv.org/abs/2610.10149
- **Figures:**
  - 83 Telegram channels and 3,677 operations on BSC and Ethereum.
  - Most targets were honeypots that buyers cannot sell.
  - Colluders were 10.6% of participants but drove 72% of buy volume and 92% of sell volume.
  - Creators and colluders were profitable in **99.3%** of cases, extracting more than $7M.
- **Confidence:** M. It is a v1 preprint one day old, and it does not cover Solana or Base.
- **Slide line:** "Honeypot pump schemes: buyers can't sell; creators profit 99.3% of the time."

### Other SAFETY figures
- **"Catching the Rug"** (arXiv 2608.20271, 20 Aug 2026): 6.4M Solana memecoins; "a vast majority … exhibit rug pull characteristics within one hour of launch." **M.**
- **"Meme Coin Factories"** (Szwajcok, …, Soska, Payer, Christin; arXiv 2609.10246, 9 Sep 2026): covers 15.2M pump.fun coins. The top 1% of creator clusters (grouped by funding) launched **58.6%** of all coins. At least 17% of trades were wash trades (~4M). Only 1.02% of coins graduate. **M-H.**
- **DXRG** (2609.05663) backs "rules in code, not prompts": "Telling the model its liquidation distance in text changed nothing", and "the exit discipline that exists lives in the tool".
  - Do not use DXRG against stop-losses: it found mechanical 2%/4% brackets beat every discretionary exit (+39 bps per position).

### SAFETY caveats
- Solidus measures liquidity collapse, not proven fraud; many tokens were simply abandoned.
- Chainalysis's 94% applies to the 3.59% of tokens flagged, not to all tokens.
- Don't add or merge the studies; each uses a different definition.
- Avoid "98.6% are scams."

---

## Row 3 — SOCIAL (cost of copy trading and leaderboards; value of a private strategy)

### C1. Copiers keep a fraction of a memecoin leader's return — memecoin-specific, 2026, peer-reviewed venue
- **Source:** Luo, Feng, Xu & Liu, "Resisting Manipulative Bots in Meme Coin Copy Trading", ACM Web Conference (WWW) 2026, DOI 10.1145/3774904.3792635; arXiv 2601.08641 (Jan 2026): https://arxiv.org/abs/2601.08641
- **Figures:**
  - Over 6,000 meme coins.
  - The smart-money wallets the system found achieved "an average return of 14%".
  - The "estimated copier return is 3% per meme coin investment under realistic market frictions". v2 wording says "per trade".
  - The paper names a "persistent imitation penalty arising from price impact": copiers buy higher on the bonding curve.
  - Front-running, position-concealing and sentiment-faking bots are described as endemic to memecoin copy trading.
- **Confidence:** M-H.
- **Caveat:** 3% is the mean for the authors' own best system. A PREreview notes it was the only model with positive copier returns, and the median was not reported.
- **Slide line:** "Copying a winning memecoin wallet turns 14% into 3%." (WWW 2026)

### C2. Publishing a strategy destroys it — supports "strategy stays private"
- **Source:** McLean & Pontiff, "Does Academic Research Destroy Stock Return Predictability?", *Journal of Finance* 71(1), Feb 2016.
- **Figures:**
  - 97 predictors from 79 papers.
  - Returns were 26% lower out of sample and **58% lower post-publication**, which implies ~32% decay from informed trading.
- **Confidence:** H. These are equities, not crypto.
- **Slide line:** "Once published, strategies lose 58% of their returns." (Journal of Finance)

### C3. Following crypto influencers loses money — KOL dumping, peer-reviewed
- **Source:** Merkley, Pacelli, Piorkowski & Williams, "Crypto-Influencers", *Review of Accounting Studies* 29(3), 2024, DOI 10.1007/s11142-024-09838-4.
- **Figures:**
  - ~36,000 tweets by 180 influencers on 1,600+ assets.
  - Day-1 return +1.83%, then cumulative **−6.53% at 30 days** and **−18.90% at 90 days**.
  - Losses are worst for self-styled experts, small caps and buy calls.
- **Confidence:** H.
- **Slide line:** "Buy on a crypto-influencer call: −6.5% in 30 days, −19% in 90."

### Other SOCIAL figures
- **YieldFund multi-exchange study** (late 2025; vendor, seen only via KuCoin and Spark): over 100,000 copier outcomes on Binance, Bybit and MEXC. ~97% of lead traders were profitable on their own PnL, but only 43.6% made their followers money; the copier win rate was 48.5%. **L. Do not put on a slide without the original.**
- **"Stranger Danger?"** (Kawai, Soska, Routledge, Zetlin-Jones, Christin; CHI 2024, DOI 10.1145/3613904.3642715): covers TraderWagon and Bybit. Leaders take 10% of copiers' realised profit but share no losses. Rankings are "easily gameable by unscrupulous leaders who prey on novice copiers", and leaders close losing portfolios and reopen. **H for these qualitative claims. No headline number was verified; the circulating "Gold portfolios … $15K in 10 days" line could not be found.**
- **Apesteguia, Oechssler & Weidenholzer, "Copy Trading"** (*Management Science* 66(12), Dec 2020): in lab experiments, the option to copy significantly increases risk-taking. **H, qualitative.**
- **Yang, Zheng & Mookerjee** (*Management Science* 2022, DOI 10.1287/mnsc.2021.4147): full transparency lets followers free-ride by copying delayed trades, and the profit gap grows with delay. Platforms respond by delaying disclosure. **M.**
- **Evidence that traders hide from copiers** is anecdotal only:
  - Polymarket's "COPYCAT" piece says sharp traders run secondary accounts (https://news.polymarket.com/p/copycat).
  - CZ retired his BNB wallet in Aug 2026 after traders front-ran his burns; his stated reason was spam (https://cryptonews.com/news/cz-binance-wallet-retirement/).
  - The Kolscan change.org petition says the leaderboard lets KOLs farm copy-traders.
  - **No quantitative study was found.**
- **Same-block follower buys and copy slippage on Solana:** no independent measurement found. Only vendor claims exist, e.g. RPC Fast's 15 ms same-slot landings.

---

## Recommended picks
| Row | Primary | Secondary |
|---|---|---|
| DATA | DXRG: 3,505 agents, ~$20M, "no directional edge" (2609.05663) | "16% profitable" or "46.5% of entries = the 9 tickers shown" |
| SAFETY | SolRugDetector: 76% of new Solana DEX tokens rugged, H1 2025 | Solidus 98.6% or USENIX'26 82.8% of 2× tokens manipulated |
| SOCIAL | WWW'26: copier 3% vs leader 14% | McLean–Pontiff: −58% after publication |
