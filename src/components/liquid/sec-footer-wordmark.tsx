/**
 * The footer's last word: "tocker", lowercase like the lockup's logotype, set as wide as the page, rising out of a clip as
 * the footer scrolls into view. The reveal is CSS only (clip-path on a view()
 * timeline, landing-sections.css) and only where the browser supports scroll-driven
 * animation; everywhere else, and under reduced motion, it is simply there. Decorative:
 * the footer's lockup already names the product, so this is hidden from assistive tech.
 */
export function FooterWordmark() {
  return (
    <div className="lp-wordmark" aria-hidden>
      <span className="lp-wordmark-text">tocker</span>
    </div>
  );
}
