## Why now

### Headline stats (pitch-ready)
- **Six frontier LLMs traded $10K each live; four lost 31–63%** — Nof1 Alpha Arena S1 (from Oct 17, 2025), as reported by Blockworks, Oct 2025, https://empire-blockworks.beehiiv.com/p/ai-trades-on-hyperliquid · med-high (secondary coverage; nof1.ai unreachable)
- **Visa, Mastercard, Stripe, Google, AWS co-founded the x402 Foundation** — Linux Foundation press release, Apr 2, 2026, https://www.linuxfoundation.org/press/linux-foundation-is-launching-the-x402-foundation-and-welcoming-the-contribution-of-the-x402-protocol · high (also confirmed: coinbase/x402 now lives at github.com/x402-foundation/x402)
- **Stripe-owned Privy: 75M accounts (Jun 2025) → 120M+ (2026)** — SiliconANGLE, Jun 11, 2025, https://siliconangle.com/2025/06/11/stripe-acquires-crypto-wallet-infrastructure-provider-privy/ ; Privy blog, 2026, https://privy.io/blog/privy-at-stripe-sessions-building-for-stablecoins-and-agentic-commerce · med
- **GPT-5 tokens cost ~11x less than GPT-4 at launch** — OpenAI list prices: GPT-4 $30/$60 per M in/out (Mar 14, 2023, https://openai.com/index/gpt-4-research/) vs GPT-5 $1.25/$10 (Aug 7, 2025, https://openai.com/index/introducing-gpt-5-for-developers/), cross-checked at https://github.com/simonw/llm-prices/blob/main/data/openai.json · high. Math (3:1 input:output blend): $37.50 → $3.44 per M = 10.9x.

### Supporting detail
**Agents trading in public.** Alpha Arena S1 final: Qwen3 Max +22.3%, DeepSeek V3.1 +4.9%, Claude Sonnet 4.5 −30.8%, Grok 4 −45.3%, Gemini 2.5 Pro −56.7%, GPT-5 −62.7%. Season 1.5 (US stocks, 8 models, ended Dec 3, 2025): only the "mystery model" Grok 4.20 finished positive, +12.1% ($4,844 on 4×$10K) — Forklog, Dec 2025, https://forklog.com/en/news/ai-model-grok-4-2-triumphs-in-trading-tournament. Takeaway: a raw LLM is not a strategy. Tocker's answer is hard gates, a score floor and exits in code.

**x402 went from experiment to standard in 11 months.**
- Coinbase launch, May 2025. Week of Oct 14–20, 2025: ~500K transactions, +10,780% vs 4 weeks earlier (Cointelegraph citing Dune, https://cointelegraph.com/news/coinbases-x402-transactions-rise-10000-percent).
- Google AP2 shipped with an A2A x402 extension; 60+ organisations (Sep 16, 2025, Decrypt, https://decrypt.co/339752/google-reveals-ai-agent-payments-protocol-coinbase-ethereum-foundation).
- Cloudflare + Coinbase announced the foundation (Sep 23, 2025, https://blog.cloudflare.com/x402/).
- Stripe "machine payments" preview on x402/Base (Feb 10, 2026, The Block, https://www.theblock.co/post/389352/stripe-adds-x402-integration-usdc-agent-payments).
- The Linux Foundation launch had about 40 members (Apr 2, 2026).
- AWS Bedrock AgentCore Payments preview uses x402 + USDC on Base, with agent wallets from Coinbase CDP or Stripe's Privy (May 7, 2026, https://aws.amazon.com/ru/about-aws/whats-new/2026/04/amazon-bedrock-agentcore-payments-preview/).
- Data sold per call: CoinMarketCap $0.01 (beta, https://coinmarketcap.com/api/x402/), CoinGecko $0.01 (Feb 2026), Nansen ~$0.01–$0.05 on Base and Solana (https://docs.nansen.ai/getting-started/agentic-payments/x402-payments). Tocker's SPEC.md registry prices cmc-quotes at $0.01 and nansen-smart-money at $0.05.

**Agent wallets.** Coinbase CDP Server Wallets v2 went GA Jul 24, 2025. Coinbase Agentic Wallets launched Feb 11, 2026 (https://cointelegraph.com/news/coinbase-launches-crypto-wallets-built-ai-agents). Privy ships an Agent CLI and `createX402Client`, which Tocker uses.

**Capability.** GPT-5 mini ($0.25/$2) is about 55x cheaper on the same blend. METR (Mar 2025, arXiv 2503.14499; not re-fetched): the length of task an agent can complete doubles about every 7 months.

**Gaps (unverified; search budget exhausted, data sites blocked):** retail AI-tool surveys, Recall Network, Alpha Arena viewership, Nof1's 2026 seasons, on-chain retail stats. Take these from Dune, DefiLlama or Artemis, or from the market-size brief.

### Suggested slide copy
1. "The rails for retail trading agents shipped in the last 12 months."
2. "Agents can now think cheaply, pay per call, and hold money."
3. "Everyone watched AI trade. Nobody gave it discipline."

Spoken: "Last fall six frontier AIs traded real money in public and four lost more than 30%. Within months Visa, Stripe, Google and AWS had standardised how agents pay, and frontier intelligence now costs a tenth of what it did in 2023. Tocker is the discipline layer on top."

### Caveats / what not to claim
- **Don't present raw x402 counts as commerce.** Coinbase claimed 100M+ payments in six months (The Block, Dec 2025, https://www.theblock.co/post/382284/coinbase-incubated-x402-payments-protocol-built-for-ais-rolls-out-v2), and a Major Matters tracker counted 200M+ by Jun 2026, but more than 95% of that is "protocol signaling" (Glenbrook, https://glenbrook.com/payments_news/the-x402-foundation-activated-a-27-year-old-internet-code-200-million-transactions-later-the-real-volume-is-still-tiny/). Visa's Cuy Sheffield puts adjusted cumulative volume at ~$19M as of Apr 21, 2026 (The Defiant, https://thedefiant.io/news/infrastructure/visa-s-sheffield-pegs-adjusted-x402-volume-at-19m). Say "backed by", not "volume".
- **Foundation date.** Use Apr 2, 2026 (Linux Foundation). One summary says "July 2026".
- **Alpha Arena.** One source dates Season 1's end to Dec 3, 2025, which is probably Season 1.5's; S1 ended early Nov 2025. It was a $10K, few-week test, so don't imply Tocker would have beaten it.
- **Definitions.** Privy counts "accounts", not agent wallets. Price ratios use list prices and a 3:1 input:output mix.
- **No partnership claims.** Visa, Stripe and AWS back the standard, not Tocker.
- **Agent tokens.** The 2024–25 boom (Virtuals, ai16z, AIXBT) crashed; AIXBT was ~82% off its high by Apr 2025 (Blockworks). Use only as contrast.
