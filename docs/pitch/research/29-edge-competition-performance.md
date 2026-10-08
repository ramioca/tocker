# 29 · Edge, competition and performance proof (as of 2026-10-08)

**Purpose.** This note answers the roast's three points: edge, established competitors and performance. It extends notes 01–03, 07, 11, 26 and 28.

**Method.** arxiv.org and defillama.com were blocked, so the figures come from search extracts. GMGN's skills repository was the exception: I read it directly.

**Confidence.** H = peer-reviewed or primary. M = preprint or extract. L = vendor or self-reported.

## A. Does each step create edge?

### A1. Avoiding rugs

| Question | Figure | Source, date | Conf |
|---|---|---|---|
| Share of trader *losses* from rugs | **No study splits losses by cause.**<br>• Rugs plus scams: >$500M in 2024 ([Merkle Science/CoinDesk](https://www.coindesk.com/business/2025/02/11/crypto-investors-lost-over-usd500m-in-memecoin-rug-pulls-and-scams-in-2024), 11 Feb 2025).<br>• By comparison, $TRUMP's price decline alone cost 813K wallets ~$2B ([Chainalysis/Fortune](https://fortune.com/2025/02/11/trump-memecoin-traders-2-billion-dollar-loss-family-100-million-fees/), 11 Feb 2025). | — | L/M |
| Dead tokens | 11.6M tokens failed in 2025, and 53.2% of all tracked tokens are dead | [CoinGecko/Defiant](https://thedefiant.io/news/markets/more-than-half-of-crypto-is-dead-coingecko), Jan 2026 | M |
| pump.fun deaths | • 68.67% stop trading on launch day.<br>• 80.37% stop by day 2.<br>• Sample: 18.67M tokens. | [CoinGecko/crypto.news](https://crypto.news/pump-funs-token-factory-has-a-69-launch-day-death-rate-coingecko/), Jun 2026 | M-H |
| pump.fun graduation | • 0.63% (Sep–Oct 2025, [Marino et al.](https://arxiv.org/abs/2602.14860), Feb 2026).<br>• 1.02% ([CCS'26](https://arxiv.org/abs/2609.10246), Sep 2026).<br>• ≥0.198% (May–Jun 2026, [Kamat](https://arxiv.org/abs/2607.02823)).<br>• One day at 6.7% after BOOST ([The Block](https://www.theblock.co/post/409815/pump-fun-token-graduation-rate-jumps-boost-changes-launch-incentives), 29 Jul 2026). | — | M |
| What rugs are | • 76% of 100,063 new Solana DEX tokens (H1 2025) were rugs.<br>• 79% were pump-and-dump, 20% liquidity pulls, and **0.6% freeze-authority abuse**. | [SolRugDetector v1](https://arxiv.org/abs/2603.24625v1), Mar 2026 | M-H |
| Detector accuracy (117 labelled rugs) | • SolRugDetector: precision 100%, recall 93.2%.<br>• **RugCheck: precision 76.9%, recall 94.0%.**<br>• Solana Rug Checker: precision 67.7%, recall 35.9%. | same | M |
| Early prediction (first 5 min, 6.4M tokens) | XGBoost AUC-PR ≈0.76–0.80. Tokens that rugged inside the 5-minute window were dropped. | [Li et al.](https://arxiv.org/abs/2608.20271), Aug 2026; [Pith](https://pith.science/paper/2608.20271) | M-L |
| Bundles, snipers, honeypots | • Linked wallets hold **36.5%** of supply on average ([MELT](https://arxiv.org/abs/2602.13480), Feb 2026).<br>• 15K+ launches a month are sniped in block 0, and 87% of those snipes profit ([Pine](https://pineanalytics.substack.com/p/exit-liquidity-machines), 2025).<br>• Honeypot pump schemes pay their creators 99.3% of the time ([Cernera et al.](https://arxiv.org/abs/2610.10149), 7 Oct 2026, BSC/ETH). | as cited | M |

**What this means for the gates:**
- **Mint, freeze and LP checks barely bite on pump.fun.** Mint authority is revoked at launch and the LP is burned at graduation ([BloFin](https://blofin.com/academy/education/pumpfun/pumpswap-canonical-pool-ownership), 2026, M).
- **The real signal is elsewhere:** concentration, bundles, dev behaviour and liquidity collapse. These are soft rugs, which gates can reduce but not prevent.

### A2. Selecting winners

| Signal | Best evidence | Verdict |
|---|---|---|
| **Smart money** | **[Luo et al., WWW'26](https://arxiv.org/abs/2601.08641)** (Jan 2026):<br>• 6,000+ coins on pump.fun and GMGN.<br>• Selected wallets return **+14%** on average.<br>• Simulated copiers get **+3% per trade**, because bonding-curve price impact makes them pay more.<br>• Copiers of statistics-only models lose money.<br>• No median was reported ([PREreview](https://zenodo.org/records/22679925)).<br><br>Wallet rank persistence on Hyperliquid: ρ = 0.52 ([arXiv 2608.04373](https://arxiv.org/abs/2608.04373), Aug 2026).<br>No independent test of Nansen's labels exists. | Real, but whoever moves first captures it. |
| **Holder growth** | • No direct study.<br>• Bundles fake breadth.<br>• On pump.fun, liquidity raised in *few* trades best predicts graduation, and bot-heavy tokens graduate less ([Marino et al.](https://arxiv.org/abs/2602.14860)). | Weak; useful as a veto. |
| **Volume momentum** | • Momentum and attention predict crypto returns in general ([Liu & Tsyvinski, RFS 2021](https://www.nber.org/papers/w24877), H).<br>• But ≥17% of pump.fun trades are wash trades, and they lift graduation odds up to 10× ([CCS'26](https://arxiv.org/abs/2609.10246)).<br>• 82.8% of memecoins that rose more than 100% showed manipulation ([USENIX'26](https://www.usenix.org/conference/usenixsecurity26/presentation/mongardini), H). | Easy to manufacture. |
| **Social / KOL** | • Abnormal Twitter attention predicts *next-day* returns through overreaction ([Maître et al., JBF 2025](https://ideas.repec.org/a/eee/jbfina/v178y2025ics0378426625001384.html), H).<br>• After an influencer call: +1.83% on day 1, **−6.53% at 30 days and −18.9% at 90 days** ([Merkley et al., RAS 2024](https://ideas.repec.org/a/spr/reaccs/v29y2024i3d10.1007_s11142-024-09838-4.html), H).<br>• Advertising a Telegram channel lifts graduation 8.9× ([Kamat](https://arxiv.org/abs/2607.02823)). | Timing only. Holding loses. |
| **Graduation** | • No study of returns after graduation.<br>• Share of graduated tokens with ≥$5K of liquidity: **56.5% at +5 min, 19.7% at +24 h** (n = 15,548; [Scorplabs](https://trader.scorplabs.online/blog/pump-fun-graduation-raydium-migration), mid-2026, L). | A filter, not an entry signal. |

**Net:** no selection signal has clean, cost-adjusted evidence of positive forward returns in memecoins. Negative screens and short holds have the best evidence.

### A3. Discipline

**From traditional markets:**
- Robo-advice cut the disposition effect and trend-chasing ([D'Acunto et al., RFS 2019](https://ideas.repec.org/a/oup/rfinst/v32y2019i5p1983-2020..html), H).
- Stops add value only when prices trend or switch regimes ([Kaminski & Lo, JFM 2014](https://ideas.repec.org/a/eee/finmar/v18y2014icp234-254.html), H).

**From crypto:**
- **DXRG** ([2609.05663](https://arxiv.org/abs/2609.05663), Sep 2026):
  - A fixed 2%/4% stop/target bracket added **+39 bps per position** [+21, +57], about 60% of it from avoiding blow-ups.
  - None of the 16 exit policies tested was profitable outright.
  - Writing the liquidation distance into the prompt did *not* reduce risk-taking.
- **Aster S1** ([Chainwire](https://chainwire.org/2026/01/14/aster-human-vs-ai-live-trading-competition-season-1-concludes/), 14 Jan 2026):
  - AI agents returned **−4.5% against −32% for humans**.
  - **0 of 30 AI agents were liquidated, against 43% of humans.**
- The disposition effect in bitcoin is present from 2017 onward ([Schatzmann & Haslhofer](https://arxiv.org/abs/2010.12415)). Other crypto evidence is mixed.

**Read:** rules in code cut the left tail. They do not create alpha.

### A4. AI trading agents

| Study | Result | Source | Conf |
|---|---|---|---|
| **Alpha Arena S1**<br>(Oct–Nov 2025, 6 LLMs × $10K) | • Qwen +22%, DeepSeek +5%; the other four lost 42–59%.<br>• **What the winners did differently:** Qwen made ~43 trades with a ~30% win rate and big winners. Gemini made 165 trades in 10 days at 25%. The losers over-traded and over-levered. | [ForkLog](https://forklog.com/en/four-out-of-six-ai-models-suffer-losses-in-trading-tournament/), Nov 2025; [iWeaver](https://www.iweaver.ai/blog/alpha-arena-ai-trader-showdown/) | H/L |
| **Alpha Arena S1.5**<br>(US stocks, to Dec 2025) | • 7 of 8 models lost.<br>• The winning "Mystery Model" made +12.11% from 158 orders; Qwen placed 1,418 in one round.<br>• No public Season 2 as of Aug 2026. | [alphaarena.ai](https://www.alphaarena.ai/); [OneDayAdvisor](https://www.onedayadvisor.com/2025/12/nof1ai-alpha-arena-review-season-15.html); [TradeRank](https://www.traderank.ai/blog/alpha-arena-alternatives-2026) | M |
| **DXRG**<br>(3,505 vaults on Base memecoins, 21 days) | • Median result 0.492× of starting capital; **16.2% of vaults profitable**.<br>• 1,544 vaults bought the same token within one hour.<br>• **"Neither fleet shows a directional edge."**<br>• Harness fixes cut fabricated sell rules from 57% to 3% ([2604.26091](https://arxiv.org/abs/2604.26091)). | [2609.05663](https://arxiv.org/abs/2609.05663), Sep 2026 | M-H |
| **Others** | • Wallet V: 42% of 688 agents had PnL ≥ 0 ([Bitcoin.com](https://news.bitcoin.com/wallet-v-launches-public-performance-benchmark-for-ai-trading-agents-on-hyperliquid-and-aster/), Jun 2026).<br>• LiveTradeBench: model benchmark rank vs trading return ρ = 0.054 ([2511.03628](https://www.arxiv.org/pdf/2511.03628), Nov 2025). | — | M |

**Takeaway:** the winners traded less and sized better; the model mattered little.

## B. The established competitors

Solana traders paid **$940M** to trading platforms in 2025, up 44%. Seven apps earned more than $100M, including Axiom, Photon and BullX ([The Block](https://www.theblock.co/post/384535/the-year-of-revenue-assets-and-trading-ethereum-and-solana-boast-growth-in-2025), Jan 2026).

Column key:
- **Auto** = auto-buy or sniper with filters.
- **Copy** = copy trading.
- **Safety** = token-safety checks.
- **AI** = an AI or LLM agent feature.
- **Perf** = publishes user performance.

| Player | Scale | Auto | Copy | Safety | AI | Perf |
|---|---|---|---|---|---|---|
| **Axiom** | ≈$547M gross fees in 2025, my sum of quarters ([DefiLlama](https://defillama.com/protocol/axiom), extract Oct 2026) | Migration sniper | ✓ | Shows dev, bundle and holder stats; doesn't block | **None**, rules only ([guide](https://axiompro.app/ai-trading/), 2026) | PnL cards |
| **Photon** | >$100M in 2025; ~$0.5M in the last 30 days ([DefiLlama](https://defillama.com/protocol/photon), undated 2026 snapshot) | Memescope | — | Mint and LP-lock audit ([Comparedge](https://comparedge.com/tools/photon-sol), Jul 2026) | None | No |
| **GMGN** | $145M fees over the trailing year ([DefiLlama](https://defillama.com/protocol/gmgn), undated 2026 snapshot); $2.59M in one day ([ChainCatcher](https://www.chaincatcher.com/en/article/2287659), 4 Sep 2026) | ✓ | ✓ | Automatic scan: honeypot, LP, dev, top-10 ([CoinCodeCap](https://coincodecap.com/gmgn-review)) | **Agent API** (Mar 2026) plus **open-source skills** that trade from plain-English prompts ([GitHub](https://github.com/GMGNAI/gmgn-skills), 28 Sep 2026) | Public wallet PnL |
| **BullX** | >$100M in 2025; **trading off since 1 Jun 2026** ([Phemex](https://phemex.com/news/article/bullx-suspends-trading-functionality-to-focus-on-future-development-87410); [Moby](https://moby.win/learn/bullx-shutdown/), 16 Sep 2026) | ✓ | ✓ | Contract, LP and holder checks | None | No |
| **Trojan** | $195M lifetime fees ([CoinStats](https://coinstats.app/news/3ada6876cada02f6d450dd38495251c4af63de14d5d17fc15b802cd2c8418e08_4-On-Solana-trading-bots-have-raked-in-144B-in-lifetime-fees-so-far--Photon-4216M-293--Axiom-2093M--BullX-2006M--Trojan-1948M--BonkBot-1107M--and-more-This-fee-growth-is-fueling-Solanas-onchain-economy-like-never-before-pictwittercomIMDtE3TX3J), Aug 2025) | ✓ Filters for mint, freeze, liquidity, dev % and socials ([docs](https://docs.trojanonsolana.com/telegram-bot-user-guide/sniper)) | ✓ | Those filters | None | No |
| **BonkBot** | $111M lifetime fees (same source, Aug 2025) | — | — | MEV protection | "Not AI" ([bonkbot.io](https://bonkbot.io/library/do-ai-trading-bots-work)) | No |
| **Banana Gun** | ≈$22.5M in 2025, falling every quarter ([DefiLlama](https://defillama.com/protocol/banana-gun)); 1.3M users, self-reported, Mar 2026 | ✓ | ✓ | **On by default** ([blog](https://blog.bananagun.io/blog/banana-gun-vs-other-bots-which-protections-are-on-by-default)):<br>• a sell is simulated before every buy, to catch honeypots;<br>• anti-rug front-run exit, 80–85% success (self-reported);<br>• a "Degen mode" overrides both. | None | Volume and fees only |
| **Maestro** | 573K users, $12.8B volume, self-reported ([BYDFi](https://www.bydfi.com/en/cointalk/maestro-bot-vs-alternatives), 2026) | ✓ Block-0 sniper | ✓ | Mempool anti-rug sell ([QuickNode](https://www.quicknode.com/builders-guide/tools/maestro-by-maestro-team)) | None | No |
| **Padre → Terminal** | Bought by pump.fun Oct 2025 ([Phemex](https://phemex.com/news/article/padre-rebrands-to-terminal-following-acquisition-by-pumpfun-32914)) | ✓ | ? | ? | pump.fun dropped its "Tokenized Agents" ([CryptoTimes](https://www.cryptotimes.io/2026/07/01/pump-fun-axes-tokenized-agent-launch-mode-after-community-push/), 1 Jul 2026) | No |
| **Bloom, Nova** | n/f | ✓ AFK mode / launch filters | ✓ | Dev and liquidity filters | n/f | No |
| **fomo** | • $75M Series B at a $550M valuation; 625K users ([Tangem](https://tangem.com/en/news/investments/28926-fomo-raises-75m-series-b-surpasses-625k-users/), Jun 2026)<br>• ~40% of terminal volume ([Phemex](https://phemex.com/news/article/fomo-leads-onchain-trading-terminals-with-350-million-daily-volume-96146), Sep 2026) | — | Follow | n/f | None | **Verified leaderboards**, yet only ~6% of its wallets were profitable over 90 days ([Cryptopolitan](https://www.cryptopolitan.com/6-solana-meme-traders-profit-in-90-days/), Aug 2026) |

**Verdict: hard gates are table stakes.** GMGN's own buy skill (`gmgn-token-buy/references/thresholds.md`, read directly) already ships Tocker's gate set as a two-tier check:
- **Any one red flag fails:** honeypot, mintable, freezable or blacklist, or tax above 10%.
- **Two or more warnings fail:** top-10 above 50%, dev above 5%, age under 24 hours, insiders above 15%, fewer than 200 holders, bundlers above 5%, bots above 60%, fresh wallets above 30%.

Auto-buy with filters is just as common. **What none of them has:** a veto the model cannot override, an unattended agent built from a plain-English strategy, or published aggregate user outcomes.

**AI natives are small:**

| Player | Funding and traction | Source, date |
|---|---|---|
| Senpi | $4M seed; $411M in perps volume | [TFN](https://techfundingnews.com/senpi-ai-powered-crypto-wallet-raises-4m/), Sep 2025; [DefiLlama](https://defillama.com/protocol/senpi-perps), 8 Oct 2026 |
| Minara | $2.63B in perps volume | [DefiLlama](https://defillama.com/protocol/minara-ai-perps) |
| HeyElsa | $3M raise; 945K wallets, self-reported | [blog](https://blog.heyelsa.ai/heyelsa-raises-3m-to-build-ai-stack-for-crypto/), Jun 2025 |
| Fere AI | $1.3M seed; 7K daily users, self-reported; pivoted on 6 Oct | [Phemex](https://phemex.com/news/article/fere-ai-secures-13m-in-funding-led-by-ethereal-ventures-75816), Apr 2026 |
| ClawPump | $250K grant; $225M+ volume, self-reported | [X](https://x.com/clawpumptech), 3 Oct 2026 |
| Nansen AI | $500M+ traded, CEO claim; autonomy still in paper trading | [The Block](https://theblock.co/post/409914/nansen-ceo-bets-on-ai-agents-to-overtake-human-traders-within-two-years), 2026 |
| Robinhood Agents | 150K agentic accounts, listed assets only | [Fortune](https://fortune.com/2026/09/29/robinhood-trading-agents-hood-openai-anthropic/), 29 Sep 2026 |
| Others | • **Surf:** $15M, research only ([PR Newswire](https://www.prnewswire.com/news-releases/surf-raises-15m-to-scale-the-first-ai-model-purpose-built-for-digital-assets-302638051.html), Dec 2025).<br>• **Almanak:** TVL ≈$446K ([DefiLlama](https://defillama.com/protocol/almanak), Oct 2026).<br>• **Giza:** ARMA retired ([OwnYourMind](https://ownyourmind.ai/projects/giza/)).<br>• **Cod3x:** 47 users ([PANews](https://panewslab.com/en/articles/019d510f-8cc0-7593-8658-e07ff2137803)).<br>• **Ask Gina, Wayfinder:** no traction published. | as cited |

## C. How performance gets proven

| Method | Credible when | Risk | Evidence |
|---|---|---|---|
| Backtest | Point-in-time data, costs included, trial count disclosed | **Very high** | • Across 888 strategies, backtest Sharpe explained R² < 0.025 of live results ([Wiecki et al.](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2745220), 2016).<br>• About 7 tries can produce a 2-year, Sharpe-1 backtest from zero true skill ([Bailey et al.](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2308659), 2014). |
| Paper trading | Real quotes, pre-committed start date | Medium | Simulated fills miss market impact |
| On-chain PnL | **Every** agent shown, net of fees | Low if complete | fomo is verified, but ~6% of its wallets are profitable |
| Third-party arena | Rules owned by an outside party | Low, but short windows | Nof1 raised $15M on its arena ([SaaS News](https://www.thesaasnews.com/news/nof1-raises-15m-in-funding/), May 2026) |
| Skin in the game | The manager's own capital is at risk | Low | Hyperliquid vault leaders take a 10% profit share ([docs mirror](https://web3-ethereum-defi.readthedocs.io/vaults/hyperliquid/index.html)) and hold ≥5% of the vault ([Finestel](https://finestel.com/blog/hyperliquid-vaults-explained/), M) |
| Staked live predictions | Scored out of sample | Low | Numerai returned +25.45% net in 2024, then got $500M of capacity from JPMorgan ([Numerai](https://blog.numer.ai/jpmorgan-secures-500m-capacity/), Aug 2025) |

**What counts as cherry-picked:**
- a screenshot of the best agent;
- weekly ROE or points leaderboards;
- untallied backtests;
- deleted calls.

**What a seed VC would plausibly accept in 4–6 weeks** (judgement):
- a pre-registered live record showing every agent, measured against baselines;
- a large-sample, point-in-time measurement of the mechanism.

A 21-day run cannot show directional edge; DXRG could not.

## Implications for Tocker's pitch

**1. Most defensible edge claim**

> "We don't sell prediction. We sell not losing: every launch scored, the killers refused, exits on rules, in code, 24/7."

- **Selection signals decay or are faked:** copying cuts 14% to 3%, KOL calls end at −6.5% after 30 days, and ≥17% of pump.fun trades are wash trades.
- **Avoidance and discipline show measurable effects:** +39 bps from brackets, 0% vs 43% liquidated, and fabricated sell rules down from 57% to 3%.
- **Cutting the left tail is the user's edge.** About 94% of memecoin wallets made no 90-day profit (note 28).
- **Say "edge in the layer, not the model."** Never say "our AI picks winners."

**2. Gates are table stakes. These are not:**
- **(a) A veto the LLM cannot override.** Rivals offer toggles, a "Degen mode", and user confirmation even inside GMGN's skill.
- **(b) A pre-trade record nobody can edit.** Each trade stores its score and gate verdict at the moment of entry (`scoreSnapshot`), plus public receipts. No incumbent publishes aggregate outcomes.
- **(c) An unattended plain-English strategy** covering the whole launch stream.
- **Fee check:** the brief says 0.5% per fill, but `SPEC.md` says a flat $0.10. Reconcile before the deck ships. Either way it undercuts the terminals' ~1%.

**3. Biggest threat**
- **GMGN** could turn its Agent API and skills into a one-click consumer "agent mode". It already has the data, the open-source gate logic, the execution, and about $114M a year in revenue.
- **fomo** could add agents to its ~40% share of terminal volume.
- **What they lack:** a loop that cannot be overridden, and a business model that is not copy-trading.
- **Counter:**
  - prove outcomes first;
  - stay the neutral, verifiable layer;
  - sell the gate and score as an x402 pre-trade check to *their* agents (note 17).

**4. Honest proof in 4–6 weeks**
- **(a) Gate audit.**
  1. Pre-register the spec and outcome definitions, then publish their hash.
  2. Score every Solana and Base launch for four weeks; `token_score_history` is already point-in-time.
  3. Label outcomes at 1 hour, 24 hours and 7 days: liquidity down ≥90%, price down ≥90%, or can't sell.
  4. Report precision, recall and loss avoided for three cases: Tocker's gates, RugCheck alone, and no filter.
  5. Tens of thousands of tokens give tight confidence intervals.
- **(b) Live house cohort.**
  - 10–20 small, real-money agents with public wallets.
  - Arms: the same strategies with gates on and with gates off, a random-entry control with the same exits, and SOL buy-and-hold.
  - Show every agent, net of fees, using the receipts.
- **(c) Independent check.** A public Dune dashboard or a third-party arena.
- **Claim it as:** "X% fewer rugs bought, Y% smaller drawdowns, verified on-chain." Four weeks of returns is noise, and investors know it.
