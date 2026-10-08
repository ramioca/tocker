# Tocker brand kit

## v3: the 3D "T" (current)

This is the mark the site uses: the landing, the app bar, the login, the browser
tab, the home-screen icons and the share image.

One render is the master. `scripts/brand/make-mark-assets.py` cuts the T out of it
and writes every other file below, so none of them is edited by hand: replace the
master and run the script again.

| File | What it is for |
| --- | --- |
| `v3/tocker-mark-3d-2000.png` | The master render, on black, 2000 x 2000. |
| `v3/tocker-mark-3d-transparent.png` | The T alone on transparency, 1169 x 964. The source for any new size. |
| `v3/tocker-mark-720.webp` | Transparent, 720 wide. Large placements and the sign-in provider's modal. |
| `v3/tocker-mark-160.webp` | Transparent, 160 wide. The nav, the app bar and the login (sharp at 3x up to 53 px wide). |
| `v3/tocker-mark-512.png` | Transparent PNG, 512 wide. For the share image, whose renderer is not a browser and may not read WebP. At 95 KB it is too heavy to put on a page. |

Browsers keep the files in `v3/` for a day (`next.config.ts`), so a new cut takes
up to a day to reach someone who has already visited. Local dev does not cache them.

The script also writes the icons. They live outside this folder, where the site
looks for them:

| File | What it is for |
| --- | --- |
| `src/app/favicon.ico` | Browser tab: 16, 32 and 48, transparent. |
| `src/app/icon.png` | The same icon as a PNG, 192, transparent, for browsers that prefer one. |
| `src/app/apple-icon.png` | iOS home screen and push notifications: 180, on black. |
| `public/icon-192.png`, `public/icon-512.png` | The installed web app (`public/manifest.webmanifest`): on black, with enough room around the T to survive a maskable crop. |

In code, take the paths and the ratio (1169 / 964) from
`src/components/brand/tocker-mark.tsx` instead of typing them again.

## Earlier kit: the Ticker Knot

Everything from here down describes an earlier mark. The site no longer uses it.

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
