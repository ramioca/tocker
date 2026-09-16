"use client";

import { useMemo } from "react";
import { encodeQr, qrPath } from "@/lib/wallets/qr";
import { cn } from "@/lib/utils";

/**
 * A wallet address as a QR, drawn as one SVG path.
 *
 * Deliberately monochrome and high contrast on a white plate in both themes:
 * phone cameras read a dark-on-white code far more reliably than a themed one,
 * and this is the moment where a failed scan costs someone real money.
 */
export function QrCode({
  value,
  size = 168,
  className,
  label,
}: {
  value: string;
  size?: number;
  className?: string;
  label?: string;
}) {
  const matrix = useMemo(() => {
    try {
      return encodeQr(value);
    } catch {
      return null;
    }
  }, [value]);

  if (!matrix) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-xl border border-border/70 bg-muted/20 p-4 text-center text-xs text-muted-foreground",
          className,
        )}
        style={{ width: size, height: size }}
      >
        Copy the address instead — it is too long to show as a code.
      </div>
    );
  }

  const quiet = 2;
  const span = matrix.size + quiet * 2;

  return (
    <svg
      viewBox={`0 0 ${span} ${span}`}
      width={size}
      height={size}
      role="img"
      aria-label={label ?? "QR code for this address"}
      shapeRendering="crispEdges"
      className={cn("rounded-xl bg-white p-0", className)}
    >
      <rect width={span} height={span} fill="#fff" />
      <g transform={`translate(${quiet} ${quiet})`}>
        <path d={qrPath(matrix)} fill="#000" />
      </g>
    </svg>
  );
}
