"use client";

import { Component, type ReactNode } from "react";

/**
 * A quiet error boundary for the data-backed sections of the marketing page.
 *
 * The leaderboard and the feed preview read the database at request time. If either
 * throws — a schema push in flight, a cold database, a bad deploy — that section
 * renders its fallback and the rest of the page stands. Without this, one failed
 * query sent a first-time visitor to the app's error screen instead of the pitch.
 */
export class SectionBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Not silent: the failure still reaches the console (and Next's dev overlay).
    console.error("[landing] a section failed to render and was hidden", error);
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}
