import type { ReactNode } from "react";

/**
 * The head of every numbered section (01–06): a mono eyebrow across the top,
 * the h2, then the lede, which sits in a right-hand column from 900px. The h2
 * carries `id`, so each section can be `aria-labelledby` it. No hooks, so it
 * renders in server and client components alike.
 */
export function SectionHead({
  id,
  num,
  label,
  title,
  lede,
}: {
  id: string;
  num: string;
  label: string;
  title: ReactNode;
  lede: ReactNode;
}) {
  return (
    <div className="lp-split-head">
      <p className="lp-eyebrow">
        {num ? (
          <>
            {num} <span aria-hidden>—</span>{" "}
          </>
        ) : null}
        {label}
      </p>
      <h2 id={id} className="lp-h2 rise">
        {title}
      </h2>
      <p className="lp-lede rise">{lede}</p>
    </div>
  );
}
