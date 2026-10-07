# 16 — Consumer agentic trading: the real competitive set (as of 2026-10-07)

**Scope.** Products where a retail user gets an AI agent that trades for them, either autonomously on a strategy or semi-autonomously by chat. Human-click terminals (Axiom, Photon, fomo) and Telegram bots (Trojan, BonkBot, Banana Gun) are out. They are not agentic ([AXL](https://www.axltoken.com/trading-bots/fomo-vs-pump-fun-vs-axiom/), [Datawallet](https://www.datawallet.com/crypto/best-crypto-telegram-bots)).

**Method and confidence.** WebSearch only. WebFetch failed on DNS, and the egress proxy returned 403 for product sites (senpi.ai, askgina.ai, 0x.org) and for the GitHub API. **So every fact below comes from search-result extracts, which means all of it is (s).** I tag figures (s) where they matter, and use **?** when sources conflict or the claim is vendor-only. The shared web-search budget (200 calls) ran out before I could check Donut's launch status, Senpi's post-February traction or the date of Bitget's numbers. Re-check every number before the deck ships. This builds on 07, 11 and 15; I did not redo facts verified there.

---

## TL;DR

- **The category went mainstream in 2026.** Robinhood (agent trading since May, in-app Robinhood Agents since Sep 29), Binance (AI Pro), Bitget (GetAgent Playbook) and Coinbase (Coinbase for Agents) all let a retail user describe a strategy in plain English, pick an LLM and let an agent trade from an isolated account. **"Plain-English strategy → 24/7 agent with its own wallet, any LLM" is now table stakes, not a differentiator.**
- **What still separates Tocker:** (1) **market reach.** It trades the *open on-chain market* (any Solana/Base token that clears the gates). Every incumbent agent trades only what one venue lists, and Senpi, Minara, Cod3x and Wallet V are Hyperliquid-perps-only. (2) **Who has the last word on a buy.** In Tocker, *code* has a hard veto (10 gates) the model cannot override, and code also enforces exits. Every on-chain chat or agent product I found leaves the decision to the model or the user's click.
- **Slide shortlist (6):** Robinhood Agents, Binance AI Pro, Senpi, Nansen AI, Fere AI, Ask Gina.
- **Biggest threat:** **Nansen AI.** It trades on the same chains (Solana + Base), owns better data (500M labeled wallets), has done $500M+ of volume (s) and is paper-trading autonomous agents now. It is also a Tocker data supplier.

---

## 1. Field map

### A. Incumbent venues that went agentic (custodial, listed assets, huge distribution)

| Product | What it is · who decides | Custody · market | Data / x402 | Safety | Public record | Pricing | Traction (date) | Status |
|---|---|---|---|---|---|---|---|---|
| **Robinhood Agents + Agentic Trading** | In-app agents (Sep 29 2026) "research markets, build strategies and execute trades within preset limits." Setup takes about 60s. **Trade approval is on by default; the user can turn it off for full automation.** "Loops" (standing if-then instructions) is coming. Since May 27, outside agents (ChatGPT, Claude) can also connect over MCP ([KuCoin](https://www.kucoin.com/news/flash/robinhood-launches-in-app-ai-trading-agents-for-us-customers), [CryptoBriefing](https://cryptobriefing.com/robinhood-hood-summit-2026-new-features/), [TechCrunch](https://techcrunch.com/2026/05/27/robinhood-now-lets-your-ai-agents-trade-stocks/)) | Custodial; a separate, pre-funded account. Equities (May 27), crypto (Jul 10), options. US only ([LetsDataScience](https://letsdatascience.com/news/robinhood-extends-agentic-trading-to-crypto-users-f8489372)) | Own data; models from OpenAI and Anthropic | Pre-funded isolated account, preset limits, approval on by default. Its terms say the user bears every trade and that Robinhood does not supervise the agent ([Pebblous](https://blog.pebblous.ai/blog/robinhood-agentic-trading-mcp/en/)) | A new social layer was announced; agent records n/v | One OpenAI model free to year-end; others at "standard lab rates" (s) | **150k+ agentic accounts since May; agents call its tools 30M+ times a day** (s, [KuCoin](https://www.kucoin.com/news/flash/robinhood-launches-in-app-ai-trading-agents-for-us-customers), Sep 2026). Open to 27.5M customers ([Bitcoin.com](https://news.bitcoin.com/robinhood-launches-ai-agent-trading-for-27-million-customers-options-and-crypto-next/)) | Live (US) |
| **Binance AI Pro** | Turns plain-English instructions into automated strategies. Users "configure, test and deploy" with third-party LLMs (OpenAI, Anthropic) and AI Skills. **The user approves execution and funds a dedicated sub-account by hand** ([Reuters/Zawya](https://www.tradingview.com/news/reuters.com,2026-03-30:newsml_Zaw82qGSV:0-zawya-binance-beta-launches-binance-ai-pro-bringing-ai-agentic-trading-to-users/), [Cointribune](https://www.cointribune.com/en/binance-rolls-out-ai-pro-trading-agent-in-october-2026/)) | Custodial; isolated virtual sub-account; Binance spot and derivatives | Binance data; Agent OS (Aug 20 2026) for developers ([Cryptonomist](https://en.cryptonomist.ch/2026/08/21/binance-ai-trading-platform-agent-os/)) | Sub-account isolation, revocable permissions. Critics call the safeguards "thinner than they look" ([crypto.news](https://crypto.news/binance-agent-os-ai-trading-safeguards/)) | No | **$9.99/mo promotional beta credits** (s, [Mercado](https://mercado.com.ar/finanzas/binance-habilito-en-beta-ai-pro-para-configurar-estrategias-de-trading-asistidas-por-ia)) | Beta since Mar 25 2026; gradual rollout in the second half of Oct 2026 (s) | Beta → rolling out |
| **Bitget GetAgent Playbook** | Ready-made AI strategies that the user previews, configures and subscribes to. Includes AI Smart Grid (Sep 2026) and tokenized US stocks (Jul 2026) ([Bitget Academy](https://www.bitget.com/academy/bitget-getagent-playbook-introduction-ai-trading-strategies), [CoinEdition](https://coinedition.com/bitget-launches-ai-smart-grid-on-getagent-for-automated-trading/)) | Custodial; "user-authorized isolated sub-accounts" | Bitget data | Sub-account isolation | No | n/v | **1M+ users have completed AI trades; $1.2B cumulative volume across GetAgent and GetClaw** (s, date ?, [U.Today](https://u.today/bitget-expands-ai-trading-with-getagent-playbook)) | Live (since Jun 17 2026) |
| **Coinbase for Agents** (+ Coinbase Advisor) | Bring-your-own agent: ChatGPT or Claude connects over MCP/CLI to a real Coinbase account to trade spot and derivatives. **It pays for premium research over x402.** Advisor (Jun 17, Coinbase One only) is an SEC-registered AI adviser that recommends trades ([CoinDesk](https://www.coindesk.com/tech/2026/06/11/coinbase-launches-ai-agent-accounts-that-can-trade-and-spend-on-your-behalf), [TechCrunch](https://techcrunch.com/2026/06/11/coinbase-debuts-mcp-for-agent-trading/), [LetsDataScience](https://letsdatascience.com/news/coinbase-launches-sec-registered-ai-investment-adviser-26e2d9f0)) | Custodial; isolated portfolios | **x402 native.** x402 ran 75M transactions and $24M volume in 30 days (s, TechCrunch) | Spending limits now; caps and trade limits "soon" | No | Standard fees | Launched Jun 11 2026 | Live (rails, not a product with its own strategy) |
| Kraken | App relaunch "with agentic trading at the center," but the agent **advises and recommends; the human presses the button** ([The Block](https://www.theblock.co/post/407899/kraken-to-relaunch-its-mobile-app-with-agentic-trading-and-advise-at-the-center), [CrowdfundInsider](https://www.crowdfundinsider.com/2026/07/291040-investment-platform-kraken-prepares-mobile-app-overhaul-centered-on-intelligent-ai-trading-agents/)) | Custodial | — | — | — | — | Announced Jul 10 2026 | Pre-launch |
| OKX Agent Trade Kit | Developer kit: 80+ MCP tools; API keys stay on the user's device ([OKX FAQ](https://www.okx.com/en-eu/help/agent-trade-kit-faq)) | Custodial | — | Demo environment | — | Free | Mar 2026 | Live (developer) |

### B. Wallets as agent rails (self-custody, bring your own agent)

| Product | What it is | Chains | Safety | Status |
|---|---|---|---|---|
| **MetaMask Agent Wallet** | A self-custodial wallet for AI agents: swaps, perps, prediction markets, LP ([MetaMask](https://metamask.io/news/metamask-launches-agent-wallet-giving-ai-agents-full-defi-access-with-default-security-on-every-transaction), [CoinDesk](https://www.coindesk.com/tech/2026/06/08/metamask-launches-ai-agent-wallet-with-built-in-security-for-crypto-trades)) | 25+ EVM incl. Hyperliquid; **no Solana mentioned** | **Simulation, Blockaid threat scan, allowlists, spending limits, 2FA "Guard Mode"; Transaction Protection up to $10k a month** ([Forklog](https://forklog.com/en/news/metamask-unveils-wallet-for-the-era-of-ai-agents)) | Early access since Jun 8 2026, about 200 users (s) |
| **Phantom MCP server** | Gives Claude and other MCP clients a separate agent wallet that can sign, swap and transfer ([CryptoAdventure](https://cryptoadventure.com/phantom-launches-mcp-server-that-lets-ai-agents-sign-and-swap/)) | Solana, Ethereum, Bitcoin | User-set limits on amounts and destinations; operation preview | Live |
| Coinbase Agentic Wallets · Trust Wallet Agent Kit | Developer wallet kits ([Coinbase](https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets), [CoinDesk](https://www.coindesk.com/business/2026/05/09/crypto-wallets-are-being-rebuilt-for-ai-agents-trust-wallet-and-mesh-executives-say-at-consensus-miami)) | Base / multi | Session and transaction caps | Live |

These are **rails Tocker can build on**, not products that hold a user's strategy. MetaMask, though, is ahead of Tocker on transaction-level safety.

### C. Hosted consumer agents on Hyperliquid perps (majors and TradFi perps)

| Product | What / who decides | Custody | Safety | Public record | Pricing | Funding | Traction (date) | Status |
|---|---|---|---|---|---|---|---|---|
| **Senpi** | "Personal trading agents" (OpenClaw) with 31 tools and memory. Autonomous on the user's instructions. Mobile app and Telegram. 80+ open-source strategy templates ([Defiant/Chainwire PR](https://chainwire.org/2026/02/24/senpi-launches-the-first-personal-trading-agents-for-hyperliquid/), [GitHub](https://github.com/Senpi-ai/senpi-skills)) | Self-custodial wallet (Privy?) ? | Two-phase trailing-stop "DSL" exits; trader risk scores; also copy and analysis of other traders | **Public "Agents Arena": $30M+ notional** (s); a 40% win rate per HyperTracker (vendor claim) | **0.05% per auto-trade**, on top of Hyperliquid fees ([Terms](https://senpi.ai/terms)) | **$4–4.5M seed led by Lemniscap, with Coinbase Ventures' Base Ecosystem Fund**, Sep 2025 ([TFN](https://techfundingnews.com/senpi-ai-powered-crypto-wallet-raises-4m/)) | **>$100M volume; 10K+ app downloads** (s, Feb 2026 PR) | Live |
| **Minara** | "Personal AI CFO": research and chat-to-trade, plus **Autopilot**, a rules-based automated perp strategy. Four order modes: manual, chat + one-click confirm, conditional auto, copy a wallet ([Docs](https://minara.ai/docs/trade/trading-autopilot), [PANews](https://panewslab.com/en/articles/019d510f-8cc0-7593-8658-e07ff2137803)) | ? | **Deterministic rules, mandatory TP/SL, drawdown limits, manual override** | Volume is visible on DefiLlama | Free; then $19–$199/mo (s, [Nubiapage](https://nubiapage.com/minara-ai-review-2026/)) | Circle Ventures, SeaX; amount undisclosed ([PitchBook](https://pitchbook.com/profiles/company/919676-44)) | **$2.63B cumulative perp volume; $35M in the last 30 days** (s, [DefiLlama](https://defillama.com/protocol/minara-ai-perps)); #1 on Product Hunt | Live |
| Cod3x | AI perp terminal: pick your model, 130+ indicators ([Docs](https://docs.cod3x.org/)) | Smart wallets | — | — | — | — | **Conflicting:** "5,000+ active traders" (Feb 2026, ?) vs **47 active users and $1.2M under management** ([PANews](https://panewslab.com/en/articles/019d510f-8cc0-7593-8658-e07ff2137803)) | Live, small |
| Wallet V | Self-custody wallet; users configure agents with **an LLM of their choice** on Hyperliquid or Aster | Self | — | **Public benchmark of 688 agents; 42% had PnL ≥ 0** ([Bitcoin.com PR](https://news.bitcoin.com/wallet-v-launches-public-performance-benchmark-for-ai-trading-agents-on-hyperliquid-and-aster/)) | — | — | 688 agents in 2 months (s) | Live |
| Spectral Syntax | Chat-built agents moved to Hyperliquid perps ([Alea](https://alearesearch.substack.com/p/spectral-ai-agents-trading-on-hyperliquid)) | — | — | — | — | Token | Its "100k users" is a 2024–25 claim; no 2026 activity found | Stale |

### D. Hosted or chat agents on on-chain spot, including Solana and Base (Tocker's lane)

| Product | What / who decides | Custody · chains | Data / x402 | Safety (pre-buy) | Public record | Pricing | Funding | Traction (date) | Status |
|---|---|---|---|---|---|---|---|---|---|
| **Nansen AI** | "Vibe trading": chat with an agent grounded in Nansen data. **Each trade needs the user's approval.** Autonomous agents are held back in **backtesting and paper trading** (s) ([The Block](https://www.theblock.co/post/386116/nansen-rolls-out-integrated-ai-trading-solana-base), [The Block](https://theblock.co/post/409914/nansen-ceo-bets-on-ai-agents-to-overtake-human-traders-within-two-years)) | Embedded Privy wallet · **Solana + Base** (Jan 21 2026), Hyperliquid perps added in June; routed via Jupiter, OKX, LI.FI | **Proprietary: 500M+ labeled wallets** | Data-backed suggestions; no enforced gates found | No | n/v | Nansen (well funded) | **$500M+ trading volume in 2026** (s, [Cryptonews AU](https://cryptonews.com.au/news/nansen-ceo-bets-ai-trading-agents-will-outnumber-human-traders-within-two-years-134419/)) | Live; autonomy coming |
| **Fere AI** | A self-improving agent with its own wallet that "researches, builds setups, executes and monitors 24/7" ([GlobeNewswire](https://www.globenewswire.com/news-release/2026/04/23/3279629/0/en/fere-ai-raises-1-3m-to-put-a-self-improving-trading-agent-in-everyone-s-hands.html)) | Own wallet · ETH, **SOL, Base**, Arbitrum, BNB, **Polymarket** | n/v | Entry/exit rules, stop-loss | No (claims a "79% win rate," vendor) | $9 / $29 / $99 a month in credits (s, [Toolradar](https://toolradar.com/tools/fere-ai/pricing)) | **$1.3M led by Ethereal Ventures**, Apr 23 2026 | **7,000+ daily users; 10M+ autonomous executions; #2 on Product Hunt, May 17 2026** (s, [Hunted](https://hunted.space/dashboard/fere-ai)) | Live |
| **Ask Gina** | A chat concierge, plus "Recipes": Gina writes code that runs on a schedule or trigger, 24/7 (see note 15) ([askgina.ai](https://askgina.ai/), [pm.wiki](https://pm.wiki/projects/ask-gina)) | Self-custodial Privy, gas sponsored · 12+ chains, Polymarket, Hyperliquid | Ships a Predictions MCP ([Docs](https://docs.askgina.ai/predictions-mcp/introduction)) | None found | None found | Credits; 3M free a month (s) | **Prelude, Coinbase Ventures** (amount n/v) | None found | Live |
| **Bankr** | Chat-to-trade on X and Farcaster, plus automations through its API. Pivoting to "financial rails for self-sustaining agents": token launches, **an LLM gateway paid from trading fees, x402 Cloud and a CLI that pays any x402 endpoint** ([0x](https://0x.org/case-study/bankr), [Docs](https://docs.bankr.bot/x402-cloud/overview/), [KuCoin](https://www.kucoin.com/news/articles/bnkr-market-cap-surpasses-120m-bankr-launches-token-issuance-platform-and-teases-llm-key-feature)) | Hosted wallets · Base and others | **x402 native** | None found | Social commands are public | Swap fees; x402 Cloud takes 5% | BNKR token: ~$42M market cap, 234k holders (s, [CMC](https://coinmarketcap.com/cmc-ai/bankr-coin/latest-updates/)) | **Conflicting:** $4.74B token-launch volume and $30M+ fees (s, KuCoin) vs $5.54B and $23.9M creator fees (s, CMC). The 0x swap figure is disputed; see §7 | Live |
| HeyElsa | Chat-to-execute DeFi agent ([Blog](https://blog.heyelsa.ai/heyelsa-raises-3m-to-build-ai-stack-for-crypto/)) | Base, multi | — | — | Trading arena planned | Token (ELSA, TGE Jan 2026) | $3M led by M31, with Coinbase Ventures | $300M+ volume by end-2025 (s, [CMC](https://coinmarketcap.com/cmc-ai/heyelsa/latest-updates/)) | Live |
| Velvet Capital | "DeFAI OS". The Velvet Unicorn multi-agent system proposes transactions for the user to approve; autonomous 24/7 strategies can be set from a prompt ([Blog](https://blog.velvet.capital/p/build-your-own-autonomous-247-ai)) | Base, ETH, BNB, **Solana**, Hyperliquid, Monad, Sonic | MCP | — | — | Token | $3.7M led by YZi Labs (Binance Labs), Jul 2025 | **Claims 100k users and $200M volume, but DefiLlama shows ~$5M TVL** (s, ?, [Solana Compass](https://solanacompass.com/projects/velvet-capital)) | Live |
| Donut | An "agentic crypto browser" that researches and executes, "even while users are offline" ([Decrypt](https://decrypt.co/347204/ai-browsers-headed-crypto-donut-labs-22-million-build-first)) | Multi | — | "Risk analysis" | — | — | **$22M across pre-seed and seed (Bitkraft, Sequoia China, Hack VC, Makers Fund)** | 160k waitlist (late 2025); 2026 launch status not verified ? | ? |
| AgentDesk · SolBot · Milo | Small Solana memecoin agent apps; Milo's auto-trader is in closed beta ([AgentDesk](https://agentdesk.fun/), [SolBot](https://solbotai.org/)) | Solana | — | — | AgentDesk logs trades on-chain | — | — | n/v | Fringe |

### E. Dropped from the competitive set (dead, pivoted, or not consumer trading)

| Product | Why dropped | Source |
|---|---|---|
| Griffain | A token-led DeFAI launchpad; ~$8M market cap in 2026; no product traction found | [CMC](https://coinmarketcap.com/cmc-ai/griffain/latest-updates/) |
| Hey Anon | Pivoted to a developer API (Mar 2026), the Pandora prediction market (Feb 2026) and an AMM on Robinhood Chain (Sep 2026) | [CoinDesk PR](https://www.coindesk.com/press-release/2026/02/23/hey-anon-announces-launch-of-pandora-prediction-market-on-ethereum), [CryptoBriefing](https://cryptobriefing.com/heyanon-token-triples-equilibra-robinhood-chain/) |
| Orbit (SphereOne, GRIFT) | A Dec 2024 DeFAI chat token; no 2026 activity found | [Solana Compass](https://solanacompass.com/projects/orbit) |
| Axal | $2.5M pre-seed (CMT Digital, 2024) for "Autopilot"; no 2026 activity found | [The Block](https://www.theblock.co/post/323397/cmt-digital-leads-2-5-million-pre-seed-round-for-autonomous-agent-network-developer-axal) |
| Wayfinder | Omnichain agent "shells" plus the Paths plugin and strategy marketplace (Jun 4 2026); token-led, power users | [CMC](https://coinmarketcap.com/cmc-ai/wayfinder/latest-updates/) |
| Giza | ARMA and Pulse yield agents were **retired in Mar 2026 and funds returned** (peak: 60k agents, $40M AUA); relaunched as a unified agent with no verifiable on-chain AUA | [OwnYourMind](https://ownyourmind.ai/projects/giza/) |
| Almanak | Quant and yield vaults, not retail trading. TVL claims conflict: ">$120M" (s) vs ~$9.8M (DefiLlama, note 07) | [CMC](https://coinmarketcap.com/currencies/almanak/) |
| Sail (sail.money) | A self-custody SMA protocol plus Sailor, a harness for Claude Code and Codex that runs on the user's machine; EVM only; mostly yield (see note 11). A "~$700M AUM routed" figure is unverified ? | [Definitive](https://www.definitive.fi/blog/sail), [SZNS](https://szns.substack.com/p/sail-protocol-update) |
| Surf | Crypto research AI ($15M led by Pantera, Dec 2025); some "background automation," but research-first | [PR Newswire](https://www.prnewswire.com/news-releases/surf-raises-15m-to-scale-the-first-ai-model-purpose-built-for-digital-assets-302638051.html) |
| GMGN Agent API / Skills | A developer API and skills (rug, insider and bundle data plus execution on SOL, BSC and Base), **custodial**. A data supplier and a fast follower, not a consumer agent | [GitHub](https://github.com/GMGNAI/gmgn-skills), [Bitget News](https://www.bitget.com/news/detail/12560605274680) |
| Olas Polystrat | An autonomous Polymarket agent (Feb 2026; 4,200 trades in its first month) | [IT Brief](https://itbrief.co.uk/story/olas-launches-pearl-connect-for-claude-coding-agents) |
| Pump.fun "Mayhem" | A protocol-run agent that trades a coin during its first 24h; not a user's agent; negligible impact | [The Block](https://www.theblock.co/post/379285/pump-funs-new-mayhem-mode-fails-boost-token-launches-revenue) |
| Nof1 (Alpha Arena) | A benchmark ($15M seed). A consumer "coding agents for markets" platform is *planned* | [Ventureburn](https://ventureburn.com/nof1-raises-15m-to-expand-ai-trading-platform/) |

---

## 2. Where Tocker is NOT different (say it before a VC does)

| Tocker feature | Who else already ships it |
|---|---|
| Plain-English strategy → agent | Binance AI Pro, Robinhood Agents, Senpi, Minara Autopilot, Fere, Velvet, Gina Recipes |
| Pick any LLM / BYO key | Binance AI Pro (OpenAI, Anthropic), Robinhood (charges lab rates), Wallet V (7 model families), Cod3x; Coinbase and Robinhood MCP let you bring ChatGPT or Claude |
| Agent gets its own wallet | Phantom MCP, MetaMask Agent Wallet, Coinbase Agentic Wallets, Privy (Gina, Nansen) are commodity |
| Runs 24/7 on hosted servers | Senpi, Fere, Minara, Binance, Robinhood |
| Autonomy | **Not a Tocker edge.** Tocker defaults to *entry approval* (09-product-codebase), the same as Robinhood's default |
| Exits enforced in code | Minara (mandatory TP/SL, drawdown limits), Senpi (DSL trailing stops), GMGN TP/SL orders |
| Pays for data per call over x402 | Coinbase for Agents ("pay for premium research"), Bankr CLI. The rug-check data itself is sold to any agent per call ([x402-seller](https://github.com/wyattpalm2-eng/x402-seller): launch radar $0.08, rug score $0.03). **x402 is plumbing, not a moat**, as the VC review already said |
| Public track record | Senpi Agents Arena, Wallet V benchmark, Nof1 Alpha Arena; every Hyperliquid fill is public |
| Fee | **Not the cheapest.** Senpi charges 5 bps, Binance AI Pro $9.99/mo, Fere $9–99/mo. 20 bps beats only the 1% Telegram bots |

---

## 3. The two axes that actually separate Tocker

**X: market reach.** At one end, *venue-locked*: the agent trades only what one exchange, broker or perp DEX lists. At the other, *the open on-chain market*: any token on Solana or Base, through the agent's own wallet.
- This rules out Robinhood, Binance, Bitget and Coinbase (listed assets) and Senpi, Minara, Cod3x and Wallet V (Hyperliquid perps on majors).
- It is honest: those products are *safer* because their venues pre-screen what's listed. On the open market the dominant risk is the token itself (rugs, honeypots, mint and freeze authority, sell-blocks), not leverage.

**Y: who has the last word on a buy.** At one end, *the model, or your click*: prompt guardrails, spend caps, an isolated account. At the other, *code*: hard gates that veto a buy whatever the LLM says, with exits also enforced in code.
- On the open-market side, Nansen, Fere, Gina, Bankr, HeyElsa and Velvet all leave the buy decision to the model or to a human click. I found no enforced token screening in any of them.
- MetaMask Agent Wallet has code-level *transaction* scanning (Blockaid), but it's a rail with no strategy, EVM only, and in early access.
- Why it matters now: OpenClaw users lost money because "agents misunderstood instructions and handed over all funds," and 1,184 malicious skills were caught ([TechFlow](https://www.techflowpost.com/en-US/article/30957), [Aurpay](https://aurpay.net/aurspace/openclaw-ai-trading-skills-complete-guide-2026/)). Only 42% of Wallet V's user-built LLM agents had PnL ≥ 0, and only 6 of Nof1's 32 model runs were profitable (note 07).

```
                         CODE HAS THE LAST WORD
                (hard gates the model can't override)
                                  │
   Minara (mandatory TP/SL)       │                          ★ TOCKER
   Senpi  (DSL exits, Arena)      │   MetaMask Agent Wallet
                                  │   (tx scan; rails, EVM, no strategy)
 VENUE-LOCKED ────────────────────┼──────────────────── OPEN ON-CHAIN
 (listed assets / HL perps)       │              (any Solana/Base token)
   Robinhood Agents               │   Nansen AI (approve each trade)
   Binance AI Pro · Bitget        │   Fere AI · Ask Gina · Bankr
   Coinbase for Agents            │   HeyElsa · Velvet
                                  │
                      THE MODEL / YOUR CLICK DECIDES
                    (prompt rules, spend caps, sub-account)
```

**Put the third element under the chart, not on an axis:** "Public, verified record; private strategy; no copy button." Senpi, Wallet V and Nof1 also publish performance, so it's not unique on its own. Combined with the top-right quadrant, it's the reason a good operator would publish on Tocker. Use it as the caption, not as a claim to be first.

The VC review suggested "autonomous vs manual" as an axis. **Don't use it.** Robinhood, Binance, Senpi and Fere are all autonomous, and Tocker's own default is entry approval, so a VC would point both out at once.

---

## 4. Series A slide shortlist (6, with alternates)

| # | Competitor | One line | Key fact (source) | Quadrant |
|---|---|---|---|---|
| 1 | **Robinhood Agents** | In-app agents that build a strategy and trade stocks, options and crypto from a pre-funded account; approval on by default | 150k+ agentic accounts since May 2026 (s, [KuCoin](https://www.kucoin.com/news/flash/robinhood-launches-in-app-ai-trading-agents-for-us-customers)) | Venue-locked · model decides |
| 2 | **Binance AI Pro** | Plain-English → automated strategy, choice of LLM, isolated sub-account | $9.99/mo beta; broad rollout in the second half of Oct 2026 (s, [Cointribune](https://www.cointribune.com/en/binance-rolls-out-ai-pro-trading-agent-in-october-2026/)) | Venue-locked · model decides |
| 3 | **Senpi** | Personal autonomous perp agents on Hyperliquid | $4M+ seed (Lemniscap, Coinbase Ventures); >$100M volume; 0.05% fee (s, [TFN](https://techfundingnews.com/senpi-ai-powered-crypto-wallet-raises-4m/), [Terms](https://senpi.ai/terms)) | Venue-locked · code exits |
| 4 | **Nansen AI** | Chat-to-trade on Solana + Base on top of 500M labeled wallets; approve each trade | $500M+ volume in 2026; autonomous agents in paper trading (s, [The Block](https://theblock.co/post/409914/nansen-ceo-bets-on-ai-agents-to-overtake-human-traders-within-two-years)) | Open · model or click decides |
| 5 | **Fere AI** | A 24/7 self-improving agent with its own wallet; SOL, Base, ETH and Polymarket | 7,000+ daily users; $1.3M seed (s, [GlobeNewswire](https://www.globenewswire.com/news-release/2026/04/23/3279629/0/en/fere-ai-raises-1-3m-to-put-a-self-improving-trading-agent-in-everyone-s-hands.html)) | Open · model decides |
| 6 | **Ask Gina** | Chat concierge plus Recipes, scheduled code that runs 24/7; Polymarket and 12+ chains | Backed by Coinbase Ventures and Prelude; no traction disclosed ([pm.wiki](https://pm.wiki/projects/ask-gina)) | Open · model decides |

**Alternates:** Bankr (swap in for Gina if you'd rather show real volume), Minara (in place of Senpi on perps volume), and Bitget GetAgent (a third CEX). **Footnote "rails we build on":** Coinbase for Agents, MetaMask Agent Wallet, Phantom MCP. **Remove** Axiom, fomo, GMGN (a supplier and fast follower) and Sail (yield/SMA, no Solana).

---

## 5. Positioning line

> **"Robinhood's and Binance's agents trade what they list. Tocker's trade the whole on-chain market, and code, not the model, has the last word on every buy."**

Short form for the slide header: **"Your AI trades the open market. Code has the last word."**

Spoken backup: "The model proposes, the code disposes. Ten gates veto a rug no matter what the LLM says, exits run in code, and the record is public while the strategy stays yours."

---

## 6. Who is clearly ahead of Tocker, and on what

| Competitor | Ahead on |
|---|---|
| Robinhood | Distribution (27.5M customers), regulation and trust, 60-second onboarding, multi-asset coverage. "Loops" (standing instructions) will close the strategy gap |
| Binance AI Pro | Price ($9.99/mo), distribution, LLM choice inside a regulated-ish venue |
| **Nansen AI** | **Data (500M labeled wallets) on Tocker's exact chains**, a mobile app, $500M+ volume, brand. Autonomous agents are already in testing |
| Senpi | Shipped autonomy with traction, a public Arena, 80+ open strategy templates, a mobile app, a 5 bps fee |
| Minara | A disciplined perp safety design (mandatory TP/SL, drawdown limits) and billions of cumulative volume |
| MetaMask Agent Wallet | Transaction-level safety: simulation, Blockaid scanning, 2FA Guard Mode, **$10k/mo loss coverage** |
| Fere AI | Users (7k+ daily) and breadth (Polymarket is live; it's still on Tocker's roadmap) |
| Coinbase for Agents | Native x402 data buying inside the largest US exchange |

---

## 7. Threats (ranked)

1. **Nansen goes autonomous.** If Nansen ships autonomous agents with its own screens on Solana and Base, it becomes "Tocker with better data and an existing user base." Tocker also buys Nansen data (07), which makes this a supplier risk. *Answer:* Tocker is model-agnostic and data-agnostic (13 x402 sources), and its gates and frozen per-trade scores are neutral infrastructure. Nansen's agent will favor Nansen's data.
2. **An incumbent opens to on-chain tokens.** Robinhood Chain (live Jul 1 2026, [AXL](https://www.axltoken.com/trading-bots/fomo-vs-pump-fun-vs-axiom/)) and Binance Wallet could point their agents at long-tail on-chain tokens. *Answer:* incumbents have a listing and liability reason *not* to auto-buy unlisted tokens. The open long tail is structurally the startup's lane.
3. **GMGN or the OpenClaw ecosystem.** GMGN already sells the rug and insider data plus execution as agent skills (custodial). A hosted, one-click "GMGN Agent" would compete directly. *Answer:* custodial, a 1% fee culture and a copy-trading social layer. Tocker's gates are policy enforced in code, not data.
4. **Commoditized safety data.** Rug scores are sold per call over x402 to anyone (x402-seller). *Answer:* the moat is enforcement plus the audit trail (scores frozen onto every trade) plus the verified record, not the data.
5. **Price compression.** Senpi charges 5 bps and CEX agents run on $10/mo subscriptions. Don't pitch "cheaper" against agents, only against 1% Telegram bots.

---

## 8. Corrections to earlier notes

- **Bankr's 0x volume.** Note 11 says "$35.8B" and note 07 says "$35.8M". The search extract of the 0x page reads "$35.8 billion," but the same page reports **$91,135 in integrator fees**. That fee is ~0.25% of $35.8M and 0.00025% of $35.8B, so **$35.8M is almost certainly correct** (?, the page is blocked). Better Bankr metrics are its token-launch volume and fees (§1D), but those conflict too.
- **Senpi's seed:** $4M (TFN) vs $4.5M (another extract). Use "$4M+".
- **Giza:** ARMA was retired in Mar 2026. Drop "ARMA ~$3M AUA."
- **Griffain, Hey Anon, Orbit, Axal, Spectral:** no consumer traction in 2026. Drop them from all slides.
- **Still do not use** "AI agents = 34% of Solana meme volume." It keeps circulating ([Blockonomi](https://blockonomi.com/from-8-to-34-how-ai-agents-took-over-solana-memecoin-dex-volume-in-90-days/)) with no primary data behind it.

## 9. Open verification items (before the deck ships)

The search budget ran out, so the following are unverified:
- Robinhood's 150k agentic accounts (one aggregator extract).
- Nansen's $500M volume and the status of its autonomous agents.
- The date of Bitget's 1M users / $1.2B.
- Fere's 7k daily users (Product Hunt-page extract).
- Minara's DefiLlama figures.
- Whether Donut's browser has launched publicly.
- Senpi's traction after February 2026.
- Any Ask Gina traction or safety features.
- Whether Senpi and Minara are custodial.
