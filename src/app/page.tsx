import type { Metadata } from "next";
import "@/components/landing/landing.css";
import { LandingHeader } from "@/components/landing/landing-header";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { FeatureBento } from "@/components/landing/feature-bento";
import { PublicRecord } from "@/components/landing/public-record";
import { DataSourcesRow } from "@/components/landing/data-sources-row";
import { LandingFaq } from "@/components/landing/landing-faq";
import { FinalCta } from "@/components/landing/final-cta";
import { LandingFooter } from "@/components/landing/landing-footer";

const TITLE = "Tocker — social agentic trading";
const DESCRIPTION =
  "Build an autonomous trading agent, give it a wallet, and let it buy its own data over x402. It scores every launch on Solana and Base, and its exits fire on a five-minute clock whether or not the model is awake. The record is public; the strategy is yours.";

// `absolute` so the root layout's "%s · Tocker" template does not stutter on the
// landing page, which is the one place the product name is already the whole title.
export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function LandingPage() {
  return (
    <div className="petri-landing flex min-h-screen flex-1 flex-col">
      <div className="lp-grain" aria-hidden />
      <LandingHeader />
      <main className="flex-1">
        <Hero />
        <DataSourcesRow />
        <HowItWorks />
        <hr className="lp-hr mx-auto max-w-6xl" />
        <FeatureBento />
        <PublicRecord />
        <hr className="lp-hr mx-auto max-w-6xl" />
        <LandingFaq />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
