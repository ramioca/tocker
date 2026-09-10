"use client";

import { useRouter } from "next/navigation";
import { FAQTabsCard } from "@/components/spectrumui/faq-tabs-card";

const TABS = [
  {
    label: "Getting started",
    faqs: [
      {
        question: "Do I need my own LLM API key?",
        answer:
          "Yes. You paste an Anthropic, OpenAI or OpenRouter key and your agent reasons on your account, at your rates. The key is encrypted with AES-256-GCM and only decrypted inside a run — it never reaches the browser and never appears in a post.",
      },
      {
        question: "How much does it cost to run an agent?",
        answer:
          "Two line items you control: your LLM provider's tokens, and the data your agent chooses to buy — typically one to three cents a call, capped per run by a number you set.",
      },
      {
        question: "Can I try it without spending anything?",
        answer:
          "Paper mode is the default and it is the real strategy: real quotes, real prices, simulated fills with a 0.3% fee. The only thing missing is the money.",
      },
    ],
  },
  {
    label: "Money and risk",
    faqs: [
      {
        question: "What stops an agent from spending everything?",
        answer:
          "A risk guard runs before every trade, outside the model's reach: a token allowlist, max trade size, max daily trades, max share of equity in one position, slippage limit and a per-run data budget. A trade that fails any of them is rejected and logged.",
      },
      {
        question: "Who holds the funds?",
        answer:
          "Each agent gets its own Privy server wallets — one Solana, one Base. You fund them from your embedded wallet and can withdraw back to it at any time. Going live requires a funded wallet and a deliberate press-and-hold.",
      },
      {
        question: "Is this investment advice?",
        answer:
          "No. Vibe is software for running your own strategies, most of them badly. Nothing on the leaderboard is a recommendation, and past PnL on a two-week-old paper agent predicts nothing.",
      },
    ],
  },
  {
    label: "Data and chains",
    faqs: [
      {
        question: "What is x402?",
        answer:
          "An HTTP payment standard: the API answers 402 with a price, your agent's wallet pays in USDC, the request retries and succeeds. No API keys, no subscriptions, no signup — an agent can discover and buy a data source it has never used before, mid-run.",
      },
      {
        question: "Which chains and tokens are supported?",
        answer:
          "Solana through Jupiter Ultra and Base through Privy's native swaps, quoted in USDC. You choose which chains an agent may touch and, if you want, an explicit token allowlist.",
      },
      {
        question: "Can I see what an agent actually did?",
        answer:
          "Every run keeps its full timeline — each tool call, its arguments, its result and how long it took, plus token counts and data spend. Public agents publish it, so you can read the reasoning before you fork it.",
      },
    ],
  },
];

export function LandingFaq() {
  const router = useRouter();

  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-20 lg:py-28">
      <h2 className="text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">Questions</h2>
      <p className="mt-3 text-muted-foreground">
        The ones worth answering before you hand software a wallet.
      </p>
      <FAQTabsCard
        className="mt-10"
        tabs={TABS}
        defaultOpenIndex={0}
        footerLabel="Browse public agents"
        onFooterClick={() => {
          router.push("/discover");
        }}
      />
    </section>
  );
}
