/**
 * The two chains' marks, drawn inline beside their names: Solana's from the token
 * logo that ships with the site, Base's as its circle mark in SVG. Decorative: the
 * chain's name is always written beside each one.
 */
export function SolanaLogo({ size = 16 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a 96px local WebP drawn at 16px; next/image adds nothing here
    <img className="lp-chain-logo" src="/tokens/sol-96.webp" alt="" width={size} height={size} decoding="async" aria-hidden />
  );
}

export function BaseLogo({ size = 16 }: { size?: number }) {
  return (
    <svg className="lp-chain-logo" width={size} height={size} viewBox="0 0 111 111" aria-hidden>
      <circle cx="55.5" cy="55.5" r="55.5" fill="#fff" />
      <path
        d="M54.921 110.034C85.359 110.034 110.034 85.402 110.034 55.017C110.034 24.6319 85.359 0 54.921 0C26.0432 0 2.35281 22.1714 0 50.3923H72.8467V59.6416H0C2.35281 87.8625 26.0432 110.034 54.921 110.034Z"
        fill="#0052FF"
      />
    </svg>
  );
}

/** "Solana and Base", each name after its mark. */
export function Chains({ size = 16 }: { size?: number }) {
  return (
    <span className="lp-chains">
      <span className="lp-chain">
        <SolanaLogo size={size} />
        <span className="lp-chain-name">Solana</span>
      </span>
      <span className="lp-chain-and">and</span>
      <span className="lp-chain">
        <BaseLogo size={size} />
        <span className="lp-chain-name">Base</span>
      </span>
    </span>
  );
}
