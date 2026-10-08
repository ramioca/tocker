# ClawPump (clawpump.tech): deep profile, verified Oct 8 2026

**Method.** WebFetch and curl could not reach clawpump.tech, x.com or most news sites (DNS errors and proxy 403s). Web facts below come from search extracts, marked (s). I also read primary material directly:
- ClawPump's official GitHub org `Clawpump` (repos `agents-skills`, `ClawpumpSDK`, `claw-agent`, `claw-app`), cloned Oct 8 2026.
- Its four official npm packages (`clawpump`, `@clawpump/agents`, `@clawpump/mcp`, `@clawpump/claw-agent`), read from registry.npmjs.org, including the built `@clawpump/agents@0.1.27` MCP server code.

These are marked (p). Confidence labels: **V** = verified (primary source or independent third party), **S** = self-reported by ClawPump, **NF** = not found.

---

## 1. What it is
**One sentence.** A Solana platform that gives each AI agent its own wallet plus 130-odd MCP tools, so it can trade, run perps, DCA, lend, bet on prediction markets, pay for x402 APIs and launch its own token, which earns creator fees for it. Tagline: "Where Agents Become Agentic Companies." (V, p: `Clawpump/agents-skills/skills/clawpump/SKILL.md` v1.3.0)

**Surfaces.**
- **Web app and dashboard** at agents.clawpump.tech: create agents, buy credits, and an agent marketplace (p: `@clawpump/agents` README).
- **Hosted MCP server.** The `@clawpump/agents` package has 132 tools, 10 resources and 10 prompts. The README badge says 132; the `SKILL.md` says 134; the older `@clawpump/mcp` remote server at clawpump.tech/api/mcp has 79 tools.
- **REST API and TS SDK** (`@clawpump/sdk`). Tiers are Free, Builder $49/mo, Scale $199/mo and Enterprise.
- **CLI** (`npx clawpump launch`) for launching tokens.
- **"Claw Agent"**: a desktop app (macOS) and an npm installer. It is a fork of Nous Research's Hermes Agent.
- **X auto-posting** through the agent's "social" skill.

I found no Telegram bot.

## 2. Launch / stage
- **Live since at least early Feb 2026** (V, indirect). Third-party GitHub repos that track "my clawpump token earnings" were created Feb 2–3 2026. Phantom's page dates the CLAW token to Feb 2026 (s).
- The founders say it grew out of a hackathon MVP that moved $20–25M in its first week (S, iProUP / Ecosistema Startup, s).
- **Status: live, public.**
  - Expanded from Solana to Robinhood Chain. Token launches work via pons and Uniswap v4 (pools.trade) (p: `clawpump` CLI README, v0.13.1, Sep 4 2026).
  - It ran the "AnsemHack Clawrena" hackathon from Aug 19 to Oct 8 2026, with $350K in $ANSEM, cash and compute (s, clawpump.tech/ansemhack).
- **Team: USA + Argentina** (V, Colosseum Cohort 5 listing, s).
  - Co-founders are Mauricio Trujillo Ramírez ("bunny", @ConejoCapital) and Tomás Del Manzo Oliver (@tomi204) (s, Ecosistema Startup / El Economista).
  - The two are also the npm maintainers `conejocapital` and `tomi204` (V, p).

## 3. Funding
| Round | Amount | Lead / investor | Date | Confidence |
|---|---|---|---|---|
| Pump.fun "Build in Public" hackathon, 5th of 12 winners | **$250K** | Pump Fund | Mar 16 2026 | V (Pump Spotlight on X, `status/2033637904065388863`; date decoded from the post ID) |
| Colosseum Accelerator **Cohort 5** (one of 21 startups; also a Solana Frontier Hackathon winner, Jun 26 2026) | Undisclosed for ClawPump. Colosseum's standard check is $250K for 7% on a post-money SAFE, but I did not confirm it for ClawPump | Colosseum | Cohort announced Jun 29 2026; Demo Day Aug 26 2026 | V for admission; amount NF |
| "Backed by @incubator" (Solana Incubator) | Undisclosed | Solana Incubator | n/a | S (X bio / site, s) |

- **Valuation.** One report puts the hackathon round at $250K on a $10M valuation (s). El Economista (Oct 2 2026) cites a company valuation of about $10M and an ecosystem of about $35M, both company figures (S, s).
- **Token.** $CLAW on pump.fun (mint `739dnZEG4yaBWFsY8L8ZwrfhGG6dhtCSercW8Umspump`).
  - The homepage says $15 of every $100 collected goes to open-market buybacks and burns.
  - An X post says 60% of revenue buys and burns CLAW (S, conflicting, s).
  - CLAW's market cap was about $3M on pump.fun/DexScreener snapshots and about $8.6M on another aggregator. On-chain, but snapshots differ (s).
- **Total disclosed: $250K** (Pump Fund). Colosseum's amount is undisclosed.

## 4. Traction (all company-reported unless noted; the figures conflict)
| Date | Figure | Source | Confidence |
|---|---|---|---|
| Mar 16 2026 | 1,700+ agents launched | Pump Spotlight (X) | S (repeated by investor) |
| ~May 2026 | 2,500+ tokens launched; 1,125+ SOL fees collected | `@clawpump/mcp` README (p) | S |
| Jun 1 2026 | $73M+ trading volume; 2,700+ funded agents | Pump Spotlight (X, `status/2061531276293603553`) | S |
| Aug 24 2026 | "$125M (now crossing $150M)" agent-driven volume | @ConejoCapital (co-founder) on X | S |
| Aug 26 2026 | "$120M+" (Demo Day program); a Colosseum blog says "$100M+ spot + perps, 5,000+ autonomous agents" | Colosseum (investor) | S (company data, cited by investor) |
| undated snapshot | **$120.16M total volume, 99.6% spot, perps only $457K; 7,105 agents funded; 5,736.58 SOL "agentic funding"** | clawpump.tech/analytics | S (first-party dashboard) |
| Sep 20 2026 | $180M+ volume; 17,500+ agents created ("six months") | iProUP | S |
| Sep 22 2026 | $200M+ volume; 16,000+ agents funded | Coinfomania / KuCoin | S |
| Oct 2 2026 | ~$170M via 14,000 agents; **$2M+ revenue; $1M+ paid out to builders** | El Economista | S |
| **Oct 3 2026** | **$225M+ total volume; $10.25M 24h volume; $61.4M ecosystem market cap; 13,991 SOL agentic funding** | @clawpumptech pinned post (AnsemHack close) | S |

- **Independent verification: NF.** I found no DefiLlama listing and no Dune dashboard.
- **Conflicts.**
  - The Oct 2 figure ($170M) is lower than the Sep 20 and Sep 22 figures ($180M, $200M).
  - "Agents" is variously counted as "launched", "funded" and "created".
  - The volume probably mixes agent swaps with trading in tokens the agents launched.
- **Users, AUM and TVL:** NF.

## 5. Markets and chains
- **Solana spot.** Jupiter plus OKX routing, "11+ DEXes"; DCA and limit orders; arbitrage scans (V, p).
- **Perps.** Phoenix perps on Solana. Each order needs `confirmRisk: true` (V, p). Perps are tiny: $457K of $120M (S, analytics).
- **Prediction markets.** Jupiter prediction markets, via the `predictions_*` tools. I found no direct Polymarket integration (V, p).
- **Other.** Jupiter Lend yield (V, p); gift cards (Laso); agent email (V, p).
- **Token launches.**
  - pump.fun on Solana: gasless for a user's first 3 launches.
  - Robinhood Chain via pons, where a launch can be paired with 42 approved assets, including tokenized stocks (AMZN, NVDA, TSLA, SPY…).
  - Uniswap v4 via pools.trade (V, p: CLI README).
- **Stocks.** Only as launch pair assets and as creator-fee payout assets ("RWA payouts" via Sunrise/Backpack, X post of Sep 2 2026, s). I found no agent stock trading.
- **Base: not found.** The EVM side is Robinhood Chain.

## 6. Business model
- **Creator-fee share on launched tokens.**
  - Homepage: 75% to the agent, 25% to the platform.
  - The current CLI README and the `@clawpump/mcp` README say 65% to the agent, 35% to ClawPump.
  - Copycat domains (clawpump.net, clawpumpsol.com) claim 80% or 65%.
  - All of these are S and they conflict. The CLI (V, p) is the most recent official statement: 65%.
- **Swap fee embedded in each transaction.** 0.85% on the Free tier, 0.50% on Builder ($49/mo), 0.30% on Scale ($199/mo), custom on Enterprise (V, p: SDK README; docs).
- **LLM inference credits** at a **30% markup** (docs, s). Credits are topped up in USDC; `sync_billing` says to "sync on-chain deposits … after depositing USDC" (V, p).
- **Other.** Marketplace for buying and selling agents (paid in SOL); paid API tiers; $CLAW buybacks.
- **Revenue:** "$2M+" (S, El Economista, Oct 2 2026).

## 7. Autonomy
- **Fully autonomous hosted agents.** "Agents run 24/7 on our infrastructure." (s, docs)
- **What the user configures:**
  - name, persona, system prompt and LLM (the default is `moonshotai/kimi-k2.5`; free models are available)
  - skills, chosen from presets: `monitor-exit`, `momentum`, `defi-yield`, `macro-guard`, `sniper`
  - automations: price-threshold triggers and scheduled triggers
  - autonomous "runs": objective, deep_research, iteration, monitor and loop modes, with budget and step limits
  - a daily budget (max spend, max tokens)
  - a withdrawal whitelist (V, p: SDK README and the MCP server code)
- **Also chat-to-execute** in the web app, or from Claude, Cursor or ChatGPT over MCP.
  - In the Hermes/MCP path, every fund-moving tool needs the user's explicit OK and a `confirm_*` flag (V, p).
- **Custody is ambiguous.** The site says "ClawPump never holds your keys", and the SDK swap API returns unsigned transactions. But the official `pay-sh` skill calls the agent wallet "custodial", and `x402_pay` says "the wallet signs server-side" (V, p).

## 8. The four columns
| Column | Mark | Evidence | URL |
|---|---|---|---|
| **Agent-paid inference** | **Y live** | Hosted agents bill LLM usage per token from a credit balance (paid models, e.g. Claude Sonnet 4.6 at $3.90/$19.50 per 1M tokens, which includes the markup), topped up with USDC deposits. You can also bring your own Claude/ChatGPT key via `save_integration` (platforms: twitter, claude, chatgpt, moltbook). Or fund a UsePod inference pod in USDC straight from the agent's wallet (`usepod_provision`). | https://github.com/Clawpump/ClawpumpSDK (README "Available Models") · https://github.com/Clawpump/agents-skills/blob/main/skills/clawpump/SKILL.md · npm `@clawpump/agents@0.1.27` dist/server.js |
| **x402 alpha** | **Y live** | `x402_pay` pays "ANY x402 endpoint URL … from the agent's ClawPump wallet (USDC)", hard-capped at `max_amount_usd`. There is also a Pay.sh catalog (`pay_sh_*`), Dexter x402 discovery, and "Trader Ralph" intelligence at $0.01/query over x402. **Caveats:** the agent needs the `x402` skill, and a user must approve each price or cap. Selling x402: NF. | https://github.com/Clawpump/agents-skills (skills/clawpump, pay-sh) · npm `@clawpump/mcp` README · https://www.clawpump.tech/docs (s) |
| **Token filters & gates** | **P** | ClawPump publishes an official `rug-check` skill (mint/freeze authority, LP lock/burn, top-holder concentration, RugCheck score). It says to run it "before any swap_execute", but it is read-only and opt-in. There are also community "meme-analyzer" and "survivor-check" skills, and a `sniper` skill that includes "security evaluation". The `swap_execute` code has no safety check before the swap (V, p). There is also a third-party "Gatekeeper" skill (12 checks, opt-in). | https://github.com/Clawpump/agents-skills/tree/main/skills/rug-check · https://github.com/trelnar/clawpump-products |
| **Social trading** | **P** | There is a public **leaderboard of agents by total earnings** (`leaderboard` tool, `/api/leaderboard`), and a public **agent marketplace** where you can browse agents, see SOL earned, token market cap and usage, and buy or bid on them. There is also a skill marketplace with "fork", "token duels", and agents auto-posting to X. I found **no public trade feed and no copy-trading or follow feature**, and no PnL leaderboard. | npm `@clawpump/mcp` README · https://clawpump.tech/marketplace (s) · `browse_public_agents` in `@clawpump/agents` |

## 9. Best at (≤6 words)
**Agent wallets, launches, 130+ MCP tools.** An alternative is "The Solana launchpad for agent economies."

## 10. Gap vs Tocker
ClawPump is a toolkit for agents to **earn** (launch tokens, collect fees, call tools). It is not a plain-English strategy trader. Its safety checks are opt-in skills, not a veto enforced in code, and it has no public per-fill record.

## 11. One killer stat
- **Best verified:** "Backed by Pump Fund ($250K, Mar 16 2026) and Colosseum (Accelerator Cohort 5, Jun 29 2026)." Both investors announced these themselves.
- **Best traction figure:** **"$225M+ agent volume" (self-reported, @clawpumptech, Oct 3 2026).** A more conservative figure, cited by an investor, is **"$120M+ volume" (Colosseum Demo Day, Aug 26 2026)**.
- On a slide, label either as "company-reported". No independent volume source exists.

## 12. Logo
- **GitHub org: `Clawpump`** (type Organization, id 262628513). It is **official**:
  - all four official npm packages (homepage clawpump.tech, maintainers tomi204 and conejocapital) point their `repository` field at `github.com/Clawpump/*`;
  - the SDK README links github.com/Clawpump/ClawpumpSDK, @clawpumptech and dev@clawpump.tech;
  - the org's website field is agents.clawpump.tech (s).
- **Avatar:** https://avatars.githubusercontent.com/u/262628513?v=4. It also resolves by name: https://avatars.githubusercontent.com/Clawpump (same bytes; checked by md5).
  - Description: a black square. On the left, a realistic human hand reaches right, in the pose of Michelangelo's "Creation of Adam". On the right, a bright green cartoon lobster/crab claw reaches back.
- **X avatar (@clawpumptech):** I could not view it, because x.com is unreachable from here. Not confirmed.
- Note: the `@clawpump/mcp` README links an older repo, `github.com/andy8052/clawpump`. Use the `Clawpump` org, not that one.

---

## Sources
- https://github.com/Clawpump (org); repos `agents-skills` (last commit Jun 30 2026), `ClawpumpSDK` (Apr 21 2026), `claw-agent` (Aug 28 2026), `claw-app`
- https://github.com/Clawpump/agents-skills/blob/main/skills/clawpump/SKILL.md
- https://github.com/Clawpump/agents-skills/tree/main/skills/rug-check
- https://github.com/Clawpump/ClawpumpSDK (README: presets, models, fees, tiers)
- https://www.npmjs.com/package/clawpump (CLI v0.13.1, Sep 4 2026: 65% creator fee, Robinhood Chain, pons, pools.trade)
- https://www.npmjs.com/package/@clawpump/agents (v0.1.27: 132 tools; code read)
- https://www.npmjs.com/package/@clawpump/mcp (v1.0.1: platform stats, leaderboard, x402 intelligence)
- https://www.npmjs.com/package/@clawpump/claw-agent
- https://clawpump.tech/ · https://www.clawpump.tech/docs · https://clawpump.tech/developers · https://clawpump.tech/analytics · https://clawpump.tech/marketplace · https://clawpump.tech/ansemhack (s)
- https://x.com/pumpspotlight/status/2033637904065388863 (Mar 16 2026, $250K Pump Fund)
- https://x.com/pumpspotlight/status/2061531276293603553 (Jun 1 2026, $73M / 2,700 agents)
- https://x.com/ConejoCapital/status/2091908156674711581 (Aug 24 2026, $125M→$150M)
- https://x.com/clawpumptech (pinned Oct 3 2026, $225M+; s)
- https://x.com/clawpumptech/status/2095250854362436046 (Sep 2 2026, RWA fee payouts)
- https://blog.colosseum.com/announcing-the-winners-of-the-solana-frontier-hackathon/ (Jun 26 2026)
- https://blog.colosseum.com/announcing-colosseums-accelerator-cohort-5/ · https://x.com/colosseum/status/2071666070436626613 (Jun 29 2026)
- https://solanacompass.com/news/colosseum-admits-21-startups-to-its-5th-accelerator-cohort-drawn-from-the-frontier-hackathon-and-eternal-sprint (USA + Argentina)
- https://www.youtube.com/watch?v=GDIZ-P0la3c (Cohort V Demo Day, ClawPump at 26:34)
- https://eleconomista.com.ar/finanzas/clawpump-nueva-economia-agentes-plataforma-solana-ya-proceso-us-170-millones-n98580 (Oct 2 2026)
- https://www.iproup.com/economia-digital/71693-startup-crea-agentes-de-ia-que-operan-con-cripto-y-ya-movieron-us180-millones (Sep 20 2026)
- https://coinfomania.com/clawpump-tech-crosses-200m-in-volume-on-solana-blockchain/ (Sep 22 2026)
- https://es-us.noticias.yahoo.com/hackatons-volumen-us-125-millones-130000223.html ($125M, 8,000 agents)
- https://ecosistemastartup.com/clawpump-la-startup-que-mueve-us180m-con-agentes-ia/
- https://solana.com/podcasts/the-index/episodes/19369763-solana-s-agentic-finance-future-with-bunny-of-clawpump
- https://pump.fun/coin/739dnZEG4yaBWFsY8L8ZwrfhGG6dhtCSercW8Umspump (CLAW token)
- https://github.com/trelnar/clawpump-products (third-party Gatekeeper skill)
- Note: clawpump.net, clawpumpsol.com and clawdpump.xyz are separate sites with different fee claims. Only clawpump.tech is linked from the official npm packages and GitHub org.
