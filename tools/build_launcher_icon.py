#!/usr/bin/env python3
"""Bake square cover art into a deterministic 64x64 SWEETIE-16 launcher icon."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter, ImageOps


SWEETIE_16 = (
    "000000", "ffffff", "1a1c2c", "5d275d",
    "b13e53", "ef7d57", "ffcd75", "a7f070",
    "38b764", "257179", "29366f", "3b5dc9",
    "41a6f6", "73eff7", "94b0c2", "566c86",
)


def palette_image(colors: list[tuple[int, int, int]]) -> Image.Image:
    palette = Image.new("P", (1, 1))
    flat = [channel for color in colors for channel in color]
    palette.putpalette(flat + list(colors[0]) * (256 - len(colors)))
    return palette


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--preview", type=Path, required=True)
    parser.add_argument("--binary", type=Path, required=True)
    args = parser.parse_args()

    colors = [tuple(bytes.fromhex(value)) for value in SWEETIE_16]
    source = Image.open(args.source).convert("RGB")
    icon = ImageOps.fit(source, (128, 128), method=Image.Resampling.LANCZOS)
    icon = ImageEnhance.Contrast(icon).enhance(1.18)
    icon = ImageEnhance.Color(icon).enhance(1.04)
    icon = icon.filter(ImageFilter.UnsharpMask(radius=1.1, percent=140, threshold=3))
    icon = icon.resize((64, 64), Image.Resampling.LANCZOS)
    icon = icon.quantize(
        palette=palette_image(colors),
        dither=Image.Dither.NONE,
    )

    # Palette index 0 is the launcher's transparent key. Cover art is a full
    # square field, so preserve near-black pixels as SWEETIE dark blue.
    indices = bytes(2 if value == 0 else value for value in icon.tobytes())
    final = Image.frombytes("P", (64, 64), indices)
    final.putpalette(
        [channel for color in colors for channel in color]
        + [0] * (768 - len(colors) * 3)
    )

    args.preview.parent.mkdir(parents=True, exist_ok=True)
    args.binary.parent.mkdir(parents=True, exist_ok=True)
    final.save(args.preview, optimize=True)
    args.binary.write_bytes(indices)
    print(f"wrote {args.preview} and {args.binary}")


if __name__ == "__main__":
    main()
