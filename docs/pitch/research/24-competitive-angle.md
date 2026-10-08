# 24 — The competitive angle: positioning before layout (as of 2026-10-08)

**Scope.** This note picks the *argument* for the competition slide, not its layout. It applies April Dunford's method (*Obviously Awesome*) and a crypto Series A investor's read. It builds only on notes 01–06, 12 and 15–22, the short deck in the scratchpad (`slides/*.html` with their `<aside>` notes), `pitch-3min.md` and `SPEC.md`. I did no new web research. Every external figure inherits its tag from the note cited: most are **(s)**, from search snippets, so check them before print.

---

## 0. Diagnosis: eight layouts, one argument

The git history shows what the founder rejected (`af5411f`, `27969c3`, `3acdf51`, `fc392ad`, `13ad12a`, `f0adafc`). Every version's speaker note made the same claim:

> "Each owns a piece: Bankr the payment rails, Senpi a public arena, Nansen the data… None combines all four. Tocker does."

The layout went from checkmark grid to 2×2 to camps to market map to spotlight matrix. **The argument never changed.** The founder is rejecting the argument, and it fails for four reasons:

1. **It admits every piece already exists.** Bankr already ships two of the four columns, including USDC inference, which Tocker has only as "next" (note 22). "Each wins a column" says outright that each competitor beats Tocker at something.
2. **A bundle can be copied.** A VC hears "our moat is integration work." Any of the five can add a column. Note 17 §4: "Every rail Tocker uses is now a commodity."
3. **The columns are features the founder picked, not needs a buyer has.** The VC review said so directly: "'x402 data' is a feature you chose, not a buyer need" (`vc-review.md`).
4. **It makes the market look small.** The named peers are a $1.3M seed, a grant-funded project and a token-funded chat bot. Series A investors want to see a large spend that you will take over, not a race between small teams.

**What has to change:** the slide needs a *point of view about where value is decided* in agentic trading, with competitors placed by **the bet they made**, not by the boxes they fill.

---

## 1. Dunford step 1: competitive alternatives (what the customer would do without Tocker)

| What they'd do instead | Scale (source) | What it costs them | Tocker attribute that beats it |
|---|---|---|---|
| **Click it yourself** on a terminal or Telegram bot (Axiom, Photon, GMGN, Trojan) | $940M paid to Solana bots and terminals in 2025 (04); Axiom made $200M in 202 days (04) | ~1% a trade (05); human speed against ~21,000 launches a day (03); emotional exits (03) | Your rules run on every launch, 24/7, with exits in code |
| **Copy someone** (GMGN copy, Kolscan, fomo follows) | fomo: $75M Series B at a $550M valuation, 1.9M users (07, 08) | You're late, the leader gets front-run, and KOLs farm followers (07; Kolscan petition, 08) | Your own strategy; the record is public and the recipe stays private (SPEC rule 1) |
| **Build your own agent** (OpenClaw + Jupiter/Phantom MCP + data subscriptions + a VPS) | 13.7k+ skills; **341–1,184 malicious** (21) | 20+ services to wire (problem slide); ~$159/mo for data (12); "$200k+" agency quotes (18) | One hosted integration; data paid per call (7–11¢ a token, alpha slide) |
| **Chat agent** (Nansen AI, Bankr, Ask Gina) | Nansen: $500M+ traded, CEO claim (16) | You approve each trade (Nansen), or the model decides with no veto (16 §3) | Code vetoes a buy; autonomy is opt-in |
| **Venue agent** (Robinhood Agents, Binance AI Pro) | Robinhood: 150k+ agentic accounts (16) | Listed assets only, so none of the long tail (16 §3) | Any token that clears the gates (SPEC rule 2) |
| **Perps agent** (Senpi, Minara) | Minara: $2.63B cumulative volume (16) | Hyperliquid only; a different market | n/a (different market) |

**Weighted by money, the alternative is clicking it yourself ($940M), not Parasol.** Weighted by fundraising, it is Robinhood and Nansen. The agentic startups are evidence that the category exists. They are not where the money sits: n20 notes that no consumer on-chain agent app has raised a Series A.

## 2. Step 2: unique attributes (true today, checked against code)
- **No allowlist, a veto in code:** any Solana or Base token, 10 hard gates and a score floor before a buy (`score.ts:260-321`, `risk.ts:162`).
- **Paid alpha from many sellers:** 14 x402 registry sources, Nansen among them, bought per call (n22).
- **Any model:** BYO key today (Anthropic, OpenAI, OpenRouter); USDC per call is *next*.
- **Exits in code:** 6 rules every 5 minutes (n09).
- **A record that can't be edited, and a strategy nobody else sees:** the entry score is frozen onto each trade, every fill gets a receipt, and `AgentDetail.config` is `null` for non-owners (SPEC).
- **Not unique (don't pitch these):** plain-English strategy, model choice, an agent wallet, 24/7 hosting, autonomy (Tocker defaults to *approve*), and x402 as such (n16 §2).

## 3. Step 3: value and the proof behind it
- **The model doesn't decide the outcome:**
  - Benchmark rank vs trading return across 21 LLMs: Spearman **0.054** (LiveTradeBench, n21).
  - 4 of 6 frontier models lost 31–63% (Alpha Arena, n06).
  - 58% of 688 user-built agents lost money (Wallet V, n19).
- **The layer around the model does:**
  - DXRG ran **3,505 user-funded agents on Base memecoins** (~$20M volume). Changing the harness, not the model, **cut fabricated sell rules from 57% to 3%**. Its verdict: "reliability is an operating-layer property, not a model-only property" (n19, arXiv 2604.26091).
  - AMA: "architecture matters more than the model" (n21).
  - Aster: AI agents −4.5% vs humans −32%; **0 of 30 AIs liquidated vs 43% of humans** (n21).
- **Data per call beats subscriptions:** 7–11¢ for a token's due diligence vs ~$159/mo (n12).

## 4. Step 4: best-fit customer
- **The systematic long-tail trader.** They already trade Solana launches with rules (a liquidity floor, smart money, holder growth, TP/SL) and pay ~1% to a bot. They can't watch 21k launches a day, and they've been rugged. This person feels all three values: rules executed, rugs refused, cheaper.
- **Second, the growth engine: the creator with an audience.** They want a provable record without leaking the system (n08: "they hate copy-traders").
- **Not yet: developers building their own agents.** Tocker has no API, SDK or MCP (n17, checked in the repo).

## 5. Step 5: market category
- **"Infrastructure for agentic trading" holds only if "infrastructure" means the layer between any model and any market.** It does not hold as "an API others build on" (n17 §4, VC review). Shopify and Vercel call themselves infrastructure and are hosted products.
- **Category to claim on this slide:** *the operating layer for trading agents.* "Operating layer" is DXRG's own phrase, so the evidence names the category for us.

---

## 6. The three strongest angles

### Angle 1 (recommended): the edge lives in the layer, not the model
- **Thesis:** the field is racing on the model, but benchmarks show the model doesn't decide returns. Tocker rents the model and the data per call, and owns the layer that decides: what to know, what to refuse, when to exit, and the record that proves it.
- **Headline (39):** **The model isn't the edge. The layer is.** Alternative (35): *Rent the model. Own the discipline.*
- **On the slide:**
  - **Left, two hero numbers, one per clause of the headline:**
    - "ρ = 0.05": a model's benchmark rank vs its trading return, across 21 LLMs.
    - "57% → 3%": fabricated sell rules after DXRG fixed the harness, not the model, on 3,505 Base memecoin agents.
  - **Right, "Where they bet the edge lives".** Four quiet rows, each with names, one fact and the limit that bet sets:
    - **The model:** Fere AI ($1.3M seed, "self-improving") · Ask Gina. *Pick an LLM, describe a strategy: table stakes now* (n16).
    - **Their own data:** Nansen AI ($75M, Accel). *One vendor's view, and you approve every trade.*
    - **One venue:** Robinhood Agents (150k accounts) · Senpi ($4M seed). *Safe because the venue lists the assets, so no new launches.*
    - **The rails:** Bankr ($7M+ in wallets) · Coinbase. *A wallet that pays, with no view on what not to buy.*
    - **Tocker, highlighted:** *the layer.* Any model, USDC per call next · 14 data sellers per call · 10 gates and exits in code · every fill public, strategy private.
  - **Footer:** "Same bet, early: Parasol (grant-funded), ElizaOS auto-trader (beta)." Naming them first takes away the VC's "isn't Parasol the same?"
- **Proof:** LiveTradeBench, AMA, Aster, DXRG (n19, n21); "table stakes" (n16 §2); Nansen's "trust ladder", with autonomy still unshipped a year after its Q4 2025 target (n19); Bankr has no gates (n22).
- **Why a top VC believes it:**
  - It is a non-consensus thesis backed by outside, partly academic evidence, and DXRG's evidence comes from Tocker's own market (Base memecoins, natural-language strategies, agent wallets).
  - It explains why the incumbents' lead (distribution, model choice) is on the wrong variable.
  - It turns the founder's four edges into *one* architecture rather than four columns:
    - USDC inference: the model is a metered input.
    - x402: data is a metered input.
    - Gates and exits: the control.
    - Social: the proof.
  - It makes "infrastructure" honest.
- **Riskiest claim:** "the layer *is* the edge."
  - DXRG found **no directional edge** even after fixing the harness, and LiveTradeBench covers stocks and Polymarket, not memecoins.
  - **Defense:** the layer has two halves, information (paid data) and discipline (veto and exits). DXRG proves that the layer changes behavior 19×, and we never claim the model makes alpha.
  - **Second risk:** gates are copyable (Parasol, the Eliza plugin). **Defense:** the frozen-score record builds up over time, and the range of data sellers keeps growing.

### Angle 2: their products are our inputs (aggregation above commodity rails)
- **Thesis:** the "infrastructure for agentic trading" already exists and is commoditizing. Models, data, wallets and execution all sell per call. Value goes to whoever owns the agent, its operator and its record, and that business buys from all of them. The companies on the current slide are Tocker's *suppliers*.
- **Headline (30):** **Their products are our inputs.** Alternative (38): *They sell agents parts. We run agents.*
- **On the slide:**
  - **Bottom band, "bought per call":**
    - Models: Anthropic, OpenAI via BYO key; Bankr Gateway or BlockRun in USDC *next* (disclose the founder's role).
    - Data: Nansen $0.05, Plexa $0.05, SolEnrich $0.012, Deepnets $0.01, X $0.006.
    - Wallets: Privy (Stripe).
    - Execution: Jupiter, Base.
  - **Top: Tocker,** where the agents, the gates, the record and the followers live.
  - **Side, "closed loops":** Nansen AI (one data vendor), Robinhood and Senpi (one venue), Fere (one agent, sold by subscription).
- **Proof:**
  - Every layer has 2+ substitutes (n17 §4).
  - Pay-per-call data is standard: Nansen, CMC, CoinGecko, Birdeye, GoPlus at $0.002–0.05 (n21 D).
  - USDC inference already ships at Bankr, BlockRun and Dreams (n17 C, n21 E).
  - The money sits in rails (Turnkey $30M Series B, Catena $30M Series A, Kite $35M; n21), so suppliers are well funded and competing.
  - The x402 Foundation is backed by Visa, Stripe, Google and AWS (n06).
- **Why a VC believes it:**
  - It is aggregation theory.
  - It turns the VC's "commodity rails" critique into the thesis.
  - It fixes a live inconsistency: Nansen is a $0.05 *supplier* on the alpha slide and a *competitor* on the competition slide.
  - Founder–market fit shows, since the founder runs product at an x402 gateway.
- **Riskiest claim:** that Tocker is the aggregator.
  - It has no demand (no traction), and margins are negative today: ~$8.80 a day of data against ≤$2 a day of fees, with the platform paying for data (n05).
  - Nansen is a supplier and a competitor at once.
  - The peer startups don't fit the supplier frame.

### Angle 3: any token, public proof, private recipe (each rival is blocked by its business model)
- **Thesis:** Tocker rests on two rules from SPEC (no allowlist; strategy private), plus the record that joins them. Each funded rival is blocked from one of the three *by how it makes money*, not by a missing feature.
- **Headline (40):** **Any token. Public proof. Private recipe.**
- **On the slide:** three columns, each naming who can't follow and why:
  - **Any token:** Robinhood Agents (150k accounts) and Senpi/Minara (Hyperliquid). *Listing liability; one venue.* Tocker's 10 gates veto instead of a list (98.6% of launches collapse, n02).
  - **Public proof:** Nansen AI (you approve each trade, no record) and Robinhood (private feed). *No incentive to publish.* Tocker freezes the entry score on every fill.
  - **Private recipe:** fomo ($550M), GMGN, Senpi, Minara and Fere all copy trades. *Copying is their product.* Copy-trading front-runs the leader (n07).
- **Proof:** the venue axis (n16 §3); the copy-trading tax on the leader (n07); the Kolscan petition (n08); 59–91% of ERC-8004 reviewers are Sybil (n17); the Robinhood private feed (n17).
- **Why a VC believes it:** the defensibility is structural (business-model conflicts), the names are large (fomo, Robinhood), and the rules are authentic to the product.
- **Riskiest claim:** "they can't."
  - fomo could add a private mode, and Robinhood Chain could open the long tail (n17 §6).
  - "Public proof" is paper or demo data today.
  - It **repeats the GTM slide** that follows it ("never the strategy"), and x402 and USDC become secondary.

---

## 7. The five suggested candidates, scored

| Candidate | Verdict | Why |
|---|---|---|
| Status-quo alternatives ("click, pay 1%, or build") | **B−: keep it as the spoken frame, not the slide** | It is the correct Dunford frame (§1), but it repeats the business slide ($940M, 1%) and the problem slide (20+ services). VCs already rejected grading against Axiom and fomo (n17 preamble). The founder wants agents and startups. |
| Apps vs infrastructure | **D as worded** | False today: Tocker has no API, SDK or MCP (n17). It invites a Coinbase and Bankr comparison that Tocker loses. Kept honestly as Angle 2 (above the rails, not under other apps). |
| Trust layer (public record, private strategy) | **B+, but it belongs to GTM** | It is the real moat, but the GTM slide right after makes the same point. Network effects without a network are theoretical. Partly inside Angle 3. |
| Venue-locked vs open market | **B−** | True and structural, but it was the X axis of the rejected 2×2. It leans on incumbents and doesn't carry the founder's edges. Becomes column 1 of Angle 3. |
| Pay-per-use vs subscriptions/1% | **C** | x402 is plumbing, not a moat (n16, VC review). Senpi charges 5 bps (below 20), Robinhood is free, unit economics are negative, and it repeats the business slide. |

---

## 8. Recommendation: Angle 1, "The model isn't the edge. The layer is."

**Decisive rationale:**
1. **It is the only angle that replaces the rejected argument instead of re-laying it out.**
   - The rejected slides said "they have pieces, we have all of them."
   - Angle 1 says "they bet on the wrong variable; here is the evidence; we built the right one."
   - That is a thesis, and Series A money funds theses, not bundles.
2. **It is true today and proven by others.** The hero proof (DXRG: 3,505 agents, Base memecoins, "operating-layer property", 57% → 3%) comes from Tocker's own market. No other angle has outside evidence on that market.
3. **It carries all four of the founder's edges as one design rather than four checkmarks.**
   - Inference and data are rented per call because they are commodities: that is where USDC and x402 fit.
   - Gates and exits are owned because outcomes are decided there.
   - The record is public because it proves the layer works.
4. **It makes the cover line defensible.** "The infrastructure for agentic trading" means *the layer between any model and any market*, which is what Tocker is. It does not mean "an API", which Tocker isn't.
5. **It handles the hardest VC question (Robinhood, Nansen, Coinbase) without bravado.** Each is tied by its business to a different bet: venue, data or rails. Parasol, shown in the footer, proves the layer bet exists and is still small.
6. **It doesn't collide with the next slide.** GTM carries public record and private strategy. Angle 1 uses that idea in one line.

**Speaker note (≈55 words):**
> "Everyone in agentic trading is racing on the model. Wrong race: across twenty-one models, benchmark rank barely predicted returns. When DXRG ran thirty-five hundred agents on Base memecoins, fixing the layer, not the model, cut bad sell rules from fifty-seven percent to three. Others bet on a model, a dataset, a venue or rails. We rent those per call, and own the layer."

**Deck-level follow-through (not edited here):**
- The alpha slide's note opens with Alpha Arena ("Can AI even trade?"). Keep Alpha Arena there and use LiveTradeBench plus DXRG here, so no statistic appears twice.
- Q&A line for "isn't Parasol the same?": "Same bet, a grant and $19k of week-one volume. No paid data, no public record, Solana only."

**Verify before print (all (s)):**
- DXRG's 57% → 3% and the "operating-layer" quote: open arXiv 2604.26091.
- LiveTradeBench's ρ = 0.054: arXiv 2511.03628; covers US stocks and Polymarket, so say "across 21 models", not "in memecoins".
- Robinhood's 150k accounts; Nansen's "trust ladder" status; Bankr's $7M+.
