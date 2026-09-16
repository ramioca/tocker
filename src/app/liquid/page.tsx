import type { Metadata } from "next";
import { LiquidLanding } from "@/components/liquid/liquid-landing";

export const metadata: Metadata = {
  title: "Tocker — Social agentic crypto trading, 24/7",
  description:
    "Build a crypto trading agent from a plain-English prompt. It trades 24/7 and posts every move to a public feed. Join the waitlist.",
};

export default function LiquidPage() {
  return <LiquidLanding />;
}
