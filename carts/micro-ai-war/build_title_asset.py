#!/usr/bin/env python3
"""Reduce the painted title source to Calyx's pinned 320x240 war palette."""

from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "art" / "title-painted-source.png"
OUTPUT = HERE / "art" / "title-320.png"
PALETTE = HERE / "art" / "war-palette.txt"


def main() -> None:
    colors = [
        tuple(bytes.fromhex(line.strip()))
        for line in PALETTE.read_text(encoding="ascii").splitlines()
        if line.strip()
    ]
    if len(colors) != 32:
        raise SystemExit(f"expected 32 palette colors, got {len(colors)}")

    source = Image.open(SOURCE).convert("RGB")
    image = ImageOps.fit(source, (320, 240), method=Image.Resampling.LANCZOS)
    image = ImageEnhance.Contrast(image).enhance(1.08)
    image = ImageEnhance.Color(image).enhance(0.92)

    palette = Image.new("P", (1, 1))
    flat = [channel for color in colors for channel in color]
    palette.putpalette(flat + [0] * (768 - len(flat)))
    indexed = image.quantize(palette=palette, dither=Image.Dither.FLOYDSTEINBERG)
    indexed.save(OUTPUT, optimize=True)
    print(f"title asset: wrote {OUTPUT.relative_to(HERE)}")


if __name__ == "__main__":
    main()
