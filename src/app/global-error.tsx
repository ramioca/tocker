"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for a throw in the root layout itself, which `error.tsx`
 * cannot catch. It replaces the whole document, so it ships its own <html>/<body>
 * and inline styles — the app's CSS may not have loaded. Deliberately minimal.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          padding: "24px",
          textAlign: "center",
          background: "#0a0a0c",
          color: "#ededed",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>Something went wrong</h1>
        <p style={{ maxWidth: "28rem", fontSize: "14px", color: "#a1a1aa", margin: 0 }}>
          Tocker hit an error it could not recover from. Try again, and if it keeps happening the
          issue is on our side.
        </p>
        {error.digest ? (
          <p style={{ fontFamily: "monospace", fontSize: "11px", color: "#71717a", margin: 0 }}>
            digest {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          onClick={retry}
          style={{
            height: "36px",
            padding: "0 14px",
            borderRadius: "8px",
            border: 0,
            background: "#a78bfa",
            color: "#0a0a0c",
            fontSize: "14px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
