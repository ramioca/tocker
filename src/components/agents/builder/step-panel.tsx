import type { BuilderStepId } from "./contract";
import { Facts, SILK_V, TYPE } from "./look";
import { cn } from "@/lib/utils";

/**
 * One step of the builder. Every panel stays mounted and the ones that are not showing
 * are `hidden` and `inert`, so a half-typed key, a blocklist row or a custom funding
 * amount survives a trip to another step, and nothing in a hidden step takes focus.
 *
 * The entrance is a CSS transition out of `@starting-style`, which fires when `hidden`
 * comes off. It plays only for a move made with a pointer (`animate`): a keyboard move, a
 * deep link, a restored draft and the browser's Back button swap the panel at once.
 * Leaving has no motion at all, so an exit is always faster than an entrance. Where
 * `@starting-style` is not supported the panel simply appears.
 *
 * A step whose settings start on a default says what they are now (`now`), in the same
 * sentence the agent card shows, so the user reads the setting before the controls.
 */
export function StepPanel({
  id,
  active,
  direction,
  animate,
  title,
  lead,
  now,
  children,
}: {
  id: BuilderStepId;
  active: boolean;
  /** 1 when the user moved forward to get here, -1 when they moved back. */
  direction: 1 | -1;
  animate: boolean;
  title: string;
  lead: React.ReactNode;
  /** The step's settings as one sentence, read back under the lead. */
  now?: string;
  children: React.ReactNode;
}) {
  const titleId = `step-${id}-title`;
  return (
    <section
      hidden={!active}
      inert={!active}
      aria-labelledby={titleId}
      data-animate={animate}
      data-direction={direction === -1 ? "back" : "forward"}
      className={cn(
        "transition-[opacity,transform] duration-200 ease-[var(--ease-out-strong)] starting:opacity-0",
        // The slide is 8px from the side the user is travelling towards. Reduced motion
        // keeps the fade and drops the slide.
        "motion-safe:starting:[transform:translateX(8px)] motion-safe:data-[direction=back]:starting:[transform:translateX(-8px)]",
        "motion-reduce:duration-150 data-[animate=false]:transition-none",
      )}
    >
      {/* Focus lands here after a step change, so a screen reader starts at the top of the
          new step. It is not a tab stop. */}
      <h2 id={titleId} tabIndex={-1} className={cn(TYPE.display, "mt-2 text-balance outline-none")}>
        {title}
      </h2>
      <p className={cn(TYPE.body, "mt-1 max-w-[60ch] text-pretty sm:mt-2")}>{lead}</p>
      {now ? <NowLine text={now} className="mt-3" /> : null}
      <div className="mt-5 sm:mt-8">{children}</div>
    </section>
  );
}

/**
 * What a group of settings comes to, as the one sentence the agent card shows for it.
 * Quiet on purpose: it is a read-back, not a control and not an announcement.
 */
export function NowLine({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn(TYPE.caption, "relative pl-3 text-muted-foreground", className)}>
      <span aria-hidden className={cn(SILK_V, "absolute inset-y-[3px] left-0 w-0.5 rounded-full")} />
      <span className="font-medium text-foreground">Now: </span>
      {/* Breaks between facts, never inside one. */}
      <Facts text={text} />
    </p>
  );
}
