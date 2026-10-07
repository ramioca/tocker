"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { LiquidMetal } from "@/components/common/liquid-metal";
import { usePageVisible } from "./motion";

/**
 * The page's primary action, in the same liquid-metal chrome as the app's "New agent"
 * button. The liquid flows the whole time the button is on screen and the tab is in
 * front; off screen or in a background tab it pauses on its last frame. Reduced motion
 * freezes it inside LiquidMetal.
 *
 * A plain anchor, not `Link`: sign-in and the app are entered by a full page load
 * (see app-link.tsx).
 */
export function CreateAgentLink({ href, className, size = "lg" }: { href: string; className?: string; size?: "sm" | "lg" }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [onScreen, setOnScreen] = useState(false);
  const visible = usePageVisible();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const cls = size === "sm" ? "lp-metal lp-metal-sm" : "lp-metal";
  return (
    <span ref={ref} className={className ? `${cls} ${className}` : cls}>
      <LiquidMetal preset="chromatic" theme="dark" strength={0.85} paused={!(onScreen && visible)}>
        <a href={href} className="lp-btn-metal">
          <Plus aria-hidden className="lp-btn-metal-icon" />
          Create your agent
        </a>
      </LiquidMetal>
    </span>
  );
}
