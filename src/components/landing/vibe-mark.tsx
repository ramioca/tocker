/** Wordmark glyph: a candle body with a violet wick. Static, decorative. */
export function VibeMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden focusable="false">
      <rect x="0.5" y="0.5" width="19" height="19" rx="5.5" fill="var(--primary)" fillOpacity="0.14" stroke="var(--primary)" strokeOpacity="0.45" />
      <path d="M10 3.5v13" stroke="var(--primary)" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="7" y="6.5" width="6" height="7" rx="1.5" fill="var(--primary)" />
    </svg>
  );
}
