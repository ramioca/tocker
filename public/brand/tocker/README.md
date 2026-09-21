# Tocker brand kit

The **Ticker Knot** is a continuous ribbon forming a lowercase `t`. The loop
represents a live market feed, while the returning ribbon represents an agent's
continuous observe-decide-trade cycle.

## Which file to use

- `master/tocker-mark-3d-transparent.png` — hero art, launch pages and large
  marketing placements.
- `lockups/tocker-lockup-3d-light.png` — dimensional lockup on dark backgrounds.
- `lockups/tocker-lockup-3d-dark.png` — dimensional lockup on light backgrounds.
- `vector/tocker-mark-color.svg` — default scalable product mark.
- `vector/tocker-lockup-light.svg` — scalable lockup on dark backgrounds.
- `vector/tocker-lockup-dark.svg` — scalable lockup on light backgrounds.
- `monochrome/` — one-colour marks for legal, print, stamps and constrained UI.
- `icons/app-icon-1024.png` — opaque app-store master.
- `icons/apple-touch-icon.png` — Apple touch icon.
- `icons/icon-192.png` and `icons/icon-512.png` — PWA icons.
- `icons/favicon.svg` — preferred modern browser favicon.
- `icons/favicon.ico` and numbered favicon PNGs — browser fallbacks.
- `icons/social-avatar-512.png` — social profile image.

## Core colors

| Name | Hex | Use |
| --- | --- | --- |
| Night | `#070708` | Primary dark background |
| Ink | `#17151D` | Wordmark and light-mode text |
| Paper | `#F4F4F1` | Dark-mode wordmark and highlights |
| Violet | `#A78BFA` | Brand signal |
| Violet Deep | `#7155D9` | Ribbon depth only |

## Usage

- Use the dimensional mark at **40 px or larger**. Below that, use the flat SVG.
- Keep at least **one ribbon-width** of empty space around the mark.
- Do not rotate, stretch, add another gradient, change the overlap order, or put
  the mark over a busy image.
- Use the light lockup on Night/Ink backgrounds and the dark lockup on white or
  Paper backgrounds.
- The opaque `app-icon-1024.png` is the app-store source. Do not submit the
  transparent working render to app stores.

## Web setup

```html
<link rel="icon" href="/brand/tocker/icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/brand/tocker/icons/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/brand/tocker/icons/apple-touch-icon.png">
<link rel="manifest" href="/brand/tocker/manifest.webmanifest">
```

The flat vectors are deliberately optically simplified for small sizes. The
dimensional PNG masters preserve the selected sculpted Ticker Knot treatment.
