#!/usr/bin/env python3
"""png2src — bake a PNG sprite into an AssemblyScript data module.

The Sunny build step from ABI §4 Drawing: sprites are baked into the
cart (a data segment the cart passes to `blit`), so the `.wasm` stays
the single portable artifact and the runtime needs no asset loading.

    python tools/png2src.py hero.png -o hero.ts --name HERO

emits `HERO_W` / `HERO_H` / `HERO: StaticArray<u8>` for
`blit_sprite(HERO, HERO_W, HERO_H, x, y, flags)`.

Mapping is exact and fail-fast: a pixel with alpha < 128 becomes
index 0 (the `blit` color-key hole); every opaque RGB must equal a
palette entry exactly or the tool errors with the offending color and
position — no nearest-color guessing, palettes are the cart's design.

Stdlib-only (zlib) so it runs anywhere Python does; supports the
non-interlaced 8-bit PNGs pixel editors export (gray, gray+alpha, RGB,
RGBA, and 8-bit indexed), plus indexed, RGB and grayscale tRNS transparency.
Use --format rgba to preserve straight-alpha RGBA bytes without palette mapping.
"""

import argparse
import pathlib
import re
import struct
import sys
import zlib

# The named palettes Sunny ships (sdk/assembly/palettes.ts) — values
# verbatim from godot/shared/console_config.gd / ABI §1.1.
PALETTES = {
    "SWEETIE_16": [
        "000000", "ffffff", "1a1c2c", "5d275d",
        "b13e53", "ef7d57", "ffcd75", "a7f070",
        "38b764", "257179", "29366f", "3b5dc9",
        "41a6f6", "73eff7", "94b0c2", "566c86",
    ],
    "MONO": ["000000", "ffffff"],
    "GAMEBOY": ["0f380f", "306230", "8bac0f", "9bbc0f"],
    "GBA_WARM": [
        "1a0a00", "fffbe8", "2b1a0f", "6b3a2a",
        "c0392b", "e67e22", "f1c40f", "a8d8a8",
        "27ae60", "1e8449", "1a4a6b", "2980b9",
        "7fb3d3", "aed6f1", "d5c5a1", "8c7b6b",
        "4a3728", "7b5e3a", "c8a96e", "f2d7b6",
        "e8b4b8", "c0708a", "7d3c59", "3d1a47",
        "6a4c93", "b09fce", "56c4c4", "2e8b8b",
        "c8dea8", "e8c86e", "b05020", "6b2020",
    ],
}


def parse_png(data):
    """Return (width, height, rows of RGBA tuples)."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG file")
    pos = 8
    ihdr = None
    plte = None
    trns = None
    idat = b""
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", body)
        elif ctype == b"PLTE":
            plte = body
        elif ctype == b"tRNS":
            trns = body
        elif ctype == b"IDAT":
            idat += body
        elif ctype == b"IEND":
            break
    if ihdr is None:
        raise ValueError("missing IHDR")
    w, h, depth, color, comp, filt, interlace = ihdr
    if interlace != 0:
        raise ValueError("interlaced PNGs are not supported")
    if depth != 8:
        raise ValueError(f"bit depth {depth} not supported (8 only)")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color)
    if channels is None:
        raise ValueError(f"color type {color} not supported")

    raw = zlib.decompress(idat)
    stride = w * channels
    rows = []
    prev = bytearray(stride)
    pos = 0
    for _y in range(h):
        ftype = raw[pos]
        line = bytearray(raw[pos + 1 : pos + 1 + stride])
        pos += 1 + stride
        bpp = channels
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            if ftype == 1:
                line[i] = (line[i] + a) & 0xFF
            elif ftype == 2:
                line[i] = (line[i] + b) & 0xFF
            elif ftype == 3:
                line[i] = (line[i] + (a + b) // 2) & 0xFF
            elif ftype == 4:
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                if pa <= pb and pa <= pc:
                    pr = a
                elif pb <= pc:
                    pr = b
                else:
                    pr = c
                line[i] = (line[i] + pr) & 0xFF
            elif ftype != 0:
                raise ValueError(f"unknown filter {ftype}")
        prev = line
        rows.append(bytes(line))

    def rgba_rows():
        out = []
        for line in rows:
            px = []
            for x in range(w):
                i = x * channels
                if color == 0:  # gray
                    g = line[i]
                    px.append((g, g, g, 0 if trns is not None and struct.unpack(">H", trns)[0] == g else 255))
                elif color == 2:  # RGB
                    rgb = (line[i], line[i + 1], line[i + 2])
                    px.append((*rgb, 0 if trns is not None and struct.unpack(">HHH", trns) == rgb else 255))
                elif color == 3:  # indexed
                    idx = line[i]
                    if plte is None or idx * 3 + 2 >= len(plte):
                        raise ValueError(f"palette index {idx} out of PLTE")
                    alpha = 255
                    if trns is not None and idx < len(trns):
                        alpha = trns[idx]
                    px.append(
                        (
                            plte[idx * 3],
                            plte[idx * 3 + 1],
                            plte[idx * 3 + 2],
                            alpha,
                        )
                    )
                elif color == 4:  # gray + alpha
                    g = line[i]
                    px.append((g, g, g, line[i + 1]))
                else:  # RGBA
                    px.append(
                        (line[i], line[i + 1], line[i + 2], line[i + 3])
                    )
            out.append(px)
        return out

    return w, h, rgba_rows()


def map_indices(w, h, rows, palette_hex, palette_label):
    lut = {}
    for i, hexval in enumerate(palette_hex):
        rgb = tuple(int(hexval[j : j + 2], 16) for j in (0, 2, 4))
        lut.setdefault(rgb, i)  # first occurrence wins on duplicates
    indices = []
    for y in range(h):
        for x in range(w):
            r, g, b, a = rows[y][x]
            if a < 128:
                indices.append(0)  # blit color-key hole (ABI §4)
                continue
            idx = lut.get((r, g, b))
            if idx is None:
                raise ValueError(
                    f"pixel ({x},{y}) #{r:02x}{g:02x}{b:02x} is not in "
                    f"palette {palette_label} — png2src maps exactly, "
                    "never nearest"
                )
            indices.append(idx)
    return indices


def render_module(name, src_label, w, h, indices):
    rows = []
    for i in range(0, len(indices), w if w <= 20 else 20):
        chunk = ", ".join(str(v) for v in indices[i : i + (w if w <= 20 else 20)])
        rows.append(f"  {chunk},")
    body = "\n".join(rows)
    return f"""\
// GENERATED from {src_label} by tools/png2src.py — do not edit.
// 8bpp palette indices, row-major, for blit_sprite (ABI §4 Drawing);
// transparent source pixels are index 0 (the color-key hole).

export const {name}_W: i32 = {w};
export const {name}_H: i32 = {h};
export const {name}: StaticArray<u8> = [
{body}
];
"""


def convert(png_bytes, name, src_label, palette_hex, palette_label, format="indexed"):
    w, h, rows = parse_png(png_bytes)
    if format == "rgba":
        pixels = [channel for row in rows for pixel in row for channel in pixel]
        module = render_module(name, src_label, w * 4, h, pixels)
        module = module.replace(f"{name}_W: i32 = {w * 4};", f"{name}_W: i32 = {w};")
        return module.replace(
            "// 8bpp palette indices, row-major, for blit_sprite (ABI §4 Drawing);\n// transparent source pixels are index 0 (the color-key hole).",
            "// 32bpp straight-alpha RGBA bytes, row-major, for blit_rgba (ABI §4 Drawing).",
        )
    if format != "indexed":
        raise ValueError(f"unknown output format: {format}")
    indices = map_indices(w, h, rows, palette_hex, palette_label)
    return render_module(name, src_label, w, h, indices)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("png", type=pathlib.Path, help="source PNG")
    parser.add_argument(
        "-o", "--out", type=pathlib.Path, help="output .ts (default: stdout)"
    )
    parser.add_argument(
        "--name",
        help="identifier prefix (default: from the file name)",
    )
    parser.add_argument(
        "--palette",
        default="SWEETIE_16",
        choices=sorted(PALETTES),
        help="named palette to map against (default SWEETIE_16)",
    )
    parser.add_argument(
        "--palette-file",
        type=pathlib.Path,
        help="text file of RRGGBB hex lines — a cart's set_palette ramp",
    )
    parser.add_argument("--format", choices=["indexed", "rgba"], default="indexed",
                        help="output pixels: indexed (default) or straight-alpha RGBA")
    args = parser.parse_args()

    if args.palette_file:
        palette_hex = [
            line.strip().lstrip("#").lower()
            for line in args.palette_file.read_text().splitlines()
            if line.strip()
        ]
        palette_label = str(args.palette_file)
    else:
        palette_hex = PALETTES[args.palette]
        palette_label = args.palette

    name = args.name or re.sub(r"\W", "_", args.png.stem).upper()
    if not re.fullmatch(r"[A-Za-z_]\w*", name):
        print(f"invalid identifier: {name}", file=sys.stderr)
        return 2

    try:
        module = convert(
            args.png.read_bytes(), name, args.png.name, palette_hex,
            palette_label, format=args.format,
        )
    except ValueError as e:
        print(f"png2src: {e}", file=sys.stderr)
        return 1

    if args.out:
        args.out.write_text(module, encoding="utf-8")
        print(f"wrote {args.out}")
    else:
        sys.stdout.write(module)
    return 0


if __name__ == "__main__":
    sys.exit(main())
