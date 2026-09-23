"use client";

import { useId } from "react";

/**
 * The flat Ticker Knot from the brand kit (`public/brand/tocker/vector/
 * tocker-mark-color.svg`), inlined so it paints with the page and can sit in
 * the nav at 22px, where the kit says the flat vector is the right one.
 * Gradient ids are made unique so two marks on one page do not collide.
 */
export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  const id = useId();
  const stem = `${id}-stem`;
  const loop = `${id}-loop`;
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden focusable="false" className={className}>
      <defs>
        <linearGradient id={stem} x1="60" y1="36" x2="171" y2="223" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F9F7F2" />
          <stop offset="0.58" stopColor="#EDE9E3" />
          <stop offset="1" stopColor="#A78BFA" />
        </linearGradient>
        <linearGradient id={loop} x1="18" y1="97" x2="217" y2="98" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F4F4F1" />
          <stop offset="0.43" stopColor="#DED5F8" />
          <stop offset="0.72" stopColor="#A78BFA" />
          <stop offset="1" stopColor="#7155D9" />
        </linearGradient>
      </defs>
      <path
        d="M108 16C94 16 83 27 83 41V160C83 195 101 222 130 236C145 243 163 234 167 218C170 205 163 193 151 188C139 183 133 173 133 159V42C133 27 122 16 108 16Z"
        fill={`url(#${stem})`}
      />
      <path
        d="M34 75C21 75 13 86 16 99C17 105 21 110 27 114L54 129C75 141 96 142 118 131L152 113C163 107 174 107 187 113C198 118 211 113 216 102C221 90 215 77 204 72C177 59 151 60 126 73L94 91C83 97 73 97 62 91L44 79C41 76 38 75 34 75Z"
        fill={`url(#${loop})`}
      />
    </svg>
  );
}
