#!/usr/bin/env python3
"""Derive the share card's background from the X banner.

The master is the banner (public/brand/tocker/v3/tocker-banner-x.webp, 2000 x 667): type
on the left, the liquid shader on the right. This keeps only the shader, right of the
banner's own words, sets it on the right of a 1200 x 630 card, dims it a touch and fades
it into the near-black ground on its left, where the card's type sits. The result is
what src/app/opengraph-image.tsx draws everything else on. Run it again whenever the
banner changes:

    python3 scripts/brand/make-og-background.py

Needs Pillow and numpy. Nothing here runs in the app or in CI.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
V3 = ROOT / "public" / "brand" / "tocker" / "v3"
MASTER = V3 / "tocker-banner-x.webp"
OUT = V3 / "og-background.jpg"

W, H = 1200, 630
# The banner's words end just left of this column; everything right of it is shader.
CROP_X = 1170
# How bright the shader stays (1 = as in the banner): "light", so the type leads.
GAIN = 0.86
# The fade into the ground, as fractions of the art's width from its left edge.
FADE_FROM, FADE_TO = 0.0, 0.42
GROUND = np.array([5, 5, 7], dtype=np.float32)


def smoothstep(a: float, b: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def main() -> None:
    banner = Image.open(MASTER).convert("RGB")
    art = banner.crop((CROP_X, 0, banner.width, banner.height))
    art = art.resize((round(art.width * H / art.height), H), Image.LANCZOS)
    aw = art.width
    ox = W - aw

    card = np.tile(GROUND, (H, W, 1))
    a = np.asarray(art, dtype=np.float32)
    fade = (smoothstep(FADE_FROM, FADE_TO, np.arange(aw) / aw) * GAIN)[None, :, None]
    card[:, ox:, :] = a * fade + GROUND * (1.0 - fade)

    Image.fromarray(np.clip(card + 0.5, 0, 255).astype(np.uint8)).save(OUT, quality=90, optimize=True, progressive=True)
    print(f"{OUT.relative_to(ROOT)}: {W} x {H}, shader from x {ox}, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
