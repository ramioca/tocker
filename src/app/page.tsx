import { Suspense } from "react";
import "@/components/landing/landing.css";
import { LandingHeader } from "@/components/landing/landing-header";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { FeatureBento } from "@/components/landing/feature-bento";
import { LeaderboardStrip } from "@/components/landing/leaderboard-strip";
import { LeaderboardStripSkeleton } from "@/components/landing/leaderboard-strip-skeleton";
import { DataSourcesRow } from "@/components/landing/data-sources-row";
import { LandingFaq } from "@/components/landing/landing-faq";
import { FinalCta } from "@/components/landing/final-cta";
import { LandingFooter } from "@/components/landing/landing-footer";

export default function LandingPage() {
  return (
    <div className="petri-landing flex min-h-screen flex-1 flex-col">
      <LandingHeader />
      <main className="flex-1">
        <Hero />
        <DataSourcesRow />
        <HowItWorks />
        <hr className="lp-hr mx-auto max-w-6xl" />
        <FeatureBento />
        <Suspense fallback={<LeaderboardStripSkeleton />}>
          <LeaderboardStrip />
        </Suspense>
        <hr className="lp-hr mx-auto max-w-6xl" />
        <LandingFaq />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
