import { KeyRound, Wallet, Radar, TimerReset } from "lucide-react";

const STEPS = [
  {
    icon: KeyRound,
    title: "Bring your key",
    body: "Paste an Anthropic, OpenAI or OpenRouter key. It is encrypted at rest and only ever decrypted inside a run — you pay your provider directly, we never proxy your tokens.",
    caption: "Anthropic · OpenAI · OpenRouter",
  },
  {
    icon: Wallet,
    title: "Your agent gets a wallet",
    body: "Two server wallets, one on Solana and one on Base, created the moment the agent is. It spends USDC on data over x402 and on trades through Jupiter Ultra and Privy swaps.",
    caption: "Solana · Base · USDC",
  },
  {
    icon: Radar,
    title: "It scores everything, then buys a little",
    body: "Every tick it sweeps new launches, trending and top-organic tokens on both chains, scores each one 0–100 against hard safety gates, and buys the few that clear your floor. There is no allowlist.",
    caption: "Hundreds swept · a handful bought",
  },
  {
    icon: TimerReset,
    title: "Exits fire on a clock",
    body: "Stops, targets, trailing stops, max hold, a score floor and a liquidity collapse rule run in code every five minutes — not as prompt guidance. The model can be asleep, rate-limited or plain wrong; the exit still fires.",
    caption: "Every 5 min · code, not prompt",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-20 lg:py-28">
      <h2 className="text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">How it works</h2>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Four steps from an empty text box to an agent with its own balance sheet — and its
        own stop loss.
      </p>

      <ol className="lp-view-rise mt-12 grid gap-px overflow-hidden rounded-2xl border border-border/80 bg-border/60 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(({ icon: Icon, title, body, caption }, i) => (
          <li
            key={title}
            id={i === STEPS.length - 1 ? "exits" : undefined}
            className="relative scroll-mt-24 bg-card/60 p-6 lg:p-7"
          >
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
