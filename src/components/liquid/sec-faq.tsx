import type { FaqTab } from "@/components/spectrumui/faq-tabs-card";

/**
 * 06 Questions as a calm, native accordion: every topic on the page at once (no tabs
 * to hide answers from find-in-page), its label in the head's left column and its
 * questions in the right. Each question is a <details>, so it opens with no script,
 * by keyboard, and from a find-in-page hit. The height eases open where the browser
 * can animate to `auto` (interpolate-size, ::details-content); elsewhere it simply
 * opens. A server component: the questions arrive as data, built by the page.
 */
export function FaqList({ tabs }: { tabs: FaqTab[] }) {
  return (
    <div className="lpq">
      {tabs.map((tab) => {
        const id = `lpq-${tab.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        return (
          <section key={tab.label} className="lpq-group" aria-labelledby={id}>
            <h3 id={id} className="lpq-topic">
              <span className="lp-label">{tab.label}</span>
              <span className="lpq-count lp-mono" aria-hidden>
                {String(tab.faqs.length).padStart(2, "0")}
              </span>
            </h3>
            <div className="lpq-list lp-frame">
              {tab.faqs.map((f) => (
                <details key={f.question} className="lpq-item">
                  <summary className="lpq-q">
                    <span>{f.question}</span>
                    <span className="lpq-icon" aria-hidden />
                  </summary>
                  <p className="lpq-a">{f.answer}</p>
                </details>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
