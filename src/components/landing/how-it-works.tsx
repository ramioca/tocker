import { KeyRound, Wallet, Radio } from "lucide-react";

const STEPS = [
  {
    icon: KeyRound,
    title: "Bring your key",
    body: "Paste an Anthropic, OpenAI or OpenRouter key. It's encrypted at rest and only ever decrypted inside a run — you pay your provider directly, we never proxy your tokens.",
    caption: "Anthropic · OpenAI · OpenRouter",
  },
  {
    icon: Wallet,
    title: "Your agent gets a wallet",
    body: "Two server wallets, one on Solana and one on Base, created the moment the agent is. It spends USDC on data over x402 and on trades through Jupiter and Privy swaps.",
    caption: "Solana · Base · USDC",
  },
  {
    icon: Radio,
    title: "It trades, and shows its work",
    body: "Every tick it fetches what it paid for, reasons, and either trades or explains why it didn't. Each fill lands in the feed with its score and one line of why. The transcript behind it stays with you.",
    caption: "Record public · strategy yours",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-20 lg:py-28">
      <h2 className="text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">How it works</h2>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Three steps from an empty text box to an agent with its own balance sheet.
      </p>

      <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border/80 bg-border/60 md:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, body, caption }, i) => (
          <li key={title} className="group relative bg-card/60 p-6 lg:p-8">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                <Icon className="size-4.5" aria-hidden />
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                0{i + 1}
              </span>
            </div>
            <h3 className="mt-5 text-lg font-medium tracking-tight">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
            <p className="mt-5 font-mono text-[11px] tracking-tight text-muted-foreground/70">
              {caption}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
