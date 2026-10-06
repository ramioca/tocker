"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { LiquidMetal } from "@/components/common/liquid-metal";

/** How long the chrome runs once the button first scrolls into view, before it rests. */
const METAL_WAKE_MS = 1_500;

/**
 * The page's primary action, in the same liquid-metal chrome as the app's "New agent"
 * button. The ring is a small WebGL canvas, so it only runs when there is a reason to:
 * for a moment when the button first comes into view, then under the pointer or
 * keyboard focus. At rest it keeps its last frame (paused, not removed), and off screen
 * it never runs. Reduced motion freezes it inside LiquidMetal.
 *
 * A plain anchor, not `Link`: sign-in and the app are entered by a full page load
 * (see app-link.tsx).
 */
export function CreateAgentLink({ href, className }: { href: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [onScreen, setOnScreen] = useState(false);
  const [waking, setWaking] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const woke = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!onScreen || woke.current) return;
    woke.current = true;
    setWaking(true);
    const id = window.setTimeout(() => setWaking(false), METAL_WAKE_MS);
    return () => window.clearTimeout(id);
  }, [onScreen]);

  return (
    <span
      ref={ref}
      className={className ? `lp-metal ${className}` : "lp-metal"}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      // Keyboard focus only: a click focuses the link too, and the ring would keep running.
      onFocus={(event) => setFocused(event.target.matches(":focus-visible"))}
      onBlur={() => setFocused(false)}
    >
      <LiquidMetal preset="chromatic" theme="dark" strength={0.85} paused={!(onScreen && (waking || hovered || focused))}>
        <a href={href} className="lp-btn-metal">
          <Plus aria-hidden className="lp-btn-metal-icon" />
          Create your agent
        </a>
      </LiquidMetal>
    </span>
  );
}
