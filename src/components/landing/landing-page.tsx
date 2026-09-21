"use client";

import "./landing.css";
import { Footer } from "./footer";
import { Hero } from "./hero/hero";
import { Nav } from "./nav";
import { Close } from "./sections/close";
import { Loop } from "./sections/loop";
import { Modes } from "./sections/modes";
import { Record } from "./sections/record";
import { Safety } from "./sections/safety";
import { Signals } from "./sections/signals";
import { WaitlistProvider } from "./waitlist/context";

/**
 * The landing page. Native scroll, one typeface, one lit object, one violet.
 *
 * Section order is the narrative: hook → the loop → signals → public record /
 * private edge → gates & exits → paper then live → close. Every section reads
 * its copy from ./content.ts. The page does not depend on the app's Providers
 * (no Privy, no react-query, no Base UI) and must never touch the database on
 * the render path.
 */
export function LandingPage() {
  return (
    <WaitlistProvider>
      <div className="ld min-h-dvh">
        <Nav />
        <main>
          <Hero />
          <Loop />
          <Signals />
          <Record />
          <Safety />
          <Modes />
          <Close />
        </main>
        <Footer />
      </div>
    </WaitlistProvider>
  );
}
