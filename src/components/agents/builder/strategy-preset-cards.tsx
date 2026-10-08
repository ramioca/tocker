import { Fragment } from "react";
import {
  CircleDollarSign,
  Clock,
  Globe,
  Hand,
  PenLine,
  Sparkles,
  Sprout,
  Timer,
  TrendingUp,
  Undo2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CHOICE_CARD, CHOICE_OFF, CHOICE_ON, HAIR, IconTile, Mark, TYPE, type Tone } from "./look";
import { CUSTOM_STRATEGY } from "./strategy-presets";
import type { StrategyPreset } from "./types";

/** An icon and a hue per preset, so four ways of trading can be told apart at a glance. */
const LOOK: Record<string, { icon: LucideIcon; tone: Tone }> = {
  momentum: { icon: TrendingUp, tone: "violet" },
  "sentiment-contrarian": { icon: Undo2, tone: "pink" },
  "first-fifteen": { icon: Timer, tone: "blue" },
  "fresh-launch": { icon: Sprout, tone: "cyan" },
};
const FALLBACK: { icon: LucideIcon; tone: Tone } = { icon: Sparkles, tone: "plain" };
/** The preset ids that have their own icon and hue. A preset missing here gets the fallback tile. */
export const PRESET_LOOK_IDS: readonly string[] = Object.keys(LOOK);
// The facts line joins four facts in a fixed order: chains, interval, ticket, mode.
const FACT_ICONS = [Globe, Clock, CircleDollarSign, Hand] as const;

/**
 * The strategy presets as cards: what each one is, and a line of facts about the agent
 * it would make. The blurb is on the card, not behind a hover, because a tooltip never
 * shows on touch and what a preset does is the thing to know before tapping it.
 */
export function StrategyPresetCards({
  presets,
  pressedId,
  factsLine,
  onApply,
  customPressed,
  onCustom,
}: {
  presets: StrategyPreset[];
  /** The preset whose prompt is the draft's, or null when the prompt is the owner's own. */
  pressedId: string | null;
  /** The agent this preset would leave behind, in one line. */
  factsLine: (preset: StrategyPreset) => string;
  onApply: (preset: StrategyPreset) => void;
  /** The prompt is empty or the owner's own, so the blank card is the one that is on. */
  customPressed: boolean;
  onCustom: () => void;
}) {
  const custom = `strategy-preset-${CUSTOM_STRATEGY.id}`;
  return (
    <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
      {presets.map((preset) => {
        const active = pressedId === preset.id;
        const base = `strategy-preset-${preset.id}`;
        const look = LOOK[preset.id] ?? FALLBACK;
        const facts = factsLine(preset).split(" · ");
        return (
          <button
            key={preset.id}
            type="button"
            aria-pressed={active}
            // Named by its title alone, so a screen reader says "Momentum, pressed" and
            // then the blurb and the facts, not one run-on sentence.
            aria-labelledby={`${base}-label`}
            aria-describedby={`${base}-blurb ${base}-facts`}
            onClick={() => onApply(preset)}
            className={cn(CHOICE_CARD, active ? CHOICE_ON : CHOICE_OFF)}
          >
            <span className="flex items-center gap-2.5">
              <IconTile tone={look.tone}>
                <look.icon strokeWidth={2} />
              </IconTile>
              <span id={`${base}-label`} className={cn(TYPE.heading, "min-w-0 flex-1")}>
                {preset.label}
              </span>
              <Mark on={active} />
            </span>
            <span id={`${base}-blurb`} className="text-[13px] leading-5 text-pretty text-muted-foreground">
              {preset.blurb}
              <span className="sr-only"> Replaces the strategy prompt; you can undo it.</span>
            </span>
            {/* Pushed to the foot, so the facts of two cards in a row sit on one line
                whatever the length of their blurbs. A line breaks between facts, never
                inside one. */}
            <span
              id={`${base}-facts`}
              className={cn(TYPE.caption, "mt-auto flex flex-wrap gap-x-3 gap-y-0.5 border-t pt-3 text-muted-foreground", HAIR)}
            >
              {facts.map((fact, index) => {
                // Icons only when the line has the four facts they were drawn for.
                const Icon =
                  facts.length === 4 ? (index === 3 && fact !== "asks first" ? Zap : FACT_ICONS[index]) : null;
                return (
                  <Fragment key={index}>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      {Icon ? <Icon aria-hidden className="size-3 shrink-0 opacity-70" /> : null}
                      {fact}
                      {index < facts.length - 1 ? <span className="sr-only"> · </span> : null}
                    </span>
                    {/* Four facts sit two and two at every width, so no card is left with
                        one fact alone on a second line. */}
                    {facts.length === 4 && index === 1 ? <span aria-hidden className="h-0 basis-full" /> : null}
                  </Fragment>
                );
              })}
            </span>
          </button>
        );
      })}
      {/* The blank slate: across both columns and dashed, so it reads as an empty page
          and not as a fifth way of trading. One row from sm, stacked on phones. */}
      <button
        type="button"
        aria-pressed={customPressed}
        aria-labelledby={`${custom}-label`}
        aria-describedby={`${custom}-blurb ${custom}-facts`}
        onClick={onCustom}
        className={cn(
          CHOICE_CARD,
          "border-dashed sm:col-span-2 sm:flex-row sm:items-center",
          customPressed ? CHOICE_ON : CHOICE_OFF,
        )}
      >
        <span className="flex items-center gap-2.5 sm:contents">
          <IconTile tone="plain">
            <PenLine strokeWidth={2} />
          </IconTile>
          <span id={`${custom}-label`} className={cn(TYPE.heading, "min-w-0 flex-1 sm:flex-none")}>
            {CUSTOM_STRATEGY.label}
          </span>
          <Mark on={customPressed} className="sm:order-last" />
        </span>
        <span id={`${custom}-blurb`} className="text-[13px] leading-5 text-muted-foreground sm:flex-1">
          {CUSTOM_STRATEGY.blurb}
          <span className="sr-only"> Clears the strategy prompt; you can undo it.</span>
        </span>
        <span
          id={`${custom}-facts`}
          className={cn(TYPE.caption, "text-muted-foreground max-sm:border-t max-sm:pt-3", HAIR)}
        >
          {CUSTOM_STRATEGY.facts}
        </span>
      </button>
    </div>
  );
}
