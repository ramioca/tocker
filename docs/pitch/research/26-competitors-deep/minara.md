# Minara (minara.ai): deep research, as of Oct 8, 2026

**Confidence tags.** **(V)** verified: primary code or repo, on-chain data, or DefiLlama. **(S)** self-reported by Minara: PR, X, site or docs. **(3P)** third-party. **(NF)** not found.

**Access note.** minara.ai, defillama.com, x.com, prnewswire.com and kucoin.com were all unreachable (DNS failure). Hyperliquid and Lighter APIs were blocked by the proxy. GitHub was reachable, so I read:
- Minara-AI/minara-skills, cloned Sep 17 2026.
- Minara-AI/minara-cli (v0.4.7).
- DefiLlama's Minara adapter source.

DefiLlama page figures come from search-index extracts with no visible capture date. I estimated their dates from the fee arithmetic, as explained in §4.

---

## 1. What it is
**One sentence:** Minara is a consumer "personal AI CFO". It is a chat app for research and trading across crypto and tokenized stocks and commodities. Its **Autopilot** runs rules-based perp strategies on the user's Hyperliquid or Lighter wallet without per-trade approval.

**Product surfaces:**
- Web app.
- iOS and Android app. The developer of record is Lianereum Technologies Pte. Ltd., Singapore.
- Chrome extension.
- CLI (`npm i -g minara`).
- Agent skills for Claude Code, OpenClaw, Codex and Hermes.
- Strategy Studio (strategy.minara.ai): AI backtesting and Pine-based strategies.
- **Minara Harness** (Sep 2026): a multi-agent research and trading workspace.
- It **sells** a pay-per-call API over x402 (x402.minara.ai) plus an ERC-8004 agent.

Sources (V, S): [minara-skills](https://github.com/Minara-AI/minara-skills), [minara-cli](https://github.com/Minara-AI/minara-cli), [App Store](https://apps.apple.com/us/app/minara-ai/id6754446850), [X: API & ERC-8004](https://x.com/minara/status/2016897989428817924).

## 2. Launch / stage
- **Aug 14, 2025:** limited early-access beta, in a press release datelined **Singapore** (S, [PR Newswire](https://www.prnewswire.com/news-releases/minara-announces-limited-early-access-beta-launch-of-aipowered-virtual-cfo-for-digital-finance-302530341.html)).
- **Nov 25, 2025:** full public launch (S, [Minara blog](https://minara.ai/blog/minara-full-launch-ai-financial-assistant-for-intent-execution-and-digital-finance/)).
- **Dec 22, 2025:** start of DefiLlama's tracking of Minara's Hyperliquid builder code (V, [adapter](https://github.com/DefiLlama/dimension-adapters/blob/master/dexs/minaraai-perps.ts)).
- **~Jan 27, 2026:** **Trading Autopilot** launched, the same day Minara was #1 on Product Hunt (3P, [Phemex](https://phemex.com/news/article/minara-ai-tops-product-hunt-launches-ai-trading-autopilot-56249), [Bitget/BlockBeats](https://www.bitget.com/news/detail/12560605169682)).
- **Mar 5, 2026:** multiple perps wallets, each running its own Autopilot strategy (S, [X](https://x.com/minara/status/2029555010858819591)).
- **May 29, 2026:** Lighter added as a venue (3P search extract). DefiLlama tracks Lighter from May 22.
- **Sep 8–9, 2026:** **Minara Harness** launched: plain-English strategies become code and backtests, with multi-agent research, user-selectable LLMs, 24/7 trading "within user-authorized limits", and following other traders' strategies (S, [X](https://x.com/minara/status/2097413018510618899), KuCoin/BlockBeats).
- **Status:** live, consumer, global.
- **Team:**
  - Co-founder and CEO **Lowes Yang**. The team behind **NFTGo** built it, and its model research runs under "DMind".
  - **Location: Singapore.** Evidence: the PR dateline and the app publisher, a Singapore company registered 2021. StartupHub lists Tel Aviv, which is likely wrong.
  - Users are concentrated in Japan, Korea and North America (S, Feb 2026 sponsored PR).

## 3. Funding
| Round | Amount | Lead | Others | Date | Source |
|---|---|---|---|---|---|
| Early-stage VC | **Undisclosed** | Undisclosed | **Circle Ventures** (USDC issuer's venture arm); **SeaX Ventures** per PitchBook only | PitchBook deal dated Aug 1, 2025 | (S) PR: "backed by Circle Ventures"; (3P) [PitchBook](https://pitchbook.com/profiles/company/919676-44); Circle partner directory lists Minara ([partners.circle.com](https://partners.circle.com/partner/minaraai)) |

- No round size, lead or 2026 round found.
- Circle Ventures also backed NFTGo, the team's earlier company, in 2022 (3P).

## 4. Traction
**On-chain volume (DefiLlama "Minara AI Perps").** DefiLlama counts *taker notional routed with Minara's Hyperliquid builder code*. Lighter partner volume was added Sep 8, 2026.

| Snapshot | Cumulative perp vol | 30d vol | 7d / 24h vol | Cumulative fees (= revenue) | 30d fees | Estimated date* |
|---|---|---|---|---|---|---|
| A | **$2.404B** | **$449.3M** | $57M / $7.5M | $712,468 | $134,518 | ~mid/late Jun 2026 |
| B | **$2.628B** | **$35.19M** | $1.42M / $244,775 | $769,843 | $5,774 | ~early/mid Aug 2026 |

- Snapshot B's quarterly revenue: Q1 2026 ≈ $373K, Q2 2026 ≈ $388K, Q3 (partial) ≈ $7.9K. Both snapshots list Hyperliquid L1 only.
- \*Estimated date (my inference, not shown on the page):
  - Snapshot B's cumulative fees equal Q1 + Q2 + the partial Q3, and Q3 at ~$190 a day implies ~6 weeks into the quarter.
  - Snapshot A's cumulative fees sit ~$49K below the end-of-Q2 total, which at June's run rate implies ~11 days before Jun 30.
- **Read:**
  - Roughly $2.5B went through Minara's Hyperliquid builder code in H1 2026, about $760K of builder revenue.
  - Then Hyperliquid-routed 30-day volume fell **about 92%** ($449M → $35M) by ~August.
  - **Likely explanation (unconfirmed):** Minara added **Lighter** on May 29, 2026, and re-ran its 85 Autopilot templates on Lighter's lower fees. Volume may simply have moved venues.
  - DefiLlama began counting Lighter only on Sep 8, 2026, and I could not read the current combined figure.
- Realized builder rate ≈ 3.0 bps (snapshot A) and ≈ 1.6 bps (snapshot B), my arithmetic.

| Other metric | Figure | Date | Verified? |
|---|---|---|---|
| Total trading volume | "$200M+" | as of Feb 7, 2026 | S (sponsored PR on [news.bitcoin.com](https://news.bitcoin.com/minara-hosts-ai-x-web3-innovation-night-tokyo-showcasing-ai-native-finance-and-the-next-wave-of-stablecoin-adoption/)) |
| Peak single-day volume | "$41M" | Feb 2026 | S (same PR) |
| "Active traders" | "10K+" | Undated | S ([minara.ink](https://www.minara.ink/)) |
| Discord members | 10,000 | Jan 16, 2026 | S ([X](https://x.com/minara/status/2012147901385093353)) |
| Product Hunt | #1 product of the day | ~Jan 27, 2026 | 3P |
| GitHub | minara-skills 359★, minara-cli 71★ | Oct 2026 | V |
| Users / AUM / TVL | **NF** (no verified figure) | — | — |

**Conflict:**
- The self-reported "$200M+ total by Feb 7" is small next to DefiLlama's ~$1.2B implied for Q1 (from $373K of Q1 fees at ~3 bps).
- Either volume ramped sharply after Feb 7, or the two figures measure different things.

**Incentives:** a "Sparks" points program (subscriptions, trading, referrals) fuels airdrop speculation. **No token confirmed** (3P, [airdrops.io](https://airdrops.io/minara-ai/)). Treat volume as partly incentive-driven.

## 5. Markets and chains
- **Spot swaps** on ~18 chains: Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, **Solana**, BSC, Berachain, Blast, Manta, Mode, Sonic, Conflux, Merlin, Monad, XLayer.
- **Perps:** on **Hyperliquid**, including tokenized US stocks and commodities such as AAPL, TSLA, NVDA, gold and oil, and on **Lighter** (since May 2026).
- **Polymarket:** listed as a "network", but the skill uses it for **analysis only** (paste a market URL into chat). **Polymarket trading not found.**
- **Stocks:** the skills README claims "US and Korean stocks, futures, indices, commodities, forex". US names are via Hyperliquid markets; **Korean equities are unverified** (V for the claim text, NF for evidence).
- **Credit-card on-ramp:** MoonPay.

## 6. Business model
- **Subscriptions with credits.** CLI v0.4.7 snapshot, Apr 2026 (V, [premium.md](https://github.com/Minara-AI/minara-skills/blob/main/skills/minara/references/premium.md)):

  | Plan | Price | Credits / month |
  |---|---|---|
  | Free | $0 | 300 |
  | Lite | $19/mo | 1,400 |
  | Starter | $49/mo | 4,000 |
  | Pro | $199/mo | 20,000 |
  | Partner | $599/mo | 60,000 |

  - One-time credit packs: $19, $49, $89.
  - Payment by **Stripe or crypto (USDC)**.
  - Reviewers report different credit counts, so the table is a snapshot.
- **Builder fee** on Hyperliquid perps (realized ~1.6–3 bps per DefiLlama) and **partner fees** on Lighter. The exact rate is not published (NF).
- **Sells x402 pay-per-call API** access (x402.minara.ai), plus an API-key route.
- **Points:** Sparks.
- **Token:** none confirmed.

## 7. Autonomy
Three modes:
1. **Chat / Copilot.**
   - AI analysis plus a prefilled "Quick Order".
   - The user confirms each order.
2. **Autopilot.**
   - The user picks a curated strategy and a designated perps wallet.
   - The user authorizes assets and sets risk limits.
   - Every position opens with **mandatory TP/SL**, and stops trail as price moves.
   - An *optional* initial-equity drawdown stop flattens everything if hit.
   - The terms (Jun 18 2026) say it trades "without requiring your manual approval for each individual trade".
   - Manual orders on that wallet are blocked while Autopilot is on.
3. **Harness / workflows** (Sep 2026).
   - A plain-English idea becomes code and a backtest.
   - It runs 24/7 within user-authorized limits.
   - It can also build copy-trading bots, DCA plans and alerts.

**Custody:**
- Minara calls it "non-custodial" (an EIP-7702 / AA wallet with an exportable key), but **Minara generates and operates the signing key**.
- A product page says "built-in custodial wallet", so the wording is inconsistent.

Sources (S): [Autopilot docs](https://minara.ai/docs/trade/trading-autopilot), [product page](https://minara.ai/product/autopilot-trading), [terms PDF](https://minara.ai/doc/terms-of-use.pdf), [wallet security](https://minara.ai/docs/technology/wallet-security), [minara-cli README](https://github.com/Minara-AI/minara-cli).

## 8. The four columns
| Column | Mark | Evidence |
|---|---|---|
| **Agent-paid inference** | **Y (credits)** | Chat, research, trades and agent runs consume plan credits. Credits are bought by subscription or one-time packs, **payable in USDC or by card**. Harness lets users choose "supported LLMs". **No BYO key found; no per-call x402 inference.** (V: [premium.md](https://github.com/Minara-AI/minara-skills/blob/main/skills/minara/references/premium.md); S: Harness launch) |
| **x402 alpha** | **P (rail only)** | The Minara wallet can pay x402 APIs via its agent skill: parse the 402 headers, **the user confirms**, then `minara transfer` sends USDC. That makes it a payment rail for *external* agents. **No evidence that Minara's own research or Autopilot buys per-call data.** Separately, Minara **sells** x402 endpoints (does not count). (V: [transfer.md](https://github.com/Minara-AI/minara-skills/blob/main/skills/minara/references/transfer.md); S: [X](https://x.com/minara/status/2016897989428817924)) |
| **Token filters & gates** | **P** | Enforced in product: **mandatory TP/SL** on every Autopilot position, an optional equity-drawdown halt, and stop-bounded margin reservation (S, docs). Before a buy: only *prompt-level* scam-token warnings in its agent skill (canonical-address check, "known scam" warning). **No code-enforced honeypot, rug, liquidity or holder screen found.** (V: [SKILL.md](https://github.com/Minara-AI/minara-skills/blob/main/skills/minara/SKILL.md) §"Scam/fake token detection") |
| **Social trading** | **Y** | **Copy agents** mirror chosen wallets automatically, and wallets are scored on performance, influence and timing. A **strategy marketplace** shows others' track records. Harness lets users "follow strategies from other traders" with code and track record visible. (S: [wallet tracking & copy trade](https://minara.ai/why-minara/wallet-tracking-and-copy-trade), [strategies](https://minara.ai/why-minara/smart-trading-strategies), Harness coverage) |

## 9. Best at (≤6 words)
**"Retail AI CFO with real perps volume."** The supporting evidence: about $2.6B routed via its Hyperliquid builder code (DefiLlama), a consumer app with Product Hunt #1, and the broadest market menu among the agent apps.

## 10. Gap vs Tocker
It is a chat-first CFO with a rules-based perps Autopilot. Before a spot buy it applies only prompt-level warnings, with no enforced token gates. Its own agent doesn't buy per-call alpha, and its strategies are public in a marketplace rather than private behind a verified feed.

## 11. Killer stat
**$2.63B cumulative perps volume via Minara's Hyperliquid builder code.**
- Source: DefiLlama (https://defillama.com/protocol/minara-ai-perps), snapshot ≈ Aug 2026 and ≤ Sep 8 2026, read via search on Oct 8, 2026.
- Pair it with the honest footnote: 30-day Hyperliquid volume fell from ~$449M (~Jun 2026) to ~$35M (~Aug 2026) after Minara added Lighter, which DefiLlama has counted only since Sep 8, 2026.

## 12. Logo
- **Official GitHub org: `Minara-AI`.** GitHub is case-insensitive, so `minara-ai` is the same account.
  - The org page shows the website minara.ai, the X handle **@minara**, and the tagline "Run your own Wall Street. The AI-Native financial OS."
  - It holds the official minara-skills and minara-cli repos.
  - The npm package `minara` is maintained by **lowesyang** (the CEO) and `minara.agent`.
  - The skills install via ClawHub as `lowesyang/minara`.
  - **Confirmed official.**
- **Avatar:** https://avatars.githubusercontent.com/u/210831977?s=200&v=4
  - A black-and-white dithered (halftone pixel) illustration of a smiling young woman with round glasses and long dark wavy hair.
  - Opaque off-white background (#FAF9F5), 200×200 JPEG.
  - It is identical to `assets/Xneuro_Logo_Square.png` in minara-skills, and the same face appears inside the "MINARA" wordmark (`assets/minara.png`).
  - It works on a dark slide as a circle crop.
- **X (@minara) avatar: not verified.** x.com, pbs.twimg.com and unavatar were all blocked. The girl-with-glasses mark appears in every official asset, so the X avatar is *likely* the same, but this is unconfirmed.

## Sources
- https://github.com/Minara-AI (org page)
- https://github.com/Minara-AI/minara-skills (README; `skills/minara/SKILL.md`; `references/premium.md`, `transfer.md`, `examples.md`, `perps-autopilot.md`, `chat.md`)
- https://github.com/Minara-AI/minara-cli (README v0.4.7)
- https://github.com/DefiLlama/dimension-adapters/blob/master/dexs/minaraai-perps.ts (builder 0x5a3bc60b0a99a7f4fbf0d15554fa5fe88e7628c2; HL start 2025-12-22; Lighter account 724927, start 2026-05-22)
- https://github.com/DefiLlama/dimension-adapters/pull/9328 (Lighter tracking added Sep 8 2026)
- https://defillama.com/protocol/minara-ai-perps (figures via search extracts; page itself unreachable)
- https://www.prnewswire.com/news-releases/minara-announces-limited-early-access-beta-launch-of-aipowered-virtual-cfo-for-digital-finance-302530341.html
- https://minara.ai/blog/minara-full-launch-ai-financial-assistant-for-intent-execution-and-digital-finance/
- https://phemex.com/news/article/minara-ai-tops-product-hunt-launches-ai-trading-autopilot-56249 · https://www.bitget.com/news/detail/12560605169682
- https://www.kucoin.com/news/flash/minara-ai-launches-new-financial-ai-agent-minara-harness-for-24-7-investment-research-and-trading · https://x.com/minara/status/2097413018510618899
- https://x.com/minara/status/2016897989428817924 (Minara API & ERC-8004 agent, x402)
- https://x.com/minara/status/2029555010858819591 (multi-wallet Autopilot)
- https://x.com/minara/status/2012147901385093353 (Discord 10K)
- https://minara.ai/docs/trade/trading-autopilot · https://minara.ai/product/autopilot-trading · https://minara.ai/doc/terms-of-use.pdf · https://minara.ai/docs/technology/wallet-security
- https://minara.ai/why-minara/wallet-tracking-and-copy-trade · https://minara.ai/why-minara/smart-trading-strategies · https://minara.ai/pricing
- https://pitchbook.com/profiles/company/919676-44 · https://partners.circle.com/partner/minaraai
- https://news.bitcoin.com/minara-hosts-ai-x-web3-innovation-night-tokyo-showcasing-ai-native-finance-and-the-next-wave-of-stablecoin-adoption/ (sponsored)
- https://apps.apple.com/us/app/minara-ai/id6754446850 · https://play.google.com/store/apps/details?id=com.byterum.minara
- https://airdrops.io/minara-ai/ (3P, Sparks) · https://makerstack.co/reviews/minara-review/ (3P)
- https://registry.npmjs.org/minara (maintainers)
