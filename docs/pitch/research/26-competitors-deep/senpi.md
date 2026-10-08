# Senpi (senpi.ai): deep research, as of Oct 8, 2026

**Confidence tags.** **(V)** verified: primary code or repo, on-chain data, or DefiLlama. **(S)** self-reported by Senpi: PR, X, site or docs. **(3P)** third-party write-up. **(NF)** not found.

**Access note.** senpi.ai, resources.senpi.ai, open.senpi.ai, x.com, defillama.com and api.hyperliquid.xyz were all unreachable (DNS failure or proxy 403). GitHub was reachable, so I read Senpi's public repos directly:
- Senpi-ai/senpi-skills, cloned at commit db7772b, Oct 7 2026.
- Senpi-ai/senpi-plugin.
- Senpi-ai/turbine.
- Senpi-ai/.github.

I also read DefiLlama's adapter source. DefiLlama page figures come from search-index extracts with no visible capture date.

---

## 1. What it is
**One sentence:** Senpi is a hosted AI "quant engineer" for Hyperliquid. You describe a thesis in plain English, or pick one of 80+ open-source templates. Senpi turns it into a strategy and runs it 24/7 on its own funded sub-wallet, with deterministic sizing, risk gates and trailing-stop exits.

**Product surfaces:**
- iOS and Android app. Android is in the 10K+ downloads tier.
- Web app (senpi.ai).
- A Telegram chat agent. The Feb 2026 launch ran on OpenClaw.
- A hosted Senpi MCP. The README says 62 tools; the learn page says 58.
- An open-source skills repo (MIT).
- A plugin that connects Claude, ChatGPT, Codex, Cursor, Grok and Hermes to your Senpi agent (Oct 2026).

Sources (V, S): [senpi-skills README](https://github.com/Senpi-ai/senpi-skills), [senpi-plugin](https://github.com/Senpi-ai/senpi-plugin), [Google Play](https://play.google.com/store/apps/details?id=app.senpi.ai), [Chainwire PR](https://chainwire.org/2026/02/24/senpi-launches-the-first-personal-trading-agents-for-hyperliquid/).

## 2. Launch / stage
- **2025:** launched as an "AI wallet" on Base. The team previously worked at Airstack; the GitHub org README still links moxie.xyz. Coverage at the Sep 2025 raise said Senpi had done 250K+ automated trades in its first ~4 months (S, [TFN](https://techfundingnews.com/senpi-ai-powered-crypto-wallet-raises-4m/)).
- **Hyperliquid:** DefiLlama tracks Senpi's builder code from **Nov 10, 2025** (V, [DefiLlama adapter factory/hyperliquid.ts](https://github.com/DefiLlama/dimension-adapters/blob/master/factory/hyperliquid.ts)). Senpi says its "Hyperliquid infrastructure has been live since January 2026" (S).
- **Feb 24, 2026:** launched "personal trading agents for Hyperliquid" on OpenClaw, with Telegram chat (S, Chainwire).
- **Senpi 2.0 / "Samurai":** a Hyperliquid-tuned model plus the "AI Harness". The CEO set a Jul 7, 2026 launch and cited an 11,708-person waitlist. On Jul 9 the README was rewritten for the Harness. **The exact go-live date is not confirmed** (S, [CEO X](https://x.com/betashop/status/2071668585357783133), repo commit e08fb0c7).
- **Sep 18, 2026:** "Senpi Signals" launched, a 0–100 scored market sweep (S, [X](https://x.com/senpi_ai/status/2102135120908242981)).
- **Status:** live, and in very active development (~25 days with commits in Sep 2026).
- **Team:**
  - CEO Jason Goldberg (@betashop), CTO Sarvesh Jain, COO Ignas Peciura. The three previously worked at Airstack.
  - Location: Miami per [Refresh Miami](https://refreshmiami.com/news/senpi-lands-4m-to-make-your-crypto-wallet-to-trade-smarter-than-you/); Tracxn says Los Angeles (conflict).

## 3. Funding
| Round | Amount | Lead | Others | Date | Source |
|---|---|---|---|---|---|
| Seed | **$4M** | **Lemniscap** | Coinbase Ventures' Base Ecosystem Fund, SuperLayer, Primal Capital, Auros, Mana, angels | Sep 16, 2025 | CEO post (S, [X](https://x.com/betashop/status/1967941933600215106)); DefiLlama raises, CoinCarp and VCBacked all say $4M (3P) |

- Some outlets (PANews, KuCoin) say "co-led by Lemniscap and Coinbase Ventures". The CEO's own post says "led by Lemniscap with Coinbase Ventures' Base Ecosystem Fund". **Use "led by Lemniscap".**
- No source supports the $4.4M or $4.5M figures in earlier Tocker notes. **No 2026 round found.**
- The README footer says "Backed by Lemniscap and Coinbase Ventures" (V).

## 4. Traction
| Metric | Figure | Date | Verified? |
|---|---|---|---|
| Cumulative perp volume via Senpi's builder code (DefiLlama "Senpi Perps") | **$410.66M** | Undated snapshot, retrieved Oct 8 2026 | **V (on-chain builder fills via DefiLlama)**, read from a search extract because the live page was blocked |
| 30d / 7d / 24h perp volume (same snapshot) | $13.57M / $9.82M / $171.5K | same | V (same caveat) |
| Cumulative builder-fee revenue (same snapshot) | **$170,707**; 30d $5,295; "annualized" $217K | same | V. $170.7K ÷ $410.7M ≈ 4.2 bps, consistent with the 5 bps builder fee |
| ">$100M trading volume" | — | Feb 24 2026 | S (PR) |
| "$185M, 88% from autonomous agents" | — | ~Mar 2026 | 3P ([Emelia](https://emelia.io/hub/senpi-openclaw-trading)), unverified |
| Agents Arena notional | "$30M+" | README (Arena since retired) | S |
| Strategy templates | 80+ (74 advanced, 13 starter) | Oct 2026 | V (repo) |
| Registered traders (OpenSenpi) | "27,832+" | Undated | S |
| Samurai waitlist | 11,708 | ~Jul 2026 | S (CEO X) |
| Android downloads | 10K+ tier; 4.6★ from 43 reviews | 2026 | 3P (Play Store) |
| "40% user win rate per HyperTracker" | — | Feb 2026 | S, unverified |
| AUM / TVL | **NF** | — | — |

**Diligence flags (important for honest framing):**
1. **Volume is points-incentivized.** Points were 2 per $1 of perps volume in Season 2 (Feb 1–Sep 30, 2026), and plans now earn 1–3 points per $1 (S, [points page](https://senpi.ai/points); repo `senpi-account-status`). There is airdrop speculation, but no confirmed token.
2. **A self-volume engine exists in Senpi's public GitHub org.**
   - [Senpi-ai/turbine](https://github.com/Senpi-ai/turbine) holds 2 commits by Jason Goldberg, dated Apr 10, 2026, headed "PRIVATE — Internal use only".
   - It describes a **"Volume Generation Engine"**: alternating $50K BTC long/short round-trips (50 per day, maker orders, 15-minute cooldowns).
   - Its stated goal is to "Generate $5M/day in volume while losing at most $200/day after builder fee revenue offsets HL fees and trading losses."
   - **I found no evidence of whether, or for how long, it ran.** Treat Senpi's volume, including the DefiLlama figure, as possibly containing self-generated flow. Do not use it as an organic-demand stat without a caveat.
3. **Data gap.** Since ~Sep 15 2026, Hyperliquid's daily builder-fill files stop at ~12:00 UTC, and the PR's author saw this in Senpi's own file. Recent DefiLlama days may be under-counted (V, [DefiLlama PR #9823](https://github.com/DefiLlama/dimension-adapters/pull/9823)).
4. **The "Agents Arena" is retired.**
   - Paused Jul 23, 2026 (commit c7b5ce7e: "The Arena is paused").
   - Its MCP tools were removed by Aug 17, 2026 (commit 57972fad: "The Agents Arena is deprecated … arena_leaderboard / arena_pool / arena_prizes … removed").
   - Its last dependent strategy was retired Sep 15, 2026 (commit 30071ed6).
   - **Do not cite the Arena as a live feature.**

## 5. Markets and chains
- **Hyperliquid perps only.** The learn page (Aug 2026) says ~340 contracts: 232 crypto perps plus 108 equity, metals, index and FX perps on the XYZ DEX (HIP-3). Counts conflict: the capabilities page says 287, the README "~230 + ~95" (S).
- Leverage is 1–10× in the templates.
- **Spot:** no spot trading product.
- **Solana / Base trading:** none in 2026. Base was the 2025 wallet product.
- **Polymarket:** none found.
- **Stocks:** perps only, via HIP-3 XYZ markets; no stock tokens.
- **Deposits:** USDC from any supported network, or card.

## 6. Business model
- **Builder fee on every Hyperliquid fill.** It starts at **0.05% (5 bps)** and falls with loyalty tier: Silver 0.047%, Gold 0.045%, Platinum 0.04%, Diamond 0.035%, Apex 0.03%, Legend 0.025% (V, repo `senpi-improve-trades/SKILL.md`). This is consistent with DefiLlama's ≈4.2 bps realized.
- **AI-credit subscriptions** (billed via Stripe, web only, per 30-day cycle), published Sep 17 2026 (V, repo `senpi-account-status/SKILL.md`):

  | Plan | Price | AI credit |
  |---|---|---|
  | Starter | $25 | $25 |
  | Pro | $50 | $50 |
  | Advanced | $100 | $130 |
  | Quant | $200 | $270 |

  - "$1 of credit = $1 of AI usage."
  - There is a 14-day trial, and up to $315 of free-credit milestones.
- **Referrals:** referrers earn 25% of the builder fee on referred trades (V, repo).
- **Token:** none confirmed; points program only.

## 7. Autonomy
**Fully autonomous once deployed.**
- **What the user does:**
  - States a thesis in chat, or picks a template.
  - Sets the budget, assets, leverage and risk config.
  - Confirms the deploy.
  - Each strategy gets its own funded sub-wallet.
- **Who decides what:**
  - The scanner proposes signals every N seconds.
  - The `@senpi-ai/runtime` supervisor owns sizing, execution, risk guard rails and the two-phase "DSL" trailing-stop exits.
  - "Nothing in this repo places an order directly."
  - The runtime ticks without a model call, unless `decision_mode: llm` is set.
- **Copy and mirror:** strategies that follow chosen Hyperliquid traders also exist.
- **Custody:** Senpi calls itself non-custodial: an embedded wallet plus isolated strategy sub-wallets on Privy, with exportable keys (S, [terms](https://senpi.ai/terms) via search). Senpi operates the signer.

Sources (V): [README](https://github.com/Senpi-ai/senpi-skills), `senpi-trading-runtime/SKILL.md`.

## 8. The four columns
| Column | Mark | Evidence |
|---|---|---|
| **Agent-paid inference** | **Y (credits)** | Chat and tool turns are metered against prepaid AI credits ("$1 of credit = $1 of AI usage"); "every plan includes every model". Paid by card via Stripe, **not USDC/x402, not BYO key**. (V, [senpi-account-status/SKILL.md](https://github.com/Senpi-ai/senpi-skills/blob/main/senpi-account-status/SKILL.md)) |
| **x402 alpha** | **N** | No x402 mention in the 963-file skills repo or in any search. Data comes from Senpi's own MCP (leaderboard, smart-money, market tools). (V, repo grep; NF in search) |
| **Token filters & gates** | **P** | The runtime enforces *portfolio risk gates* before every entry:<br>• margin, notional and leverage caps<br>• daily-loss halt and drawdown breaker<br>• max entries per day and loss cooldowns<br>• `asset_banned`<br>Every rejection is logged with a reason code. Exits are enforced by the DSL. **No token-safety screening (rug, honeypot, holders)**, which is moot because it trades only listed Hyperliquid perps. (V, README "risk engine") |
| **Social trading** | **Y** | One-tap copy of top Hyperliquid traders, a "Hyperfeed" of top traders, trader discovery with track records, and 9 copy-trading templates (S/V: [learn page](https://resources.senpi.ai/learn/what-is-senpi), repo). **The public Agents Arena leaderboard was paused Jul 23 2026 and retired by Aug 17 2026** (V, commits). |

## 9. Best at (≤6 words)
**"Turnkey autonomous Hyperliquid perps strategies."** The supporting evidence: a deterministic runtime, two-phase trailing exits, 80+ open strategies, an MIT skills repo, and a mobile app.

## 10. Gap vs Tocker
It trades only Hyperliquid's listed perps. It has no on-chain spot, no long-tail Solana/Base tokens, no pre-buy token-safety gates (unneeded on listed perps) and no per-call paid data. Its public agent leaderboard has been retired.

## 11. Killer stat
**$410.7M cumulative Hyperliquid perps volume, earning $170.7K in builder fees.**
- Source: DefiLlama "Senpi Perps" (https://defillama.com/protocol/senpi-perps), an undated snapshot retrieved via search on Oct 8, 2026.
- Footnote it: points-incentivized, and Senpi's GitHub holds a volume-generation script (Apr 2026). Its use was not verified.
- Safer alternative: "**$4M seed led by Lemniscap** (Sep 16, 2025)".

## 12. Logo
- **Official GitHub org: `Senpi-ai`.** GitHub is case-insensitive, so `senpi-ai` is the same account.
  - The org page links senpi.ai and x.com/senpi_ai.
  - It holds the real repos: senpi-skills (134★), senpi-plugin, turbine, and a Hyperliquid Railway template.
  - Commits are by CEO Jason Goldberg and CTO Sarvesh Jain.
  - The npm package `@senpi-ai/runtime` is maintained by 0xsarvesh and ipeciura (the CTO and COO).
  - The Feb 2026 PR links github.com/Senpi-ai/senpi-skills. **Confirmed official.**
- **Avatar:** https://avatars.githubusercontent.com/u/207923805?s=200&v=4
  - A black-and-white halftone illustration of a young masked ninja or samurai character: a cloth mask over the nose and mouth, short hair with a small ponytail, and a kimono collar.
  - **The PNG has a transparent background** (RGBA, corners alpha 0). It shows as dark line art on white, and looks like a "dark masked character on near-black" when viewed in dark mode.
  - On a dark slide it will almost disappear, so put it on a light circular plate.
  - Senpi's own plate variants: `Senpi-ai/senpi-plugin/assets/senpi-logo-plate-dark.png` (512×512, character inside a white circle on #2E2E2E) and `senpi-logo-plate.png` (on white).
- **X (@senpi_ai) avatar: not verified.** x.com, pbs.twimg.com and unavatar were all blocked. The same masked character appears in every official repo asset, so the X avatar is *likely* the same, but this is unconfirmed.

## Sources
- https://github.com/Senpi-ai (org page: website, X link, repos)
- https://github.com/Senpi-ai/senpi-skills (README, `senpi-account-status/SKILL.md`, `senpi-improve-trades/SKILL.md`, `senpi-why/references/overview-positioning.md`, commits c7b5ce7e, 57972fad, 30071ed6, e08fb0c7)
- https://github.com/Senpi-ai/turbine (README and `scripts/turbine-engine.py`, commits 6dc0398 and 503bb19, Apr 10 2026)
- https://github.com/Senpi-ai/senpi-plugin
- https://github.com/DefiLlama/dimension-adapters/blob/master/factory/hyperliquid.ts (`senpi-perps`, builder 0x1368f4311db5807f7c7924d736adaeb83e47bafe, start 2025-11-10)
- https://github.com/DefiLlama/dimension-adapters/pull/9823
- https://defillama.com/protocol/senpi-perps (figures via search extract; page itself unreachable)
- https://chainwire.org/2026/02/24/senpi-launches-the-first-personal-trading-agents-for-hyperliquid/
- https://thedefiant.io/news/press-releases/senpi-launches-the-first-personal-trading-agents-for-hyperliquid
- https://x.com/betashop/status/1967941933600215106 (seed announcement)
- https://x.com/betashop/status/2071668585357783133 (Samurai launch / waitlist)
- https://x.com/senpi_ai/status/2102135120908242981 (Signals)
- https://techfundingnews.com/senpi-ai-powered-crypto-wallet-raises-4m/
- https://refreshmiami.com/news/senpi-lands-4m-to-make-your-crypto-wallet-to-trade-smarter-than-you/
- https://www.coincarp.com/fundraising/senpi-seed/ · https://defillama.com/raises/lemniscap
- https://resources.senpi.ai/learn/what-is-senpi · https://senpi.ai/terms · https://senpi.ai/points · https://senpi.ai/capabilities
- https://play.google.com/store/apps/details?id=app.senpi.ai
- https://emelia.io/hub/senpi-openclaw-trading (3P)
- https://www.bitrue.com/blog/what-is-hyperliquid-agents-arena-senpi-ai (3P, Arena prize structure)
- https://registry.npmjs.org/@senpi-ai%2fruntime (maintainers)
