#!/usr/bin/env python3
"""Derive every size of the Tocker mark from its one master render.

The master is the 3D "T" on pure black (public/brand/tocker/v3/tocker-mark-3d-2000.png).
This cuts the T out of the black, then writes the web sizes, the browser and home-screen
icons and the share card's copy. Run it again whenever the master changes:

    python3 scripts/brand/make-mark-assets.py

Needs Pillow and numpy. Nothing here runs in the app or in CI.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
V3 = ROOT / "public" / "brand" / "tocker" / "v3"
MASTER = V3 / "tocker-mark-3d-2000.png"
APP = ROOT / "src" / "app"
PUBLIC = ROOT / "public"

BLACK = (0, 0, 0, 255)


def grow(mask: np.ndarray, steps: int) -> np.ndarray:
    """Widen a mask by `steps` pixels in the four directions."""
    out = mask.copy()
    for _ in range(steps):
        wider = out.copy()
        wider[1:, :] |= out[:-1, :]
        wider[:-1, :] |= out[1:, :]
        wider[:, 1:] |= out[:, :-1]
        wider[:, :-1] |= out[:, 1:]
        out = wider
    return out


def cut_out(master: Image.Image) -> Image.Image:
    """The T alone, tightly cropped, on transparency.

    The outside is found by flooding from the four corners, so the near-black facets
    inside the T stay solid: keying on darkness would punch holes through them. Only the
    outer two pixels are softened, and their colour is lifted back out of the black they
    were blended with, so the edge has no dark fringe on a light page.
    """
    rgb = master.convert("RGB")
    width, height = rgb.size
    marker = (255, 0, 255)
    flood = rgb.copy()
    for seed in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        ImageDraw.floodfill(flood, seed, marker, thresh=14)
    outside = (np.asarray(flood) == np.array(marker)).all(axis=2)

    colour = np.asarray(rgb).astype(np.float32)
    brightest = colour.max(axis=2)
    edge = grow(outside, 2) & ~outside
    alpha = np.where(outside, 0.0, 1.0).astype(np.float32)
    alpha = np.where(edge, np.clip(brightest / 70.0, 0.0, 1.0), alpha)
    lifted = np.clip(colour / np.maximum(alpha, 1e-3)[..., None], 0, 255)
    colour = np.where(edge[..., None], lifted, colour)

    rgba = np.dstack([colour, alpha * 255]).round().astype(np.uint8)
    rows, cols = np.where(alpha > 0.02)
    box = (int(cols.min()), int(rows.min()), int(cols.max()) + 1, int(rows.max()) + 1)
    return Image.fromarray(rgba).crop(box)


def at_width(mark: Image.Image, width: int) -> Image.Image:
    height = round(mark.height * width / mark.width)
    return mark.resize((width, height), Image.LANCZOS)


def on_square(mark: Image.Image, side: int, fill: float, ground: tuple[int, int, int, int] | None) -> Image.Image:
    """The mark centred on a square: `fill` is the share of the side its width takes."""
    canvas = Image.new("RGBA", (side, side), ground or (0, 0, 0, 0))
    scaled = at_width(mark, max(1, round(side * fill)))
    canvas.alpha_composite(scaled, ((side - scaled.width) // 2, (side - scaled.height) // 2))
    return canvas


def main() -> None:
    mark = cut_out(Image.open(MASTER))

    # Masters and web sizes.
    mark.save(V3 / "tocker-mark-3d-transparent.png", optimize=True)
    at_width(mark, 512).save(V3 / "tocker-mark-512.png", optimize=True)
    at_width(mark, 720).save(V3 / "tocker-mark-720.webp", quality=92, method=6)
    at_width(mark, 160).save(V3 / "tocker-mark-160.webp", quality=92, method=6)

    # Browser tab: transparent, the T as wide as the square, so it still reads at 16px.
    on_square(mark, 256, 1.0, None).save(
        APP / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]
    )
    on_square(mark, 192, 1.0, None).save(APP / "icon.png", optimize=True)

    # Home screens: opaque, with room around the T. 0.6 keeps it inside the circle a
    # launcher may crop a maskable icon to.
    on_square(mark, 180, 0.66, BLACK).convert("RGB").save(APP / "apple-icon.png", optimize=True)
    for side in (192, 512):
        on_square(mark, side, 0.6, BLACK).convert("RGB").save(PUBLIC / f"icon-{side}.png", optimize=True)

    print(f"mark {mark.width}x{mark.height}")
    for path in sorted([*V3.iterdir(), APP / "favicon.ico", APP / "icon.png", APP / "apple-icon.png",
                        PUBLIC / "icon-192.png", PUBLIC / "icon-512.png"]):
        print(f"{path.stat().st_size:>8}  {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
