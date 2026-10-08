# Ask Gina (askgina.ai): verified profile, Oct 8, 2026

**Method.** WebFetch could not resolve askgina.ai, docs.askgina.ai, Companies House or Polymarket's builder pages (DNS errors), and curl through the proxy was refused. So askgina.ai and docs claims come from search-engine extracts, marked **(s)**.

Ask Gina's public GitHub org (`askgina`) mirrors its product docs, and GitHub *was* reachable. Anything sourced there was read first-hand, marked **(gh)**. The docs live in `askgina/plugins/docs/…`; the founder, sidshekhar, committed to that repo on Oct 3, 2026.

**Labels.** **Verified** = primary first-hand or independent. **Self-reported** = the company's own claim. **Third-party** = an aggregator.

---

## 1. What it is
- **One sentence.** "An AI assistant with a wallet" (gh, `docs/what-is-gina.mdx`). You chat to research crypto, Polymarket and Hyperliquid, prepare or execute trades, and set up "Recipes": scheduled or event-triggered workflows that Gina writes as code and runs 24/7.
- **Product surfaces:**
  - Web app at askgina.ai: Chat, Predictions, Perps, Wallet, Automations, and Files and memory (gh, product-guide).
  - **MCP servers.** These connect Claude Code, Codex, Cursor, Windsurf, OpenClaw and others.
    - Read-only access by default.
    - Trading needs separate write access, called "Degen mode" (gh).
    - The Predictions MCP lives at askgina.ai/ai/predictions/mcp (s).
  - OpenClaw skill `askgina-polymarket` (v0.1.2, Feb 2026, 366 downloads; third-party listing).
  - Public model-eval site, evals.askgina.ai (gh).
- **Origin.** Gina started as an AI agent on the Farcaster feed (@askgina.eth, renamed from TYBB) and then added a wallet (s, Zerion case study; askgina.ai blog).
- **No Telegram bot found.**

## 2. Launch and stage
- **Company.** TYBB Labs Ltd was incorporated **Jul 8, 2024** (UK Companies House no. 15823991; registered office Covent Garden, London; officers Sidharth Shekhar and Eric Juta) (s, Companies House snippet).
- **Farcaster agent.** Launched **Aug 2024** (s, Zerion case study); the docs say "mid-2024".
- **Status: live web app.** Older material said "limited beta". The docs now cover Polymarket and Hyperliquid in the app and over MCP.
  - Copy trading is "available only to accounts with copy trading enabled". It was documented on Sep 6, 2026 (gh).
- **Team.** London-based: the X profile says United Kingdom, and the registered office is in London.
  - Founder and CEO **Sid Shekhar** co-founded TokenAnalyst and later led blockchain research at Coinbase.
  - Correction: press at the time (The Block, May 5, 2020) reported that **TokenAnalyst shut down and part of the team joined Coinbase**. "Acquired by Coinbase" is Sid's own bio wording. On a slide, say "team joined Coinbase".

## 3. Funding
| Date | Round | Amount | Lead | Investors | Confidence |
|---|---|---|---|---|---|
| Undisclosed | Undisclosed | **Undisclosed** | Undisclosed | **Coinbase Ventures, Prelude** (@preludexyz, formerly Cherry Crypto) | **Self-reported**: homepage "Backed by" logos and the X bio. No announcement, database entry (Crunchbase, Tracxn, DefiLlama) or investor-side confirmation found |

- **No 2026 round found.**
- **Context only, do not infer:** Prelude's typical cheque is $500K–$2M (f4.fund).

## 4. Traction
- **None published.**
  - No user, AUM, volume or revenue figures on the site, docs, X or press.
  - No DefiLlama or Dune page.
  - No Polymarket builder-leaderboard entry found. The leaderboard was not reachable directly; a Top-10 snapshot from ~Apr 2026 does not include Gina.
- **Qualitative only:** the homepage headline "some of our users haven't placed a trade manually in weeks" (s, self-reported, no numbers).
- **Weak public proxies:**
  - GitHub `askgina/plugins`: 5 stars. `awesome-gina`: 6 stars and 3 forks (gh, Oct 2026).
  - OpenClaw skill: 366 downloads (third-party).
- **Token caution.** A Base token named "askgina.ai (GINA)" (0x34F8…cD2, ~$38K market cap) and a Solana pump.fun "Ask Gina" token both exist. **Neither is tied to the company** in any official source, so do not treat them as company tokens.

## 5. Markets and chains
- **Spot** swaps, sends and bridges on 12+ chains. The docs table lists Ethereum, Base, Arbitrum, Optimism, Polygon, BSC, Gnosis, Monad, Scroll and Solana; the homepage adds Avalanche and Linea (s). Gina's own evals also reference Robinhood Chain (gh).
- **Polymarket**, using USDC on Polygon (s; gh `predictions.mdx`).
- **Hyperliquid perps**, with long and short positions, collateral and SL/TP (s). LP and yield positions are also supported (gh).
- **Stocks: none found.**

## 6. Business model
- **Credits.**
  - 3M free credits a month for everyone; 10M a month for Genesis NFT holders. Free credits expire monthly.
  - Packs cost **$10 per 5M credits, up to $60 per 30M**, paid in crypto from the Gina wallet on about 10 chains (s, askgina.ai/docs; gh `what-is-gina.mdx` confirms 3M free credits and crypto purchase).
  - A third-party listing says credits pay for "model use, market data calls, charts, and agent work".
- **Recipe run caps.** 1,000 runs a month for free users; 100,000 a month after buying credits (s, docs).
- **Fees.**
  - Cross-chain swaps: $0.10 flat up to $2, then **0.8% per swap above $2** (s, docs).
  - No published same-chain swap fee.
  - Gas is sponsored after a credit purchase (gh).
- **No company token.**

## 7. Autonomy
- **In chat: chat-to-execute.**
  - Saying "prepare", "quote" or "do not execute" gets a proposal.
  - "A send or swap request can authorize execution" (gh product-guide).
  - Gina's own execution evals grade "quote → user approval → execute" (gh PR #136, Oct 1, 2026).
- **Recipes: unattended.**
  - The user describes the outcome plus a cadence (cron-like) or a webhook event. Gina generates the workflow, the user tests it in Simulated mode, then switches to "Run Live", which "can perform real actions" on schedule (gh `automations/recipes.mdx`, `schedules`, `webhooks`).
  - Example curated recipes: "BTC Hourly Buy (75–95 odds)" at :45/:52 each hour, an NBA bet executor at $5 per bet, and a daily BTC stop-loss (gh `awesome-gina/docs/categories/recipes.md`).
- **Copy trading.** Pick a trader's profile, set venue, funding, sizing and limits, and enable it. Runs are automated. Access is gated per account (gh).
- **Wallet.** Privy self-custodial EVM and Solana wallets with delegated access. You cannot connect an external wallet (s).

## 8. The four columns
| Column | Mark | Evidence | URL |
|---|---|---|---|
| **Agent-paid inference** | **Y** (credits) | Usage is metered in Gina credits (3M free a month; $10 per 5M), bought with crypto. A third-party listing says credits pay for model use. Not BYO-key and not x402. | https://askgina.ai/docs (s) · https://github.com/askgina/plugins/blob/main/docs/what-is-gina.mdx · https://polymart.app/ask-gina |
| **x402 alpha (buys data)** | **N** | No evidence that Gina buys paid data per call. Its data comes from integrated APIs, e.g. Zerion. Gina does not sell x402 endpoints either. | https://zerion.io/blog/askgina-ai-wallet-companion-built-with-zerion-api/ |
| **Token filters and gates** | **P** | User-set rules only: Recipe thresholds and kill conditions (e.g. a BTC stop-loss), SL/TP on perps, and a Simulated-mode default for testing. On-demand holder-concentration analysis exists, but **no enforced pre-buy honeypot, rug or liquidity gate was found.** | https://github.com/askgina/awesome-gina · https://askgina.ai/docs (s) |
| **Social trading** | **P** | **Copy trading**: open a trader's profile, activity and performance, then click "Copy trade". It is gated to enabled accounts and documented Sep 6, 2026. There is also a community recipe and strategy library on GitHub. **No public feed or leaderboard of Gina users' trades found.** The evals leaderboard ranks LLMs, not traders. | https://github.com/askgina/plugins/blob/main/docs/product-guide/automations/copy-trading.mdx |

## 9. Best at (≤6 words)
**Plain-English Polymarket automations, one wallet.** Alternative: "Chat-built 24/7 Recipes across venues."

## 10. Gap vs Tocker
Gina writes and runs whatever the user asks. There is no enforced token-safety gate, no paid-data buying and no public verified trade record, and it has published no traction or round size.

## 11. One killer stat
**"One chat wallet reaches 12+ chains, all of Polymarket and every Hyperliquid perp" (askgina.ai and docs, Oct 2026; self-reported product scope).**
- No traction number exists to quote.
- A slide could add: "backed by Coinbase Ventures + Prelude (amount undisclosed, self-reported)". Credit the founder as "ex-Coinbase research lead", not "sold a company to Coinbase".

## 12. Logo
- **GitHub org: `askgina`** (id 262378776, display name "Ask Gina"). It is confirmed official:
  - Its website field is askgina.ai.
  - It holds `plugins` (homepage evals.askgina.ai; the README points to the production MCP at askgina.ai/ai/gina/mcp; founder **sidshekhar** commits there, e.g. Oct 3, 2026) and `awesome-gina` (the Recipes library).
- **Avatar:** https://avatars.githubusercontent.com/u/262378776?v=4. It is a **red beret** (a darker red underside and a small stalk on top) on an off-white background.
- A GitHub *user* account, **`askginadotai`** (id 230459318), has the identical beret avatar and matches the X handle.
- **X: @askginadotai** is the primary handle: the founder's bio says "Founder @askginadotai", and the ClawHub listing uses it. A secondary **@AskGinaAI** (created Mar 2025) links to askgina.ai and @askginadotai.
- I could not view the X avatar images (x.com, pbs.twimg.com and unavatar were blocked), so I cannot describe them first-hand.

---

## Sources
- https://askgina.ai/ (s)
- https://askgina.ai/docs (s; credits, packs, recipe caps, cross-chain fee)
- https://docs.askgina.ai/predictions-mcp/introduction (s)
- https://docs.askgina.ai/openclaw-skills (s)
- https://github.com/askgina (gh)
- https://github.com/askgina/plugins (gh)
- https://github.com/askgina/plugins/blob/main/docs/what-is-gina.mdx (gh)
- https://github.com/askgina/plugins/blob/main/docs/product-guide/index.mdx (gh)
- https://github.com/askgina/plugins/blob/main/docs/product-guide/automations/copy-trading.mdx (gh; commits Sep 6 and Sep 28, 2026)
- https://github.com/askgina/plugins/blob/main/docs/product-guide/automations/recipes.mdx (gh)
- https://github.com/askgina/plugins/blob/main/docs/product-guide/automations/webhooks.mdx (gh)
- https://github.com/askgina/plugins/blob/main/docs/product-guide/predictions.mdx (gh)
- https://github.com/askgina/plugins/pull/136 (gh; execution evals, Oct 1, 2026)
- https://github.com/askgina/plugins/commits/main (gh)
- https://github.com/askgina/awesome-gina (gh)
- https://github.com/askgina/awesome-gina/blob/main/docs/categories/recipes.md (gh)
- https://github.com/askgina/awesome-gina/blob/main/docs/specs/publish-button-flow.md (gh)
- https://zerion.io/blog/askgina-ai-wallet-companion-built-with-zerion-api/ (s)
- https://askgina.ai/blog/building-gina-month-1 (s)
- https://askgina.ai/blog/from-chat-to-chain-building-production-multi-agent-ai-web3 (s; Sep 1, 2025)
- https://polymart.app/ask-gina (s; third-party; the domain has a low trust score on Gridinsoft)
- https://clawskills.sh/skills/sidshekhar-askgina-polymarket (s)
- https://find-and-update.company-information.service.gov.uk/company/15823991 (s)
- https://www.sidshekhar.com/ (s)
- https://x.com/sidshekhar24 (s)
- https://x.com/AskGinaAI (s)
- https://www.theblock.co/news/ecosystems/2020-05-05-blockchain-insights-tokenanalyst-shutting-down-64116 (s)
- https://www.crowdfundinsider.com/2020/05/161094-crypto-data-insights-platform-tokenanalyst-to-shut-down-founders-join-coinbase/ (s)
- https://f4.fund/firms/prelude (s; Prelude ex-Cherry Crypto, cheque size)
- https://www.coinbase.com/price/base-askginaai (s; unaffiliated GINA token)
- https://docs.polymarket.com/api-reference/builders/get-aggregated-builder-leaderboard (s)
- https://x.com/top7ico/status/2043666799137280146 (s; builder top 10, ~Apr 2026, no Gina)
