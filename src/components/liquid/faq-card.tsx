"use client";

import { FAQTabsCard, type FaqTab } from "@/components/spectrumui/faq-tabs-card";
import { useWaitlist } from "./waitlist";

/**
 * Spectrum's FAQ tabs card with its footer wired to the waitlist. A client
 * island so the page can stay a server component: the questions arrive as
 * plain data and the click handler never crosses the boundary.
 */
export function FaqCard({ tabs }: { tabs: FaqTab[] }) {
  const { open } = useWaitlist();
  return <FAQTabsCard tabs={tabs} footerLabel="Join the waitlist" onFooterClick={open} className="lp-faq-card" />;
}
