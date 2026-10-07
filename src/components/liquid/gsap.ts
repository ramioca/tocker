"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";

/**
 * The landing's one GSAP entry: every scroll timeline, pin and split imports from here,
 * so the plugins register once, on the client only. Scroll effects belong inside
 * `gsap.matchMedia()` with a `(prefers-reduced-motion: no-preference)` branch; reduced
 * motion gets the finished state with no pins, scrub or split.
 */
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);
}

export const MOTION_OK = "(prefers-reduced-motion: no-preference)";
export const DESKTOP_MOTION = "(prefers-reduced-motion: no-preference) and (min-width: 768px)";

export { gsap, ScrollTrigger, SplitText, useGSAP };
