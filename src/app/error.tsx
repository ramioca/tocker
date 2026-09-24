"use client";

import { RouteErrorState } from "@/components/common/error-state";

/** Next 16 hands the boundary a `retry` callback (it was `reset` before). */
export default function ErrorPage(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteErrorState {...props} fullScreen />;
}
