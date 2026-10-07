"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LiquidMetal } from "@/components/common/liquid-metal";
import { Button } from "@/components/ui/button";

/** How long the ring runs after it mounts before it rests; the top bar's value. */
const METAL_WAKE_MS = 1_500;

/**
 * The press every button on the sign-in card shares: a 3% scale in place of the
 * primitive's 1px nudge, on the strong ease-out. `scale` is named in the transition
 * because the utility sets the `scale` property, which `transform` does not cover.
 */
export const AUTH_PRESS =
  "ease-out transition-[color,background-color,border-color,box-shadow,scale] active:scale-[0.97] active:not-aria-[haspopup]:translate-y-0";

/**
 * The sign-in card's submit button: a dark pill inside the chrome ring, as the
 * landing's primary action is.
 *
 * Presentation only. `disabled` is the form's own expression, passed through to the
 * button unchanged; this component adds the ring and decides when it runs:
 * - for a moment after it mounts, so it is seen flowing once (dimmed, when the button
 *   is disabled, which it is on arrival);
 * - while enabled and under a mouse or keyboard focus;
 * - otherwise it rests on its last frame.
 *
 * Inside the live ring the library turns the button's own fill and border off and
 * paints a dark interior, so the fill classes below are what shows before hydration
 * and where WebGL2 is missing. The label is off-white either way.
 */
export function MetalSubmit({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  const [waking, setWaking] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setWaking(false), METAL_WAKE_MS);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div
      className="auth-metal mt-3"
      // Dims the ring and the button together; the button's own disabled opacity is
      // cancelled below so the two do not multiply.
      data-off={disabled ? "" : undefined}
      // Mouse only: a tap also enters, and would leave the ring running after it.
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      // Keyboard focus only, for the same reason a click does not count.
      onFocus={(event) => setFocused(event.target.matches(":focus-visible"))}
      onBlur={() => setFocused(false)}
    >
      {/* Paused keeps the last frame on screen: at rest the ring is still chrome, just still. */}
      <LiquidMetal
        preset="chromatic"
        theme="dark"
        strength={0.85}
        paused={!(waking || (!disabled && (hovered || focused)))}
      >
        <Button
          type="submit"
          disabled={disabled}
          className={`h-11 w-full rounded-[12px] border border-white/15 bg-[#0b0b0d] text-[15px] font-[550] tracking-[-0.01em] text-foreground hover:bg-[#161618] disabled:opacity-100 ${AUTH_PRESS}`}
        >
          {children}
        </Button>
      </LiquidMetal>
    </div>
  );
}
