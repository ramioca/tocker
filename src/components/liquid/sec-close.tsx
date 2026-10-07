import { AppLink } from "./app-link";
import { Chains } from "./chain-logos";
import { CloseShader } from "./close-shader";
import { Magnetic } from "./sec-magnetic";

/**
 * The page closes on a slow liquid silk in the brand's colours (close-shader.tsx, over a
 * painted glow for everyone else) and the hero's call to action again: the way into sign-in, or into the app for a visitor who came with a session
 * cookie. That button is the page's one magnetic control (sec-magnetic.tsx): it leans
 * up to 8px toward a fine pointer, and holds still for touch and reduced motion.
 */
export function CloseCta({ hasSession }: { hasSession: boolean }) {
  return (
    <section className="lp-wrap lp-close" aria-labelledby="lp-close-title">
      <div className="lp-close-glow" aria-hidden>
        <CloseShader />
      </div>
      <h2 id="lp-close-title" className="lp-h2 lp-close-title">
        Go touch grass.
      </h2>
      <p className="lp-lede lp-close-lede">
        Your agent runs your strategy on <Chains size={18} />, on your schedule. Open beta.
      </p>
      <Magnetic className="lp-close-cta">
        <AppLink hasSession={hasSession} />
      </Magnetic>
    </section>
  );
}
