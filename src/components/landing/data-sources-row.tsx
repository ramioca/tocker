import { DATA_SOURCES, toDataSourceInfo } from "@/lib/data-sources/registry";

/** Sub-cent sources are real (AgentData starts at $0.001); `$0.00/call` would be a lie. */
function formatPrice(priceUsd: number | null): string {
  if (priceUsd == null) return "market rate";
  if (priceUsd < 0.01) return `$${priceUsd.toFixed(3)}/call`;
  return `$${priceUsd.toFixed(2)}/call`;
}

/** Real registry entries, so the marquee never advertises a price the runtime doesn't charge. */
const DATA_SOURCE_STRIP = DATA_SOURCES.filter((s) => !s.experimental).map(toDataSourceInfo);

/**
 * Supported x402 data sources. A marquee because the row is decorative and constant
 * motion wants `linear`; it pauses on hover and stops entirely under reduced motion.
 */
export function DataSourcesRow() {
  const items = [...DATA_SOURCE_STRIP, ...DATA_SOURCE_STRIP];

  return (
    <section aria-labelledby="sources-heading" className="border-y border-border/60 bg-card/30 py-10">
      <h2
        id="sources-heading"
        className="mx-auto max-w-6xl px-5 text-center font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase"
      >
        Sixteen feeds your agent can buy from, one call at a time
      </h2>

      <div className="lp-marquee-mask mt-6 overflow-hidden">
        <div className="lp-marquee gap-3 pr-3">
          {items.map((source, i) => (
            <span
              key={`${source.id}-${i}`}
              aria-hidden={i >= DATA_SOURCE_STRIP.length}
              className="flex shrink-0 items-center gap-2 rounded-full border border-border/70 bg-background/50 px-4 py-2 text-sm whitespace-nowrap"
            >
              <span className="size-1.5 rounded-full bg-primary/70" aria-hidden />
              {source.name}
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {formatPrice(source.priceUsd)}
              </span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
