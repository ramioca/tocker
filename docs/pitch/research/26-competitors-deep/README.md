# 26 · Competitors, deep research (Oct 8, 2026)

The six closest agentic-trading startups were researched in depth (funding, traction, markets, model, autonomy, the four slide columns with evidence, best-at, gap vs Tocker, official logos) and then fact-checked by a VC-critic pass. This folder supersedes research/22 (matrix) and research/25 (ClawPump).

Files: `clawpump.md`, `minara.md`, `senpi.md`, `fere-ai.md`, `ask-gina.md`, `heyelsa.md`. The slide generator is `docs/pitch/deck/build_competition.py`.

## Slide matrix

Columns, as defined on the slide:
- **x402 alpha:** the agent buys data per call. Selling x402 APIs does not count.
- **Gates:** a token-safety veto in code.
- **Social:** public trades, follow or copy; leaderboards only count as ◐.
- **USDC inference:** the agent pays for its own model in USDC.

Marks: ✓ shipped · ◐ partial · — not found.

| | Best at | Backing | Traction | x402 | Gates | Social | USDC inf. |
|---|---|---|---|---|---|---|---|
| **Tocker** | Paid alpha + hard gates, in public | — | Private beta | ✓ | ✓ | ✓ | next (BYO key) |
| ClawPump | Agent wallets + token launches | $250K Pump Fund (Mar 2026) · Colosseum C5 | $225M+ volume, self-reported, Oct 3 2026 | ✓ (opt-in, capped) | ◐ (opt-in rug skill) | ◐ (earnings leaderboard) | ✓ (USDC credits, UsePod) |
| Minara | AI CFO with perps autopilot | Circle Ventures (undisclosed) | $2.63B perps volume, DefiLlama all-time | ◐ (wallet pays for outside agents) | ◐ (forced TP/SL) | ✓ (copy agents, strategy marketplace) | ✓ (credits payable in USDC) |
| Senpi | Turnkey Hyperliquid strategies | $4M seed, Lemniscap (Sep 2025) | $410.7M perps volume, DefiLlama all-time | — | ◐ (risk limits in code, no token screen) | ✓ (copy traders) | — (card credits only) |
| Fere AI | Ready-made 24/7 trading agents | $1.3M seed, Ethereal (Apr 2026) | 7,000+ daily users, self-reported, May 2026 | — | ◐ (liquidity/holder floors in discovery) | ✓ (copies fomo traders, public track record) | ◐ (crypto credits until Oct 6; now bundled in fee) |
| Ask Gina | Polymarket automations in chat | Coinbase Ventures, Prelude (self-reported) | Not disclosed | — | ◐ (user stop-loss/kill rules) | ◐ (gated copy trading) | ◐ (credits bought in crypto; USDC unconfirmed) |
| HeyElsa | Chat-to-execute DeFi | $3M, M31 (Jun 2025) | 945K+ wallets, self-reported, Jan 2026 | — (sells x402 APIs) | ◐ (user limit/TP) | ◐ (volume leaderboard) | — |

## Caveats to know (kept off the slide)
- **Senpi:** a public repo contains a $5M-a-day "volume generation engine" (Apr 2026); it is unknown whether it ran. Volume also earns points. Agents Arena was retired Jul–Aug 2026.
- **Minara:** 30-day Hyperliquid volume fell ~92% between about June and August. Some of it probably moved to Lighter, which DefiLlama counts only from Sep 8.
- **ClawPump:** volume figures conflict ($120M on the dashboard, $170–180M in press, $225M+ on X) and none is audited. 99.6% of dashboard volume is spot.
- **Fere AI:** pivoted on Oct 6, 2026 to a catalogue of fixed-strategy agents. Plain-English strategies, the chat agent and credits were removed.
- **HeyElsa:** the ELSA token fell ~90% from its high, and ~46% of wallets in one airdrop campaign were inactive.
- **Access:** most company sites, x.com and defillama.com were unreachable from the research sandbox. Figures come from search extracts plus primary GitHub repos and npm packages, read directly. DefiLlama snapshots are undated extracts.
