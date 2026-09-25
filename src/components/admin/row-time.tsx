"use client";

import { useSyncExternalStore } from "react";
import { LocalTime } from "@/components/common/relative-time";
import { formatExact } from "@/components/common/format";
import { formatCompactTime } from "./compact-time-format";

const subscribeNever = () => () => {};

/**
 * The pinned Time cell of an admin table. From `lg` every table fits, so it is the full
 * exact moment; below it, the day and minute alone, because the full string was wide
 * enough to cover the links that keyboard focus scrolled to. The exact string stays on
 * the compact one as its tooltip.
 *
 * Empty until hydrated, like `LocalTime`: only the browser knows the reader's zone.
 */
export function RowTime({ iso }: { iso: string }) {
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  return (
    <>
      <span className="max-lg:hidden">
        <LocalTime iso={iso} className="whitespace-nowrap" />
      </span>
      <time
        dateTime={iso}
        title={hydrated ? formatExact(iso) : undefined}
        className="whitespace-nowrap tabular-nums lg:hidden"
      >
        {hydrated ? formatCompactTime(iso) : ""}
      </time>
    </>
  );
}
