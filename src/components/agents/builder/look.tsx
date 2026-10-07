import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The builder's look: one type scale, the silk, the choice-card frame and four small
 * presentational pieces. Class names are whole literals so Tailwind sees them.
 * Nothing here reads or writes the draft.
 */

/** One role per text node; no ad-hoc sizes beside these. */
export const TYPE = {
  display:
    "text-[20px] leading-6 font-semibold tracking-[-0.015em] sm:text-2xl sm:leading-7 sm:tracking-[-0.02em]",
  title: "text-base leading-5 font-semibold tracking-[-0.01em]",
  heading: "text-sm leading-5 font-semibold",
  body: "text-sm leading-[22px] text-muted-foreground",
  small: "text-[13px] leading-5",
  caption: "tnum text-xs leading-[18px]",
  kicker: "tnum font-mono text-[11px] leading-4 tracking-[0.12em] text-muted-foreground uppercase",
} as const;

/** The silk, at the stops the login card's edge uses. Marks only, never behind text. */
export const SILK_STOPS = ["#3d6bff", "#7a5cff", "#ff3dcb"] as const;
export const SILK = "bg-[linear-gradient(90deg,#3d6bff_0%,#7a5cff_52%,#ff3dcb_100%)]";
export const SILK_V = "bg-[linear-gradient(180deg,#3d6bff_0%,#7a5cff_52%,#ff3dcb_100%)]";
/** A 1px line that fades out at both ends: the agent card's top edge. */
export const SILK_EDGE =
  "bg-[linear-gradient(90deg,transparent,#3d6bff_18%,#7a5cff_50%,#ff3dcb_82%,transparent)]";

export const EASE = "ease-[var(--ease-out-strong)]";
export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const FOCUS_OFFSET = "focus-visible:ring-offset-2 focus-visible:ring-offset-background";
export const HAIR = "border-white/[0.07]";

/** The frame every choice card in the builder's own files shares (presets, Custom, funding). */
export const CHOICE_CARD =
  "group relative flex flex-col gap-3 rounded-xl border p-4 text-left " +
  "transition-[border-color,background-color,scale] duration-150 ease-[var(--ease-out-strong)] " +
  "active:scale-[0.98] motion-reduce:active:scale-100 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-background";
export const CHOICE_OFF = "border-white/[0.09] bg-card/40 hover:border-white/[0.18] hover:bg-card/70";
export const CHOICE_ON =
  "border-primary/70 bg-[color-mix(in_oklch,var(--primary)_9%,var(--card))] " +
  "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.07),0_0_0_3px_rgb(122_92_255/0.12)]";

export type Tone = "violet" | "pink" | "blue" | "cyan" | "plain";
const TONES: Record<Tone, string> = {
  violet: "bg-[#7a5cff]/15 text-[#c4b5fd]",
  pink: "bg-[#ff3dcb]/[0.13] text-[#ff8fdf]",
  blue: "bg-[#3d6bff]/[0.18] text-[#9db0ff]",
  cyan: "bg-[#3fd2ff]/[0.12] text-[#9be7ff]",
  plain: "bg-white/[0.05] text-muted-foreground",
};

/** A 32px tile holding one 16px icon. Decorative: the label beside it says what it is. */
export function IconTile({
  tone = "plain",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden
      className={cn("grid size-8 shrink-0 place-items-center rounded-lg [&>svg]:size-4", TONES[tone], className)}
    >
      {children}
    </span>
  );
}

/**
 * On or off, by shape as well as colour: a filled disc with a tick, or an empty ring
 * (`ring`, a choice not taken) or a dashed ring (`dashed`, a thing still to do). The tick
 * is always in the tree, so turning on is a transition that can be interrupted.
 */
export function Mark({
  on,
  off = "ring",
  className,
}: {
  on: boolean;
  off?: "ring" | "dashed";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-[18px] shrink-0 place-items-center rounded-full border transition-colors duration-150",
        on
          ? "border-primary bg-primary text-primary-foreground"
          : off === "dashed"
            ? "border-dashed border-foreground/40"
            : "border-foreground/25 group-hover:border-foreground/40",
        className,
      )}
    >
      <Check
        strokeWidth={3}
        className={cn(
          "size-3 transition-[opacity,scale] duration-150 ease-[var(--ease-out-strong)] motion-reduce:scale-100",
          on ? "scale-100 opacity-100" : "scale-75 opacity-0",
        )}
      />
    </span>
  );
}

/**
 * A summary sentence ("a · b · c") with its break points moved: a line may break between
 * facts, never inside one. The text content is the string, character for character.
 * Safe on any string: with no separator in it, it renders the string.
 */
export function Facts({ text }: { text: string }) {
  const parts = text.split(" · ");
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          <span className="inline-block max-w-full align-top">
            {part}
            {index < parts.length - 1 ? <span className="text-foreground/40"> ·</span> : null}
          </span>
          {index < parts.length - 1 ? " " : null}
        </span>
      ))}
    </>
  );
}

/** The ready count as three pips, one slice of the silk each. Decorative: the count is in words beside it. */
export function ReadyPips({ ready, className }: { ready: readonly boolean[]; className?: string }) {
  return (
    <span aria-hidden className={cn("flex shrink-0 gap-1", className)}>
      {ready.map((on, index) => (
        <span
          key={index}
          className={cn("h-1 w-4 rounded-full", on ? null : "bg-white/[0.12]")}
          style={on ? { backgroundColor: SILK_STOPS[index % SILK_STOPS.length] } : undefined}
        />
      ))}
    </span>
  );
}
