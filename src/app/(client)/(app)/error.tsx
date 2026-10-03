"use client";

import { RouteErrorState } from "@/components/common/error-state";

/** Renders inside the (app) layout, so the header and tab bar stay put around it. */
export default function AppError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteErrorState {...props} />;
}
