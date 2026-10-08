# Fere AI (fereai.xyz): deep profile, verified Oct 8 2026

**Domain note.** The official domain is **fereai.xyz**: docs at docs.fereai.xyz, API at api.fereai.xyz, X @fere_ai. I found nothing tying **fere.ai** to the company, so don't put fere.ai on the slide.

**Method.** WebFetch and curl could not reach fereai.xyz or x.com. Web facts below come from search extracts, marked (s). I also read primary material directly from Fere's official GitHub org **`fere-ai`**, marked (p):
- `fere-docs-v4`, "Official Docs for fereai.xyz", including its full git history through Oct 6 2026
- `fere-skills`, last commit Sep 26 2026 by CTO Pranav Prakash
- `mcp-server`, `agentic-examples`, `.github`

Confidence labels: **V** = verified (primary or independent third party), **S** = self-reported, **NF** = not found.

> **Important change, Oct 6 2026.** Fere's docs were rewritten. The commit message: "The product is now a catalogue of agents that each run a fixed strategy, plus the MCP for research and trading from the user's own AI client". The same commit dropped the chat agent, the plain-English strategies, credits and subscriptions (p: fere-docs-v4 commit `8a065de`, PR #39). The live homepage matches: an agent catalogue, "0.5% per trade, 0.1% on perps", "free to use" (s). **Earlier notes that describe Fere as "describe a goal in plain English → self-improving agent" are out of date.**

---

## 1. What it is
**One sentence (current).** Fere AI offers a catalogue of ready-made trading agents. Each runs one fixed strategy built by Fere, many of them copy-trading top fomo traders and KOLs. You pick one, fund its Coinbase-secured wallet, and it trades 24/7. Its MCP server lets you research and trade from Claude, ChatGPT, Codex, Cursor and other clients (V, p: docs `index.mdx`, `agents.mdx`, `mcp.mdx`).

**Surfaces.**
- **Web app** at fereai.xyz/agents.
- **Hosted MCP server** at `https://api.fereai.xyz/mcp`, open to everyone, with OAuth.
- **Key-auth REST API** plus agent skills (`fere-skills`), for builders.
- Notifications by email or **Telegram**.
- History: a chat agent ("Ask Fere Anything"), which was retired Oct 6 2026. Its 0xMONK Telegram/agent API is archived.

## 2. Launch / stage
- **Live since at least Oct 2024** (V).
  - GitHub org `.github` repo created Sep 25 2024.
  - An @fere_ai X post on Oct 4 2024 announced a Copperx partnership.
  - A 0xMONK agent and its $MONK token on Base (via Virtuals) followed around Jan 2025.
- **Milestones:**
  - Coinbase Developer Platform case study, Aug 8 2025 (V).
  - EigenAI deterministic-inference case study, Oct 2025 (V).
  - Product Hunt launch on May 17 2026: **#2 Product of the Day, 495 upvotes** (V, hunted.space). Its docs also show PH badges for "#1 Product of the Month" in the Web3 and Fintech topics (p).
- **Status: live and public; free to sign up.** It pivoted to the agent catalogue plus MCP on Oct 6 2026 (V, p).
- **Location:** Singapore. The GlobeNewswire dateline and Crunchbase both say Singapore; Crunchbase lists 1–10 employees (s).
  - Founders: Akshaya Aron (co-founder and CEO) and Pranav Prakash (co-founder and CTO) (V, press release).
  - Doc commits are timestamped IST (+05:30), which suggests engineering is in India. That is my inference.

## 3. Funding
| Round | Amount | Lead | Others | Date | Confidence |
|---|---|---|---|---|---|
| Seed (Crunchbase calls it Seed; AlphaDrops calls it "undisclosed round") | **$1.3M** | **Ethereal Ventures** (founded by Joe Lubin) | Galaxy Vision Hill, Kosmos Ventures | **Apr 23 2026** | V (GlobeNewswire) |

- **Conflicts.** Crunchbase lists "Galaxy Digital" where the release says "Galaxy Vision Hill". Syndicated copies are dated Apr 22–30. Yellow.com wrongly says the backers were undisclosed.
- **No other disclosed round.** PitchBook says founded 2024.
- **Token.** $MONK ("0xMonk by Virtuals") on Base was Fere's agent token. CTO Pranav Prakash promoted it on Jan 16 2025. Its liquidity is now negligible. The amount raised through it is not found.

## 4. Traction (all self-reported; no on-chain or DefiLlama/Dune source found)
| Date | Figure | Source | Confidence |
|---|---|---|---|
| Aug 8 2025 | "5x growth in transaction throughput from agents" after moving to CDP Server Wallets | Coinbase CDP case study | S (vendor marketing) |
| Oct 2025 | 7,000+ daily users | EigenCloud blog (case study) | S |
| Apr 23 2026 | **10M+ "autonomous agent actions"** across ETH, SOL, Base, Arbitrum, BNB and Polymarket. "Actions" are not trades. | GlobeNewswire | S |
| May 17 2026 | **7,000+ daily users**; 10M+ autonomous executions; agents "live 90+ days straight" | Product Hunt maker comment | S |
| May 17 2026 | #2 Product of the Day, 495 upvotes, 60 comments | hunted.space / Product Hunt | V |
| Oct 2026 | Homepage agent cards: "Wide Net" avg 7-day peak **+2246% per call** (4 instances running); "Conviction Capital" avg peak +6.8% per call | fereai.xyz (s) | S. These are peak marketing numbers, not realized PnL. |

- **Volume, AUM, revenue, TVL:** NF.
- **Conflicts.** One third-party directory claims "millions of daily users", which conflicts with Fere's own 7,000.

## 5. Markets and chains
**Agent catalogue (Oct 2026).** Categories are memecoins, perps and blue chips (V, p).
- Copy-trading agents trade memecoins on **Solana, Base and Robinhood Chain** (s, homepage).
- A trend agent trades ETH, BTC and LINK on 4h EMA breakouts (s).
- Perps agents run on Hyperliquid (fee 0.1%) (p).

**MCP / API.**
- **Spot** swaps and bridges, gasless, on **Solana, Base, Robinhood Chain, Ethereum, Arbitrum, Polygon and BNB** (V, p: `fere-skills` `spot.md`).
- **Hyperliquid** perps and spot (p).
- **Polymarket**: 12 MCP tools, with its own Safe per agent (p).
- **Yield**: an Earn vault on Base, $100 minimum (p).
- Limit orders, plus server-side TP/SL hooks (p).

**Stocks.** None. Hyperliquid builder-dex stock perps (e.g. `xyz:NVDA`) are "unroutable" per Fere's own skill (p).

## 6. Business model
- **Current (from Oct 6 2026): a fee on each trade.** "0.5% of each trade (0.1% for perps agents), and nothing else" (V, p: docs `agents.mdx`; homepage, s).
  - Builders using the API measured an all-in cost of **57–70 bps per same-chain leg**. The skill says there is "no published fee schedule" for the API (p: `fere-skills` `SKILL.md`).
- **A referral fee-share program** with tiers is "coming in a few days" (p).
- **Before Oct 6 2026 (retired):**
  - **credits**: 200 free at signup; packs of $5 = 300, $10 = 650, $20 = 1,400; payable by card or any token on six chains;
  - **subscriptions**: Lite, Pro and Whale (1,100 / 4,200 / 16,000 credits a month);
  - on-chain swaps did not consume credits (p: deleted `credits.mdx` and `subscriptions.mdx` at commit `cb9e7c4`).
  - The API still meters `/v1/chat` at 15 credits per query (p).
- Earlier history: the $MONK agent token. An old IQ.wiki page cites 1% plus 5% of profits for a 2025 "Investment Agent" (s, outdated).

## 7. Autonomy
- **Catalogue agents: fully autonomous 24/7.** "No prompts, no code — it follows its strategy on its own."
  - **"Strategies are fixed … built and maintained by Fere — you can't change its logic."**
  - Users can tune only **amount per trade, leverage (perps), stop loss and take profit**. Some agents have no settings at all.
  - Users can stop or restart an agent, withdraw, and sell to cash (V, p: `agents.mdx`, `faq.mdx`).
  - KOLs and pro traders can ask Fere to deploy their strategy as an agent, by contacting the team (p).
- **MCP: chat-to-execute** from the user's own AI client (p).
- **Before Oct 6 2026:**
  - plain-English scheduled "Strategies", which carried context forward across runs (the "self-improving" claim);
  - a chat agent that "asks you to confirm before executing" simple trades (p, deleted `strategies.mdx` and `agent.mdx`).

## 8. The four columns
| Column | Mark | Evidence | URL |
|---|---|---|---|
| **Agent-paid inference** | **P** | Until Oct 6 2026, each agent query cost credits, priced dynamically by complexity. Credits could be bought with crypto on six chains, including via the agent tool `recharge_user_credits`, which bridges tokens to Fere's fee wallet as USDC on Base. The API still charges 15 credits per `/v1/chat` query. The consumer app has dropped credits for a flat trade fee, so inference is now bundled. MCP users bring their own AI (Claude, ChatGPT…). There is no x402 or USDC-per-call LLM payment and no BYO key into Fere's agent. | https://github.com/fere-ai/fere-docs-v4 (commit `cb9e7c4`: `credits.mdx`, `strategy-tools.mdx`) · https://github.com/fere-ai/fere-skills (`SKILL.md` §6) |
| **x402 alpha** | **N none found** | Data comes from platform-integrated providers paid by Fere: Codex trending, Exa, Firecrawl, GoPlus, RugCheck, Honeypot.is, Farcaster, X. There is no x402 anywhere in Fere's repos or docs history. A KuCoin brief lists "Fereai" among x402 *or* CDP-wallet users; that refers to CDP. | https://github.com/fere-ai/fere-docs-v4 (strategy-tools reference) |
| **Token filters & gates** | **P** | Fere's discovery tool `get_trending_coins` has "Safety Floor Filters (always enforced)": liquidity ≥ $100K, holders ≥ 50, 24h unique buys ≥ 30 and sells ≥ 10, "to prevent scam/honeypot tokens". Security tools exist but are optional: `contract_security_check_tool` (RugCheck/Honeypot.is) and `token_risk_analysis_tool` (GoPlus, top-10 holders, age). The API `security/check` is a separate call ("gate on status" is advice to builders). I found no veto enforced before a swap. Users can set TP/SL per agent. | https://github.com/fere-ai/fere-docs-v4 (commit `cb9e7c4` `strategy-tools.mdx`) · https://github.com/fere-ai/fere-skills (`reference/spot.md`) |
| **Social trading** | **Y** | Catalogue agents **copy-trade "30+ of the top fomo-leaderboard traders and KOLs"**: "Wide Net", "Hot Hand" (6 hot wallets) and "Conviction Capital" (a 19-wallet clan). Each agent page shows a **track record, recent trades and wins**. There is a **weekly points leaderboard**, top 30, ranked by on-chain volume, not PnL. KOLs can deploy strategies as agents. | https://www.fereai.xyz/ (s) · https://github.com/fere-ai/fere-docs-v4 (`agents.mdx`, `points.mdx`) |

## 9. Best at (≤6 words)
**Gasless multichain execution, Polymarket, Hyperliquid.** An alternative is "Pick-and-fund copy-trading agents."

## 10. Gap vs Tocker
Since Oct 2026, users can't write their own strategy, because Fere builds every agent and fixes its logic. It doesn't buy alpha per call, and its rug and honeypot checks are optional tools, not a veto before each buy.

## 11. One killer stat
- **Verified:** "**$1.3M seed led by Ethereal Ventures (Joe Lubin), Apr 23 2026**" (GlobeNewswire).
- **Best traction figure:** "**7,000+ daily users**". Self-reported in the Product Hunt maker post (May 17 2026) and the EigenCloud case study (Oct 2025). Label it "company-reported".

## 12. Logo
- **GitHub org: `fere-ai`** (Organization, id **171256938**). It is **official**:
  - Fere's docs config `docs.json` lists `https://github.com/fere-ai` under `organization.sameAs`;
  - the org's `.github` profile links fereai.xyz, docs.fereai.xyz and x.com/fere_ai;
  - it holds the official docs repo.
- **Avatar:** use the **ID URL**, https://avatars.githubusercontent.com/u/171256938?v=4 (200×200 PNG).
  - **The name-based URL (avatars.githubusercontent.com/fere-ai) returns GitHub's default grey Octocat**, which is why name lookups looked like a default identicon.
  - "FereAI" and "fereai" are not Fere's orgs.
- **Description:** a black square with a **white spiral of short rounded dashes** (pill-shaped strokes), arranged in concentric rings like a vortex or a sunflower seed head.
- **Official logo files** from docs.json are the same spiral mark:
  - light: https://storage.googleapis.com/fere-assets/logo/logo-light.webp (light-grey spiral on transparent)
  - dark: https://storage.googleapis.com/fere-assets/logo/logo-dark.webp (dark spiral)
  - Both are 160×160 and were downloaded and checked.
- **X avatar (@fere_ai):** I could not view it, because x.com is unreachable. Its display name is "Fere AI♠️". That the X avatar matches the spiral is likely but not confirmed.

---

## Sources
- https://github.com/fere-ai (org) · https://github.com/fere-ai/.github
- https://github.com/fere-ai/fere-docs-v4 (current docs; commit `8a065de`/PR #39 of Oct 6 2026, "reframe docs around agents and the Fere MCP"; pre-pivot state at `cb9e7c4`, Oct 2 2026)
- https://github.com/fere-ai/fere-docs-v4/pull/39
- https://github.com/fere-ai/fere-skills (Sep 26 2026; chains, Polymarket, Hyperliquid, costs, security check)
- https://github.com/fere-ai/mcp-server (archived 0xMONK MCP) · https://github.com/fere-ai/agentic-examples
- https://docs.fereai.xyz/ · https://docs.fereai.xyz/agents · https://docs.fereai.xyz/mcp · https://docs.fereai.xyz/points · https://docs.fereai.xyz/faq
- https://www.fereai.xyz/ (homepage: catalogue, fees, copy-trading agents; s)
- https://www.globenewswire.com/news-release/2026/04/23/3279629/0/en/fere-ai-raises-1-3m-to-put-a-self-improving-trading-agent-in-everyone-s-hands.html
- https://www.finsmes.com/2026/04/fere-ai-raises-1-3m-in-funding.html · https://www.crunchbase.com/organization/fereai · https://pitchbook.com/profiles/company/752596-39
- https://www.producthunt.com/products/fere-ai · https://hunted.space/dashboard/fere-ai (May 17 2026, #2, 495 upvotes)
- https://www.coinbase.com/developer-platform/discover/case-studies/fereai (Aug 8 2025)
- https://blog.eigencloud.xyz/how-fereai-uses-eigenai/ (Oct 2025, 7,000+ daily users)
- https://x.com/fere_ai · https://x.com/fere_ai/status/1842128623706513410 (Oct 4 2024) · https://x.com/xpranavprakash/status/1879931029324259585 (Jan 16 2025, $MONK)
- https://app.zerion.io/tokens/MONK-907d47f5-c753-45ec-803d-1a122b4cdf01/llms.txt ($MONK on Base)
- https://yellow.com/news/fere-ai-raises-1-3m-self-improving-trading-agent (conflicting "undisclosed backers")
